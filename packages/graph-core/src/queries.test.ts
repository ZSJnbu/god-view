import { beforeEach, describe, expect, it } from 'vitest';
import {
  findNodesByPath,
  getNeighborhood,
  listChildren,
  listEdges,
  listNodes,
  listRootNodes,
  searchNodes,
} from './queries.js';
import { replay } from './replay.js';
import { createEmptySnapshot, type GraphSnapshot } from './snapshot.js';
import {
  branchKey,
  edge,
  edgeUpsert,
  node,
  nodeRemove,
  nodeUpsert,
  resetEventSequence,
  workspaceId,
} from '@god-view/testkit';

function buildSnapshot(): GraphSnapshot {
  resetEventSequence();
  const initial = createEmptySnapshot({
    workspaceId,
    branchKey,
    createdAt: '2026-08-07T09:00:00.000Z',
  });
  const result = replay(initial, [
    nodeUpsert(node('group.business', { type: 'group', label: '业务' })),
    nodeUpsert(
      node('module.api', {
        type: 'entry',
        label: 'API 入口',
        parentId: 'group.business',
        paths: ['src/api'],
        responsibility: '接收外部请求',
      }),
    ),
    nodeUpsert(
      node('module.orders', {
        label: '订单',
        parentId: 'group.business',
        paths: ['src/orders'],
      }),
    ),
    nodeUpsert(node('module.payment', { label: '支付', paths: ['src/payment'] })),
    nodeUpsert(node('storage.postgres', { type: 'storage', label: 'Postgres' })),
    edgeUpsert(edge('e-api-orders', 'module.api', 'module.orders')),
    edgeUpsert(edge('e-orders-payment', 'module.orders', 'module.payment')),
    edgeUpsert(edge('e-payment-db', 'module.payment', 'storage.postgres')),
  ]);
  expect(result.rejected).toEqual([]);
  return result.snapshot;
}

let snapshot: GraphSnapshot;

beforeEach(() => {
  snapshot = buildSnapshot();
});

describe('可见性', () => {
  it('默认不返回已删除的墓碑实体', () => {
    const removed = replay(snapshot, [nodeRemove('module.payment')]).snapshot;
    expect(listNodes(removed).map((entry) => entry.id)).not.toContain('module.payment');
    expect(listEdges(removed).map((entry) => entry.id)).not.toContain('e-orders-payment');
  });

  it('显式请求时可以查看墓碑，用于历史追溯', () => {
    const removed = replay(snapshot, [nodeRemove('module.payment')]).snapshot;
    const all = listNodes(removed, { includeRemoved: true });
    expect(all.map((entry) => entry.id)).toContain('module.payment');
  });
});

describe('搜索与定位', () => {
  it('按名称搜索', () => {
    expect(searchNodes(snapshot, '订单').map((entry) => entry.id)).toEqual(['module.orders']);
  });

  it('按职责搜索', () => {
    expect(searchNodes(snapshot, '外部请求').map((entry) => entry.id)).toEqual(['module.api']);
  });

  it('按路径搜索', () => {
    expect(searchNodes(snapshot, 'src/payment').map((entry) => entry.id)).toEqual([
      'module.payment',
    ]);
  });

  it('空查询返回空结果而不是全部节点', () => {
    expect(searchNodes(snapshot, '   ')).toEqual([]);
  });

  it('按具体文件路径定位到所属模块', () => {
    expect(findNodesByPath(snapshot, 'src/orders/index.ts').map((entry) => entry.id)).toEqual([
      'module.orders',
    ]);
  });

  it('无归属文件返回空，交由未分类节点承载', () => {
    expect(findNodesByPath(snapshot, 'src/unknown/thing.ts')).toEqual([]);
  });

  it('归一化 ./ 与反斜杠路径', () => {
    expect(findNodesByPath(snapshot, './src\\orders\\index.ts').map((entry) => entry.id)).toEqual([
      'module.orders',
    ]);
  });
});

describe('层级', () => {
  it('列出直接下级', () => {
    expect(listChildren(snapshot, 'group.business').map((entry) => entry.id)).toEqual([
      'module.api',
      'module.orders',
    ]);
  });

  it('一级节点是没有有效父节点的实体', () => {
    expect(listRootNodes(snapshot).map((entry) => entry.id)).toEqual([
      'group.business',
      'module.payment',
      'storage.postgres',
    ]);
  });
});

describe('聚焦邻域', () => {
  it('一层邻域只包含直接上下游', () => {
    const neighborhood = getNeighborhood(snapshot, 'module.orders', 1);
    expect(new Set(neighborhood.nodes.map((entry) => entry.id))).toEqual(
      new Set(['module.orders', 'module.api', 'module.payment']),
    );
    expect(neighborhood.edges).toHaveLength(2);
  });

  it('两层邻域扩展到间接依赖', () => {
    const neighborhood = getNeighborhood(snapshot, 'module.orders', 2);
    expect(neighborhood.nodes.map((entry) => entry.id)).toContain('storage.postgres');
  });

  it('depth 为 0 时只返回目标节点', () => {
    const neighborhood = getNeighborhood(snapshot, 'module.orders', 0);
    expect(neighborhood.nodes.map((entry) => entry.id)).toEqual(['module.orders']);
    expect(neighborhood.edges).toEqual([]);
  });

  it('孤立节点的邻域只有自身', () => {
    const isolated = replay(snapshot, [nodeUpsert(node('module.isolated'))]).snapshot;
    expect(getNeighborhood(isolated, 'module.isolated', 2).nodes).toHaveLength(1);
  });

  it('不存在或已删除的节点返回空邻域', () => {
    expect(getNeighborhood(snapshot, 'module.ghost', 1).nodes).toEqual([]);
    const removed = replay(snapshot, [nodeRemove('module.payment')]).snapshot;
    expect(getNeighborhood(removed, 'module.payment', 1).nodes).toEqual([]);
  });
});
