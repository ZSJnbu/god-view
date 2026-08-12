import { describe, expect, it } from 'vitest';
import { applySnapshot, emptyMapState } from '../model/store.js';
import { buildVisibleGraph } from '../model/view-model.js';
import { capabilities, makeDocument, makeEdge, makeNode } from '../model/fixtures.test-utils.js';
import { toLayoutRequest } from './layout-input.js';

function graphOf(
  nodes: Parameters<typeof makeDocument>[0],
  edges: Parameters<typeof makeDocument>[1] = [],
) {
  const state = applySnapshot(emptyMapState, {
    document: makeDocument(nodes, edges, 1),
    capabilities,
    factsRevision: 1,
    drift: [],
  });
  return { state, graph: buildVisibleGraph(state, { level: 'modules' }) };
}

describe('toLayoutRequest', () => {
  it('按节点类型分配泳道', () => {
    const { graph } = graphOf([
      makeNode('entry', { type: 'entry' }),
      makeNode('db', { type: 'storage' }),
      makeNode('saas', { type: 'external_system' }),
      makeNode('mod'),
    ]);
    const columns = Object.fromEntries(
      toLayoutRequest(graph, {}).nodes.map((node) => [node.id, node.column]),
    );

    expect(columns).toEqual({ entry: 'entry', db: 'storage', saas: 'external', mod: 'core' });
  });

  it('visualHint 可以覆盖泳道，auto 交回类型判断', () => {
    const { graph } = graphOf([
      makeNode('hinted', { visualHint: { preferredPosition: 'external' } }),
      makeNode('auto', { visualHint: { preferredPosition: 'auto' } }),
    ]);
    const columns = Object.fromEntries(
      toLayoutRequest(graph, {}).nodes.map((node) => [node.id, node.column]),
    );

    expect(columns).toEqual({ hinted: 'external', auto: 'core' });
  });

  it('importance 映射成排序权重', () => {
    const { graph } = graphOf([
      makeNode('p', { visualHint: { importance: 'primary' } }),
      makeNode('d', { visualHint: { importance: 'detail' } }),
      makeNode('n'),
    ]);
    const weights = Object.fromEntries(
      toLayoutRequest(graph, {}).nodes.map((node) => [node.id, node.weight]),
    );

    expect(weights).toEqual({ p: 3, d: 1, n: 2 });
  });

  it('只带上当前可见节点的固定坐标', () => {
    const { graph } = graphOf([makeNode('visible')]);
    const pinned = toLayoutRequest(graph, {
      visible: { x: 1, y: 2 },
      'collapsed/file.ts': { x: 9, y: 9 },
    }).pinned;

    expect(pinned).toEqual({ visible: { x: 1, y: 2 } });
  });

  it('关系按可见图的聚合结果传入', () => {
    const { graph } = graphOf(
      [makeNode('a'), makeNode('b')],
      [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'a', 'b', { type: 'calls' })],
    );

    expect(toLayoutRequest(graph, {}).edges).toEqual([{ from: 'a', to: 'b' }]);
  });
});
