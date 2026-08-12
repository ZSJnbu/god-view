import { readTextFile } from '@god-view/storage';
import type { Identifier } from '@god-view/protocol';

/**
 * 扩展写给 Agent 的连接信息。
 *
 * Gateway 不猜测 workspaceId 与 branchKey：这两个值决定事件归属哪张地图，
 * 猜错会让事件被状态引擎以 WORKSPACE_MISMATCH 拒绝。
 */
export interface SessionDescriptor {
  readonly workspaceId: Identifier;
  readonly branchKey: Identifier;
  readonly protocolVersion: string;
}

function isSessionDescriptor(value: unknown): value is SessionDescriptor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['workspaceId'] === 'string' &&
    typeof candidate['branchKey'] === 'string' &&
    typeof candidate['protocolVersion'] === 'string'
  );
}

/** 读取扩展发布的会话描述；未发布时返回 undefined，由调用方给出可操作的提示。 */
export async function readSessionDescriptor(
  sessionFile: string,
): Promise<SessionDescriptor | undefined> {
  const contents = await readTextFile(sessionFile);
  if (contents === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }
  return isSessionDescriptor(parsed) ? parsed : undefined;
}
