import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptySnapshot, reduce, type GraphSnapshot } from '@god-view/graph-core';
import { node, nodeUpsert, resetEventSequence } from '@god-view/testkit';
import { GitAdapter } from '../workspace/git-adapter.js';
import { buildWorkspaceHistory } from './history-timeline.js';

/**
 * 历史回放装配的测试，跑在真实 git 仓库上。
 *
 * 重点是「回放看到的东西必须和覆盖率看到的一致」：构建产物与依赖不能因为出现在
 * 提交里就冒出来变成模块。
 */

const run = promisify(execFile);

let root: string;
let git: GitAdapter;

async function inRepo(args: readonly string[]): Promise<void> {
  await run('git', [...args], { cwd: root });
}

async function commitFile(relative: string, message: string): Promise<void> {
  const target = join(root, relative);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, 'export const x = 1;\n');
  await inRepo(['add', '-A']);
  await inRepo(['commit', '-qm', message]);
}

function snapshotWith(paths: Record<string, readonly string[]>): GraphSnapshot {
  resetEventSequence();
  let snapshot = createEmptySnapshot({
    workspaceId: 'ws-test',
    branchKey: 'main',
    createdAt: '2026-08-07T10:00:00.000Z',
  });
  for (const [id, nodePaths] of Object.entries(paths)) {
    const result = reduce(snapshot, nodeUpsert(node(id, { paths: [...nodePaths] })));
    if (!result.ok) throw new Error(`fixture 构造失败：${result.error.code}`);
    snapshot = result.value;
  }
  return snapshot;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'god-view-history-'));
  await inRepo(['init', '-q']);
  await inRepo(['config', 'user.email', 'test@example.com']);
  await inRepo(['config', 'user.name', 'test']);
  git = new GitAdapter(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildWorkspaceHistory', () => {
  it('按提交生成帧，并优先使用地图节点的名字', async () => {
    await commitFile('src/orders/index.ts', 'add orders');
    await commitFile('src/payment/index.ts', 'add payment');

    const timeline = await buildWorkspaceHistory({
      git,
      snapshot: snapshotWith({ 'module.orders': ['src/orders'] }),
      extraExcludes: [],
    });

    expect(timeline?.frames).toHaveLength(2);
    expect(timeline?.frames[0]?.presentNodeIds).toEqual(['module.orders']);
    expect(timeline?.frames[1]?.presentNodeIds).toEqual([
      'module.orders',
      'history:dir:src/payment',
    ]);
    expect(timeline?.frames[1]?.subject).toBe('add payment');
  });

  it('构建产物与依赖不会变成历史里的模块', async () => {
    await commitFile('src/app.ts', 'add source');
    await commitFile('node_modules/left-pad/index.js', 'vendor');
    await commitFile('dist/bundle.js', 'build output');

    const timeline = await buildWorkspaceHistory({
      git,
      snapshot: snapshotWith({}),
      extraExcludes: [],
    });

    // 只动了排除目录的提交在结构上什么也没发生，不出帧。
    expect(timeline?.frames).toHaveLength(1);
    expect(timeline?.nodes.map((item) => item.id)).toEqual(['history:dir:src']);
  });

  it('用户配置的排除规则同样生效', async () => {
    await commitFile('src/app.ts', 'add source');
    await commitFile('generated/schema.ts', 'add generated');

    const timeline = await buildWorkspaceHistory({
      git,
      snapshot: snapshotWith({}),
      extraExcludes: ['generated/**'],
    });

    expect(timeline?.nodes.map((item) => item.id)).toEqual(['history:dir:src']);
  });

  it('没有提交时返回 undefined，由调用方如实说明回放不可用', async () => {
    const timeline = await buildWorkspaceHistory({
      git,
      snapshot: snapshotWith({}),
      extraExcludes: [],
    });

    expect(timeline).toBeUndefined();
  });

  it('非 Git 目录返回 undefined', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'god-view-plain-'));
    try {
      const timeline = await buildWorkspaceHistory({
        git: new GitAdapter(plain),
        snapshot: snapshotWith({}),
        extraExcludes: [],
      });

      expect(timeline).toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
