import { join } from 'node:path';

const unsafeSegment = /[^A-Za-z0-9_-]/gu;
const maxSegmentLength = 48;

/**
 * 把 workspaceId 或 branchKey 转换为安全的目录名。
 *
 * 分支名可以包含 `/`、空格和非 ASCII 字符，直接用作路径会产生嵌套目录甚至穿越；
 * 因此替换不安全字符后附加短哈希，保证「安全」与「不同输入不碰撞」同时成立。
 */
export function toDirectorySegment(value: string): string {
  const sanitized = value.replace(unsafeSegment, '-').slice(0, maxSegmentLength);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${sanitized === '' ? 'default' : sanitized}-${hash.toString(16).padStart(8, '0')}`;
}

export interface BranchStorageLayout {
  readonly root: string;
  readonly eventLogFile: string;
  readonly snapshotFile: string;
  readonly quarantineFile: string;
}

/**
 * 地图状态按 workspace identity + Git branch key 隔离
 * （TECHNICAL_ARCHITECTURE.md §8.2）。
 */
export function resolveBranchStorage(
  storageRoot: string,
  workspaceId: string,
  branchKey: string,
): BranchStorageLayout {
  const root = join(storageRoot, toDirectorySegment(workspaceId), toDirectorySegment(branchKey));
  return {
    root,
    eventLogFile: join(root, 'events.jsonl'),
    snapshotFile: join(root, 'snapshot.json'),
    quarantineFile: join(root, 'quarantine.jsonl'),
  };
}
