import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GodViewEvent } from '@god-view/protocol';
import { GatewaySession } from './gateway-session.js';
import { resolveWorkspaceRuntime } from './runtime-layout.js';

/**
 * Gateway 跟随分支切换的回归测试。
 *
 * 覆盖的缺陷：`god-view serve` 是长期进程，但 branchKey 只在启动时从 session.json
 * 读一次。用户 checkout 之后，扩展已经重新绑定并重写了 session.json，Gateway 却
 * 仍在给事件盖旧分支的标签——事件要么被状态引擎拒绝，要么在竞态下落进旧分支的日志。
 *
 * 这里模拟一个「同一个进程跨越 main → feature → main」的完整往返。
 */

const workspaceId = 'ws-test';
const now = (): string => '2026-08-07T10:00:00.000Z';

let workspaceRoot: string;
let session: GatewaySession;

/** 模拟扩展在绑定分支时重写会话描述。 */
async function publishDescriptor(branchKey: string): Promise<void> {
  const layout = resolveWorkspaceRuntime(workspaceRoot);
  await mkdir(layout.root, { recursive: true });
  await writeFile(
    layout.sessionFile,
    JSON.stringify({ workspaceId, branchKey, protocolVersion: '1.0' }),
  );
}

/** 收件箱里所有事件，按投递顺序。 */
async function readInbox(): Promise<GodViewEvent[]> {
  const layout = resolveWorkspaceRuntime(workspaceRoot);
  let names: string[];
  try {
    names = await readdir(layout.inboxDir);
  } catch {
    return [];
  }
  const events: GodViewEvent[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    events.push(JSON.parse(await readFile(join(layout.inboxDir, name), 'utf8')) as GodViewEvent);
  }
  return events;
}

async function upsert(id: string): Promise<{ accepted: boolean; warnings?: readonly string[] }> {
  const result = await session.upsertNode({
    sessionId: 'session-1',
    idempotencyKey: `key-${id}`,
    node: { id, type: 'module', label: id },
  });
  return {
    accepted: result.accepted,
    ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
  };
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'god-view-branch-follow-'));
  await publishDescriptor('main');
  session = new GatewaySession({
    workspaceRoot,
    workspaceId,
    branchKey: 'main',
    now,
    adapterId: 'claude-code',
  });
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('同一进程跨分支往返', () => {
  it('每个事件盖上投递当时的分支标签', async () => {
    await upsert('on-main-1');

    await publishDescriptor('feature/x');
    await upsert('on-feature');

    await publishDescriptor('main');
    await upsert('on-main-2');

    const events = await readInbox();
    expect(events.map((event) => event.branchKey)).toEqual(['main', 'feature/x', 'main']);
  });

  it('分支变化时提醒 Agent 重新读取地图', async () => {
    const before = await upsert('on-main');
    expect(before.warnings).toBeUndefined();

    await publishDescriptor('feature/x');
    const after = await upsert('on-feature');

    expect(after.accepted).toBe(true);
    expect(after.warnings?.join('')).toContain('feature/x');
  });

  it('分支没变时不产生噪音警告', async () => {
    await upsert('first');
    const second = await upsert('second');

    expect(second.warnings).toBeUndefined();
  });

  it('branchKey 暴露给调用方，便于 CLI 与诊断显示', async () => {
    expect(session.branchKey).toBe('main');

    await publishDescriptor('feature/x');
    await upsert('on-feature');

    expect(session.branchKey).toBe('feature/x');
  });
});

describe('会话描述异常', () => {
  it('描述被删除时保持现有绑定，而不是猜一个分支', async () => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await rm(layout.sessionFile);

    await upsert('orphan');

    const events = await readInbox();
    expect(events[0]?.branchKey).toBe('main');
  });

  it('描述属于另一个工作区时不采用它的分支', async () => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await writeFile(
      layout.sessionFile,
      JSON.stringify({
        workspaceId: 'ws-other',
        branchKey: 'someone-else',
        protocolVersion: '1.0',
      }),
    );

    await upsert('guarded');

    // 宁可让状态引擎以 WORKSPACE_MISMATCH 明确拒绝，也不静默改写归属。
    const events = await readInbox();
    expect(events[0]?.branchKey).toBe('main');
    expect(session.branchKey).toBe('main');
  });

  it('描述协议 major 不兼容时拒绝写入并给出可操作修复步骤', async () => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await writeFile(
      layout.sessionFile,
      JSON.stringify({ workspaceId, branchKey: 'main', protocolVersion: '2.0' }),
    );

    const result = await session.upsertNode({
      sessionId: 'session-1',
      idempotencyKey: 'incompatible',
      node: { id: 'must-not-write', type: 'module', label: '不应写入' },
    });

    expect(result.accepted).toBe(false);
    expect(result.errors[0]?.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    expect(result.errors[0]?.message).toContain('重新复制 Agent 接入配置');
    await expect(readInbox()).resolves.toEqual([]);
  });
});

describe('get_map 跟随分支', () => {
  it('地图尚未发布时返回同步后的分支', async () => {
    await publishDescriptor('feature/x');
    const result = await session.getMap({});

    expect(result).toMatchObject({ branchKey: 'feature/x', nodes: [], edges: [] });
  });
});
