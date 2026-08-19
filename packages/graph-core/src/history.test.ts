import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@god-view/protocol';
import { buildHistoryTimeline, type HistoryCommit } from './history.js';

/**
 * 历史投影的测试。
 *
 * 关注三件容易出错、又直接影响可信度的事：文件归属谁、节点什么时候消失、
 * 帧被聚合后是否仍如实报告合并了几次提交。
 */

const declaredAt = '2026-01-01T00:00:00.000Z';

function node(id: string, paths: readonly string[], parentId?: string): GraphNode {
  return {
    id,
    type: 'module',
    label: id,
    paths: [...paths],
    ...(parentId === undefined ? {} : { parentId }),
    source: { kind: 'agent_declared', actor: { kind: 'agent' }, declaredAt },
    codeValidation: { status: 'verified' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: declaredAt,
    revision: 1,
  };
}

function edge(id: string, from: string, to: string): GraphEdge {
  return {
    id,
    from,
    to,
    type: 'depends_on',
    source: { kind: 'agent_declared', actor: { kind: 'agent' }, declaredAt },
    codeValidation: { status: 'unverified' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: declaredAt,
    revision: 1,
  };
}

function commit(
  sha: string,
  files: readonly { path: string; additions?: number; deletions?: number; removed?: boolean }[],
): HistoryCommit {
  return {
    sha,
    author: 'tester',
    committedAt: `2026-01-0${sha.slice(-1)}T00:00:00.000Z`,
    subject: `commit ${sha}`,
    files: files.map((file) => ({
      path: file.path,
      additions: file.additions ?? 10,
      deletions: file.deletions ?? 0,
      removed: file.removed ?? false,
    })),
  };
}

const emptyMap = { mapNodes: [] as GraphNode[], mapEdges: [] as GraphEdge[] };

describe('buildHistoryTimeline 归属', () => {
  it('文件优先归属地图节点，未覆盖的回落成目录节点', () => {
    const timeline = buildHistoryTimeline(
      [commit('c1', [{ path: 'src/orders/index.ts' }, { path: 'tools/build.ts' }])],
      { mapNodes: [node('module.orders', ['src/orders'])], mapEdges: [] },
    );

    expect(timeline.frames[0]?.presentNodeIds).toEqual(['module.orders', 'history:dir:tools']);
    expect(timeline.derivedNodeCount).toBe(1);
    expect(timeline.nodes.find((item) => item.id === 'history:dir:tools')?.source.kind).toBe(
      'inferred',
    );
  });

  it('声明路径更长的节点优先，避免父模块吞掉子模块的文件', () => {
    const timeline = buildHistoryTimeline([commit('c1', [{ path: 'src/orders/pay/index.ts' }])], {
      mapNodes: [node('module.src', ['src']), node('module.pay', ['src/orders/pay'])],
      mapEdges: [],
    });

    expect(timeline.frames[0]?.presentNodeIds).toContain('module.pay');
    expect(timeline.frames[0]?.presentNodeIds).not.toContain('module.src');
  });

  it('文件节点出现时，它在地图里的父模块同时出现', () => {
    const timeline = buildHistoryTimeline([commit('c1', [{ path: 'src/orders/index.ts' }])], {
      mapNodes: [
        node('module.orders', ['src/orders']),
        node('file.index', ['src/orders/index.ts'], 'module.orders'),
      ],
      mapEdges: [],
    });

    expect(timeline.frames[0]?.presentNodeIds).toEqual(['file.index', 'module.orders']);
  });

  it('容器目录再向下取一层，不把整个仓库画成一个点', () => {
    const timeline = buildHistoryTimeline(
      [commit('c1', [{ path: 'packages/core/src/a.ts' }, { path: 'packages/ui/b.ts' }])],
      emptyMap,
    );

    expect(timeline.frames[0]?.presentNodeIds).toEqual([
      'history:dir:packages/core',
      'history:dir:packages/ui',
    ]);
  });

  it('根目录文件归入独立的根节点', () => {
    const timeline = buildHistoryTimeline([commit('c1', [{ path: 'README.md' }])], emptyMap);

    expect(timeline.nodes[0]?.id).toBe('history:dir:(root)');
    expect(timeline.nodes[0]?.label).toBe('仓库根目录');
  });
});

describe('buildHistoryTimeline 生长与消失', () => {
  it('节点的文件被删光后从后续帧消失', () => {
    const timeline = buildHistoryTimeline(
      [
        commit('c1', [{ path: 'src/legacy/old.ts' }, { path: 'src/core/a.ts' }]),
        commit('c2', [{ path: 'src/legacy/old.ts', additions: 0, deletions: 10, removed: true }]),
      ],
      emptyMap,
    );

    expect(timeline.frames[0]?.presentNodeIds).toContain('history:dir:src/legacy');
    expect(timeline.frames[1]?.presentNodeIds).not.toContain('history:dir:src/legacy');
    expect(timeline.frames[1]?.presentNodeIds).toEqual(['history:dir:src/core']);
  });

  it('规模随累计行数增长，并统计当前文件数', () => {
    const timeline = buildHistoryTimeline(
      [
        commit('c1', [{ path: 'src/core/a.ts', additions: 100 }]),
        commit('c2', [{ path: 'src/core/b.ts', additions: 50 }]),
      ],
      emptyMap,
    );

    const [first, second] = timeline.frames;
    expect(first?.magnitudes['history:dir:src/core']).toBe(101);
    expect(second?.magnitudes['history:dir:src/core']).toBe(152);
    expect(second?.fileCount).toBe(2);
  });

  it('本帧改动的节点被标出来，未改动的不标', () => {
    const timeline = buildHistoryTimeline(
      [commit('c1', [{ path: 'src/core/a.ts' }]), commit('c2', [{ path: 'src/ui/b.ts' }])],
      emptyMap,
    );

    expect(timeline.frames[1]?.changedNodeIds).toEqual(['history:dir:src/ui']);
  });

  it('窗口之前的基线文件属于第一帧，不被误报成新建', () => {
    const timeline = buildHistoryTimeline([commit('c1', [{ path: 'src/core/a.ts' }])], {
      ...emptyMap,
      baselineFiles: ['src/legacy/old.ts'],
      truncatedCommits: 12,
    });

    expect(timeline.frames[0]?.presentNodeIds).toContain('history:dir:src/legacy');
    expect(timeline.frames[0]?.changedNodeIds).not.toContain('history:dir:src/legacy');
    expect(timeline.truncatedCommits).toBe(12);
  });
});

describe('buildHistoryTimeline 关系与聚合', () => {
  it('只画两端都已出现的地图关系，目录节点之间不造关系', () => {
    const timeline = buildHistoryTimeline(
      [commit('c1', [{ path: 'src/a/x.ts' }]), commit('c2', [{ path: 'src/b/y.ts' }])],
      {
        mapNodes: [node('module.a', ['src/a']), node('module.b', ['src/b'])],
        mapEdges: [edge('edge.ab', 'module.a', 'module.b'), edge('edge.ghost', 'module.a', 'gone')],
      },
    );

    expect(timeline.edges.map((item) => item.id)).toEqual(['edge.ab']);
  });

  it('提交数超过帧数上限时合并相邻提交，并如实报告合并数量', () => {
    const commits = Array.from({ length: 9 }, (_, index) =>
      commit(`c${String(index + 1)}`, [{ path: `src/core/file-${String(index)}.ts` }]),
    );

    const timeline = buildHistoryTimeline(commits, { ...emptyMap, maxFrames: 3 });

    expect(timeline.frames).toHaveLength(3);
    expect(timeline.frames.map((frame) => frame.commitCount)).toEqual([3, 3, 3]);
    expect(timeline.frames[0]?.sha).toBe('c3');
    expect(timeline.frames[0]?.additions).toBe(30);
  });

  it('没有提交时返回空时间线而不是抛错', () => {
    const timeline = buildHistoryTimeline([], emptyMap);

    expect(timeline.frames).toEqual([]);
    expect(timeline.nodes).toEqual([]);
  });
});
