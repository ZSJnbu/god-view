import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProtocolValidator } from '@god-view/protocol';
import { resolveBranchStorage } from '@god-view/storage';
import { node, nodeUpsert, resetEventSequence, workspaceId } from '@god-view/testkit';
import { BranchBinding } from './branch-binding.js';

/**
 * 分支绑定的回归测试。
 *
 * 覆盖的缺陷：`branchKey` 只在启动时读一次，用户 checkout 到另一个分支后，
 * 事件仍被追加到上一个分支的日志里。这类错误不会报错、不会崩溃，只会让数据
 * 悄悄归到错误的分支下，因此必须由测试锁住。
 */

let storageRoot: string;
let runtimeDir: string;
let binding: BranchBinding;

const now = (): string => '2026-08-07T10:00:00.000Z';

function makeBinding(): BranchBinding {
  return new BranchBinding({
    workspaceId,
    storageRoot,
    runtimeDir,
    validator: createProtocolValidator(),
    now,
  });
}

/** 在指定分支上追加一个建节点事件。事件信封的 branchKey 必须与绑定一致。 */
async function appendNode(target: BranchBinding, branchKey: string, id: string): Promise<void> {
  const event = nodeUpsert(node(id, { label: id }), {
    envelope: { branchKey, eventId: `event-${branchKey}-${id}` },
  });
  const result = await target.repository.append(event);
  expect(result.ok).toBe(true);
}

async function readEventLog(branchKey: string): Promise<string[]> {
  const layout = resolveBranchStorage(storageRoot, workspaceId, branchKey);
  try {
    const contents = await readFile(layout.eventLogFile, 'utf8');
    return contents
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => (JSON.parse(line) as { payload: { node: { id: string } } }).payload.node.id);
  } catch {
    return [];
  }
}

async function readSessionDescriptor(): Promise<{ workspaceId: string; branchKey: string }> {
  const contents = await readFile(join(runtimeDir, 'session.json'), 'utf8');
  return JSON.parse(contents) as { workspaceId: string; branchKey: string };
}

beforeEach(async () => {
  resetEventSequence();
  const base = await mkdtemp(join(tmpdir(), 'god-view-branch-'));
  storageRoot = join(base, 'storage');
  runtimeDir = join(base, 'workspace', '.godview');
  binding = makeBinding();
});

afterEach(async () => {
  await rm(join(runtimeDir, '..', '..'), { recursive: true, force: true });
});

describe('首次绑定', () => {
  it('写出会话描述，供 Gateway 决定事件归属', async () => {
    await binding.bind({ branchKey: 'main' });

    await expect(readSessionDescriptor()).resolves.toMatchObject({
      workspaceId,
      branchKey: 'main',
    });
  });

  it('尚未绑定时访问仓库直接抛错，而不是含糊地写到某个分支', () => {
    expect(() => makeBinding().repository).toThrow(/尚未绑定分支/u);
    expect(makeBinding().repositoryOrUndefined).toBeUndefined();
  });
});

describe('切换分支', () => {
  it('切换后的事件写进新分支日志，旧分支日志不受影响', async () => {
    await binding.bind({ branchKey: 'main' });
    await appendNode(binding, 'main', 'on-main');

    await binding.bind({ branchKey: 'feature/x' });
    await appendNode(binding, 'feature/x', 'on-feature');
    await binding.flush();

    // 这一对断言就是缺陷本身：修复前 on-feature 会出现在 main 的日志里。
    await expect(readEventLog('main')).resolves.toEqual(['on-main']);
    await expect(readEventLog('feature/x')).resolves.toEqual(['on-feature']);
  });

  it('同步重写会话描述，避免 Gateway 继续盖旧分支标签', async () => {
    await binding.bind({ branchKey: 'main' });
    await binding.bind({ branchKey: 'feature/x' });

    await expect(readSessionDescriptor()).resolves.toMatchObject({ branchKey: 'feature/x' });
  });

  it('切换后快照从新分支恢复，不带入旧分支的节点', async () => {
    await binding.bind({ branchKey: 'main' });
    await appendNode(binding, 'main', 'on-main');

    await binding.bind({ branchKey: 'feature/x' });

    expect([...binding.repository.snapshot.nodes.keys()]).toEqual([]);
  });

  it('切回原分支能读回原来的图', async () => {
    await binding.bind({ branchKey: 'main' });
    await appendNode(binding, 'main', 'on-main');
    await binding.bind({ branchKey: 'feature/x' });
    await binding.bind({ branchKey: 'main' });

    expect([...binding.repository.snapshot.nodes.keys()]).toEqual(['on-main']);
  });

  it('切换前刷写旧分支，已接受的事件不会因为切换而丢失', async () => {
    await binding.bind({ branchKey: 'main' });
    await appendNode(binding, 'main', 'on-main');

    // 不显式 flush，直接切走：绑定内部必须自己刷干净。
    await binding.bind({ branchKey: 'feature/x' });

    await expect(readEventLog('main')).resolves.toEqual(['on-main']);
  });
});

describe('重复绑定同一分支', () => {
  it('不重开仓库，也不重放日志', async () => {
    await binding.bind({ branchKey: 'main' });
    await appendNode(binding, 'main', 'on-main');
    const before = binding.repository;

    const result = await binding.bind({ branchKey: 'main' });

    expect(result.changed).toBe(false);
    expect(result.report).toBeUndefined();
    // 同一个实例：重开会重放整个日志，Git 状态每次刷新都付这个代价是不可接受的。
    expect(binding.repository).toBe(before);
  });

  it('首次绑定报告 changed，供调用方决定是否重算事实', async () => {
    const result = await binding.bind({ branchKey: 'main' });

    expect(result.changed).toBe(true);
    expect(result.report?.restoredFrom).toBe('empty');
  });
});

describe('分支名净化', () => {
  it('含斜杠的分支名不会产生嵌套目录或穿越', async () => {
    await binding.bind({ branchKey: 'feature/../../escape' });
    await appendNode(binding, 'feature/../../escape', 'safe');
    await binding.flush();

    const entries = await readdir(join(storageRoot));
    expect(entries).toHaveLength(1);
    const branches = await readdir(join(storageRoot, entries[0] ?? ''));
    expect(branches.every((name) => !name.includes('/') && !name.includes('..'))).toBe(true);
  });
});
