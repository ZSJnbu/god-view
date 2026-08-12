import { describe, expect, it } from 'vitest';
import { applySnapshot, emptyMapState, type MapState } from './store.js';
import {
  buildVisibleGraph,
  resolveVisibleAnchor,
  searchNodes,
  type DetailLevel,
} from './view-model.js';
import { capabilities, makeDocument, makeEdge, makeNode } from './fixtures.test-utils.js';

/**
 * 三层结构：分组 domain → 模块 orders/billing → 文件。
 * 用它验证 LOD 折叠、边聚合与聚焦邻域。
 */
function projectState(): MapState {
  const nodes = [
    makeNode('domain', { type: 'group', label: '业务域' }),
    makeNode('orders', { type: 'module', parentId: 'domain', label: '订单' }),
    makeNode('billing', { type: 'module', parentId: 'domain', label: '账单' }),
    makeNode('orders/a.ts', { type: 'file', parentId: 'orders', paths: ['src/orders/a.ts'] }),
    makeNode('orders/b.ts', { type: 'file', parentId: 'orders', paths: ['src/orders/b.ts'] }),
    makeNode('billing/c.ts', { type: 'file', parentId: 'billing', paths: ['src/billing/c.ts'] }),
    makeNode('db', { type: 'storage', label: '主库' }),
  ];
  const edges = [
    makeEdge('e1', 'orders/a.ts', 'billing/c.ts'),
    makeEdge('e2', 'orders/b.ts', 'billing/c.ts', { type: 'calls' }),
    makeEdge('e3', 'billing', 'db', { type: 'writes' }),
  ];
  return applySnapshot(emptyMapState, {
    document: makeDocument(nodes, edges, 1),
    capabilities,
    factsRevision: 1,
    drift: [],
  });
}

function idsAt(level: DetailLevel): readonly string[] {
  return buildVisibleGraph(projectState(), { level })
    .nodes.map(({ node }) => node.id)
    .sort();
}

describe('buildVisibleGraph', () => {
  it('近景显示文件级节点', () => {
    expect(idsAt('files')).toEqual([
      'billing',
      'billing/c.ts',
      'db',
      'domain',
      'orders',
      'orders/a.ts',
      'orders/b.ts',
    ]);
  });

  it('中景把文件折叠进模块', () => {
    expect(idsAt('modules')).toEqual(['billing', 'db', 'domain', 'orders']);
  });

  it('远景把模块折叠进分组', () => {
    expect(idsAt('overview')).toEqual(['db', 'domain']);
  });

  it('折叠时报告被卷入的后代数量', () => {
    const graph = buildVisibleGraph(projectState(), { level: 'modules' });
    const orders = graph.nodes.find(({ node }) => node.id === 'orders');

    expect(orders?.rolledUpCount).toBe(2);
  });

  it('中景把两条文件级关系聚合成一条带计数的模块边', () => {
    const graph = buildVisibleGraph(projectState(), { level: 'modules' });
    const aggregated = graph.edges.find((edge) => edge.from === 'orders' && edge.to === 'billing');

    expect(aggregated?.count).toBe(2);
    // 底层类型不一致时不谎报成某一种关系。
    expect(aggregated?.type).toBe('mixed');
    expect(aggregated?.memberIds).toEqual(['e1', 'e2']);
  });

  it('折叠后落在同一节点内部的关系不再画自环', () => {
    const graph = buildVisibleGraph(projectState(), { level: 'overview' });

    expect(graph.edges.every((edge) => edge.from !== edge.to)).toBe(true);
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['domain->db']);
  });

  it('单条关系保留原始 id 与类型', () => {
    const graph = buildVisibleGraph(projectState(), { level: 'modules' });
    const single = graph.edges.find((edge) => edge.id === 'e3');

    expect(single?.type).toBe('writes');
    expect(single?.count).toBe(1);
  });

  it('聚焦模式只保留一层邻域，并报告被裁掉的数量', () => {
    const graph = buildVisibleGraph(projectState(), { level: 'modules', focusNodeId: 'billing' });

    expect(graph.nodes.map(({ node }) => node.id).sort()).toEqual(['billing', 'db', 'orders']);
    expect(graph.clippedNodeCount).toBe(1);
  });

  it('聚焦深度 2 扩展到二层邻域', () => {
    const graph = buildVisibleGraph(projectState(), {
      level: 'modules',
      focusNodeId: 'db',
      focusDepth: 2,
    });

    expect(graph.nodes.map(({ node }) => node.id).sort()).toEqual(['billing', 'db', 'orders']);
  });

  it('聚焦目标在当前层级不可见时退回完整图', () => {
    const graph = buildVisibleGraph(projectState(), {
      level: 'modules',
      focusNodeId: 'orders/a.ts',
    });

    expect(graph.nodes).toHaveLength(4);
    expect(graph.clippedNodeCount).toBe(0);
  });

  it('没有合适祖先的节点不会被丢弃', () => {
    const state = applySnapshot(emptyMapState, {
      document: makeDocument([makeNode('lonely.ts', { type: 'file' })], [], 1),
      capabilities,
      factsRevision: 1,
      drift: [],
    });
    const graph = buildVisibleGraph(state, { level: 'overview' });

    expect(graph.nodes.map(({ node }) => node.id)).toEqual(['lonely.ts']);
  });
});

describe('searchNodes', () => {
  it('命中标签、职责与路径', () => {
    const state = applySnapshot(emptyMapState, {
      document: makeDocument(
        [
          makeNode('n1', { label: '订单模块' }),
          makeNode('n2', { responsibility: '负责订单结算' }),
          makeNode('n3', { paths: ['src/orders/index.ts'] }),
          makeNode('n4', { label: '无关' }),
        ],
        [],
        1,
      ),
      capabilities,
      factsRevision: 1,
      drift: [],
    });

    expect(
      searchNodes(state, '订单')
        .map((node) => node.id)
        .sort(),
    ).toEqual(['n1', 'n2']);
    expect(searchNodes(state, 'orders').map((node) => node.id)).toEqual(['n3']);
  });

  it('空查询不返回结果', () => {
    expect(searchNodes(projectState(), '   ')).toEqual([]);
  });

  it('搜索不受 LOD 折叠影响', () => {
    // a.ts 在中景被折叠进 orders，但仍然必须能被搜到。
    expect(searchNodes(projectState(), 'a.ts').map((node) => node.id)).toEqual(['orders/a.ts']);
  });
});

describe('resolveVisibleAnchor', () => {
  it('把被折叠的命中定位到代表它的可见节点', () => {
    expect(resolveVisibleAnchor(projectState(), 'modules', 'orders/a.ts')).toBe('orders');
    expect(resolveVisibleAnchor(projectState(), 'overview', 'orders/a.ts')).toBe('domain');
    expect(resolveVisibleAnchor(projectState(), 'files', 'orders/a.ts')).toBe('orders/a.ts');
  });

  it('未知节点返回 undefined', () => {
    expect(resolveVisibleAnchor(projectState(), 'modules', 'missing')).toBeUndefined();
  });
});
