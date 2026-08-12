import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, reduce, type GraphSnapshot } from '@god-view/graph-core';
import { node, nodeUpsert, resetEventSequence } from '@god-view/testkit';
import type { AgentNodeDeclaration } from '@god-view/protocol';
import { affectedNodeIds, toWorkspaceRelative } from './path-impact.js';

/**
 * 路径影响映射的测试。
 *
 * 真实 Extension Host 上暴露的缺陷：删除 `src/payment/index.ts` 后增量刷新没有
 * 更新漂移，而切分支触发的全量校验立刻就对了。根因是增量选择只看 `node.paths`，
 * 不看 `node.locations`，也不处理「变化的是声明路径的祖先目录」。
 */

function snapshotWith(...declarations: readonly AgentNodeDeclaration[]): GraphSnapshot {
  resetEventSequence();
  let snapshot = createEmptySnapshot({
    workspaceId: 'ws-test',
    branchKey: 'main',
    createdAt: '2026-08-07T10:00:00.000Z',
  });
  for (const declaration of declarations) {
    const result = reduce(snapshot, nodeUpsert(declaration));
    if (!result.ok) {
      throw new Error(`fixture 构造失败：${result.error.code}`);
    }
    snapshot = result.value;
  }
  return snapshot;
}

describe('affectedNodeIds', () => {
  it('目录声明命中目录内部的文件变化', () => {
    const snapshot = snapshotWith(node('payment', { paths: ['src/payment'] }));

    expect(affectedNodeIds(snapshot, ['src/payment/index.ts'])).toEqual(['payment']);
  });

  it('精确文件声明命中该文件本身', () => {
    const snapshot = snapshotWith(node('entry', { paths: ['src/main.ts'] }));

    expect(affectedNodeIds(snapshot, ['src/main.ts'])).toEqual(['entry']);
  });

  it('只通过 locations 引用的文件同样命中', () => {
    // 这是真实环境暴露的缺陷：全量校验会验证 locations，增量选择却忽略它。
    const snapshot = snapshotWith(
      node('api', { locations: [{ path: 'src/api/server.ts', startLine: 10 }] }),
    );

    expect(affectedNodeIds(snapshot, ['src/api/server.ts'])).toEqual(['api']);
  });

  it('paths 与 locations 同时存在时不重复计数', () => {
    const snapshot = snapshotWith(
      node('both', {
        paths: ['src/orders'],
        locations: [{ path: 'src/orders/index.ts' }],
      }),
    );

    expect(affectedNodeIds(snapshot, ['src/orders/index.ts'])).toEqual(['both']);
  });

  it('删除祖先目录时命中其下的声明', () => {
    // 目录被删除或重命名时，文件系统只报告目录这一条。
    const snapshot = snapshotWith(node('payment', { paths: ['src/payment'] }));

    expect(affectedNodeIds(snapshot, ['src'])).toEqual(['payment']);
  });

  it('目录重命名的两端都命中', () => {
    const snapshot = snapshotWith(
      node('old', { paths: ['src/old-name'] }),
      node('new', { paths: ['src/new-name'] }),
    );

    expect([...affectedNodeIds(snapshot, ['src/old-name', 'src/new-name'])].sort()).toEqual([
      'new',
      'old',
    ]);
  });

  it('同名前缀不误伤', () => {
    const snapshot = snapshotWith(
      node('pay', { paths: ['src/payment'] }),
      node('payments', { paths: ['src/payments'] }),
    );

    expect(affectedNodeIds(snapshot, ['src/payments/index.ts'])).toEqual(['payments']);
  });

  it('无关变化不命中任何节点', () => {
    const snapshot = snapshotWith(node('payment', { paths: ['src/payment'] }));

    expect(affectedNodeIds(snapshot, ['docs/readme.md'])).toEqual([]);
  });

  it('没有路径声明的节点永远不被选中', () => {
    const snapshot = snapshotWith(node('group', { type: 'group' }));

    expect(affectedNodeIds(snapshot, ['src/anything.ts'])).toEqual([]);
  });

  it('空变化列表返回空集', () => {
    const snapshot = snapshotWith(node('payment', { paths: ['src/payment'] }));

    expect(affectedNodeIds(snapshot, [])).toEqual([]);
  });

  it('归一化 ./ 前缀、反斜杠与结尾斜杠', () => {
    const snapshot = snapshotWith(node('payment', { paths: ['./src/payment/'] }));

    expect(affectedNodeIds(snapshot, ['src\\payment\\index.ts'])).toEqual(['payment']);
  });

  it('一次变化命中多个声明了同一目录的节点', () => {
    const snapshot = snapshotWith(
      node('a', { paths: ['src/shared'] }),
      node('b', { paths: ['src/shared/util.ts'] }),
    );

    expect([...affectedNodeIds(snapshot, ['src/shared/util.ts'])].sort()).toEqual(['a', 'b']);
  });
});

describe('toWorkspaceRelative', () => {
  it('去掉工作区根前缀', () => {
    expect(toWorkspaceRelative('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('工作区根自身返回 undefined', () => {
    expect(toWorkspaceRelative('/repo', '/repo')).toBeUndefined();
    expect(toWorkspaceRelative('/repo', '/repo/')).toBeUndefined();
  });

  it('工作区外的路径返回 undefined', () => {
    expect(toWorkspaceRelative('/repo', '/other/src/a.ts')).toBeUndefined();
  });

  it('同名前缀的兄弟目录不被误认为在工作区内', () => {
    expect(toWorkspaceRelative('/repo', '/repo-backup/src/a.ts')).toBeUndefined();
  });

  it('Windows 路径转成正斜杠相对路径', () => {
    expect(toWorkspaceRelative('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts');
  });

  it('Windows 盘符大小写不一致时仍然匹配', () => {
    // VS Code 在不同 API 之间可能给出不同大小写的盘符。
    expect(toWorkspaceRelative('c:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts');
  });

  it('保留后缀的原始大小写', () => {
    // 返回值要拿去和地图里的声明比对，不能被改写。
    expect(toWorkspaceRelative('c:\\Repo', 'C:\\Repo\\Src\\App.ts')).toBe('Src/App.ts');
  });

  it('工作区根带结尾斜杠也能处理', () => {
    expect(toWorkspaceRelative('/repo/', '/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('空输入返回 undefined', () => {
    expect(toWorkspaceRelative('', '/repo/src/a.ts')).toBeUndefined();
    expect(toWorkspaceRelative('/repo', '')).toBeUndefined();
  });
});
