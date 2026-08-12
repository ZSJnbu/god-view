import { describe, expect, it } from 'vitest';
import {
  applyFacts,
  applyLayout,
  applyPatch,
  applySnapshot,
  emptyMapState,
  type MapState,
} from './store.js';
import type { AnnotationThread, CoverageReport } from '@god-view/protocol';
import { capabilities, makeDocument, makeEdge, makeNode } from './fixtures.test-utils.js';

/** 覆盖率 fixture：分母 total、已分类 classified。 */
function coverageOf(total: number, classified: number): CoverageReport {
  return {
    includedSources: total,
    includedConfigs: 0,
    includedAssets: 0,
    classified,
    unclassified: total - classified,
    excluded: 0,
    failed: 0,
    reasons: [],
    computedAt: '2026-08-07T10:00:00.000Z',
  };
}

function hydrated(): MapState {
  return applySnapshot(emptyMapState, {
    document: makeDocument([makeNode('a'), makeNode('b')], [makeEdge('e1', 'a', 'b')], 3),
    capabilities,
    factsRevision: 1,
    drift: [],
  });
}

describe('applySnapshot', () => {
  it('用快照替换而不是合并既有内容', () => {
    const first = hydrated();
    const second = applySnapshot(first, {
      document: makeDocument([makeNode('c')], [], 4),
      capabilities,
      factsRevision: 1,
      drift: [],
    });

    expect([...second.nodes.keys()]).toEqual(['c']);
    expect(second.edges.size).toBe(0);
    expect(second.revision).toBe(4);
    expect(second.hydrated).toBe(true);
  });

  it('扩展没有存过布局时保留当前布局', () => {
    const withLayout = applyLayout(hydrated(), { a: { x: 10, y: 20 } });
    const next = applySnapshot(withLayout, {
      document: makeDocument([makeNode('a')], [], 4),
      capabilities,
      factsRevision: 1,
      drift: [],
    });

    expect(next.layout).toEqual({ a: { x: 10, y: 20 } });
  });

  it('扩展给出布局时以扩展为准', () => {
    const withLayout = applyLayout(hydrated(), { a: { x: 10, y: 20 } });
    const next = applySnapshot(withLayout, {
      document: makeDocument([makeNode('a')], [], 4),
      capabilities,
      factsRevision: 1,
      drift: [],
      layout: { a: { x: 1, y: 2 } },
    });

    expect(next.layout).toEqual({ a: { x: 1, y: 2 } });
  });
});

describe('applyPatch', () => {
  const annotation: AnnotationThread = {
    id: 'annotation.a',
    type: 'explain',
    status: 'answered',
    target: { nodeIds: ['a'], mapRevision: 3 },
    messages: [
      { id: 'message.q', author: 'user', body: '为什么？', createdAt: '2026-08-07T10:00:00Z' },
      {
        id: 'message.a',
        author: 'agent',
        body: '<script>不是 HTML</script>',
        createdAt: '2026-08-07T10:01:00Z',
      },
    ],
    createdAt: '2026-08-07T10:00:00Z',
  };

  it('增量答案只更新标注，不丢失图实体', () => {
    const state = hydrated();
    const next = applyPatch(state, {
      revision: 4,
      factsRevision: 1,
      patch: {
        upsertedNodes: [],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
        upsertedAnnotations: [annotation],
      },
      drift: [],
    });
    expect(next.annotations.get(annotation.id)?.messages).toHaveLength(2);
    expect(next.nodes).toEqual(state.nodes);
    expect(next.edges).toEqual(state.edges);
  });

  it('应用新增与删除', () => {
    const next = applyPatch(hydrated(), {
      revision: 4,
      factsRevision: 4,
      patch: {
        upsertedNodes: [makeNode('c')],
        upsertedEdges: [makeEdge('e2', 'a', 'c')],
        removedNodeIds: [],
        removedEdgeIds: [],
      },
      drift: [],
    });

    expect([...next.nodes.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect([...next.edges.keys()].sort()).toEqual(['e1', 'e2']);
    expect(next.revision).toBe(4);
  });

  it('删除节点时一并清掉悬空边', () => {
    const next = applyPatch(hydrated(), {
      revision: 4,
      factsRevision: 4,
      patch: {
        upsertedNodes: [],
        upsertedEdges: [],
        removedNodeIds: ['b'],
        removedEdgeIds: [],
      },
      drift: [],
    });

    expect(next.edges.size).toBe(0);
  });

  it('丢弃不比当前新的补丁', () => {
    const state = hydrated();
    const next = applyPatch(state, {
      revision: 3,
      factsRevision: 3,
      patch: {
        upsertedNodes: [makeNode('c')],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
      },
      drift: [],
    });

    expect(next).toBe(state);
  });

  it('首帧快照到达前丢弃补丁', () => {
    const next = applyPatch(emptyMapState, {
      revision: 1,
      factsRevision: 1,
      patch: {
        upsertedNodes: [makeNode('a')],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
      },
      drift: [],
    });

    expect(next).toBe(emptyMapState);
    expect(next.hydrated).toBe(false);
  });

  it('补丁没带覆盖率时沿用上一份', () => {
    const withCoverage = applySnapshot(emptyMapState, {
      document: makeDocument([makeNode('a')], [], 1),
      capabilities,
      factsRevision: 1,
      drift: [],
      coverage: {
        includedSources: 1,
        includedConfigs: 0,
        includedAssets: 0,
        classified: 1,
        unclassified: 0,
        excluded: 0,
        failed: 0,
        reasons: [],
        computedAt: '2026-08-07T10:00:00.000Z',
      },
    });
    const next = applyPatch(withCoverage, {
      revision: 2,
      factsRevision: 2,
      patch: { upsertedNodes: [], upsertedEdges: [], removedNodeIds: [], removedEdgeIds: [] },
      drift: [],
    });

    expect(next.coverage?.classified).toBe(1);
  });
});

describe('applyFacts', () => {
  /**
   * 真实 Extension Host 上暴露的缺陷：删除文件后后端的覆盖率与漂移都对了，
   * 但图版本没变，事实更新被当成过期补丁丢弃，UI 一直停在旧值，直到重新打开面板。
   */
  it('图版本不变时仍然更新漂移与覆盖率', () => {
    const state = hydrated();
    const next = applyFacts(state, {
      factsRevision: 2,
      drift: [{ kind: 'missing_file', detail: 'src/payment/index.ts 已不存在' }],
      coverage: coverageOf(6, 2),
    });

    // 图必须原样不动。
    expect(next.revision).toBe(state.revision);
    expect([...next.nodes.keys()]).toEqual([...state.nodes.keys()]);
    expect([...next.edges.keys()]).toEqual([...state.edges.keys()]);
    // 事实必须变。
    expect(next.drift).toHaveLength(1);
    expect(next.coverage?.classified).toBe(2);
    expect(next.factsRevision).toBe(2);
  });

  it('丢弃不比当前新的事实更新', () => {
    const state = applyFacts(hydrated(), {
      factsRevision: 5,
      drift: [{ kind: 'missing_file', detail: '较新' }],
    });
    const stale = applyFacts(state, {
      factsRevision: 4,
      drift: [{ kind: 'missing_file', detail: '较旧' }],
    });

    expect(stale).toBe(state);
    expect(stale.drift[0]?.detail).toBe('较新');
  });

  it('同一事实版本重复到达不覆盖', () => {
    const state = applyFacts(hydrated(), { factsRevision: 2, drift: [] });
    expect(
      applyFacts(state, { factsRevision: 2, drift: [{ kind: 'missing_file', detail: 'x' }] }),
    ).toBe(state);
  });

  it('首帧快照到达前丢弃事实更新', () => {
    expect(applyFacts(emptyMapState, { factsRevision: 1, drift: [] })).toBe(emptyMapState);
  });

  it('没带覆盖率时沿用上一份', () => {
    const withCoverage = applyFacts(hydrated(), {
      factsRevision: 2,
      drift: [],
      coverage: coverageOf(7, 3),
    });
    const next = applyFacts(withCoverage, { factsRevision: 3, drift: [] });

    expect(next.coverage?.classified).toBe(3);
  });

  it('漂移清空同样是一次有效更新', () => {
    // 恢复文件后旧结论必须被清掉，而不是留在 UI 上。
    const drifted = applyFacts(hydrated(), {
      factsRevision: 2,
      drift: [{ kind: 'missing_file', detail: '缺失' }],
    });
    const recovered = applyFacts(drifted, { factsRevision: 3, drift: [] });

    expect(recovered.drift).toEqual([]);
  });
});

describe('事实版本与图版本相互独立', () => {
  it('快照重置事实基线，避免切分支后新事实被旧基线挡住', () => {
    const advanced = applyFacts(hydrated(), { factsRevision: 9, drift: [] });
    // 切到另一个分支：图版本更小，事实版本从 0 重新开始。
    const switched = applySnapshot(advanced, {
      document: makeDocument([makeNode('other')], [], 1),
      capabilities,
      factsRevision: 0,
      drift: [],
    });

    expect(switched.factsRevision).toBe(0);
    expect(
      applyFacts(switched, {
        factsRevision: 1,
        drift: [{ kind: 'missing_file', detail: '新分支' }],
      }).drift,
    ).toHaveLength(1);
  });

  it('补丁把事实基线向前推进', () => {
    const next = applyPatch(hydrated(), {
      revision: 4,
      factsRevision: 7,
      patch: { upsertedNodes: [], upsertedEdges: [], removedNodeIds: [], removedEdgeIds: [] },
      drift: [],
    });

    expect(next.factsRevision).toBe(7);
    // 比补丁携带的事实版本旧的更新应当被丢弃。
    expect(applyFacts(next, { factsRevision: 6, drift: [] })).toBe(next);
  });
});

describe('applyLayout', () => {
  it('合并而不是替换已有坐标', () => {
    const state = applyLayout(applyLayout(hydrated(), { a: { x: 1, y: 1 } }), {
      b: { x: 2, y: 2 },
    });

    expect(state.layout).toEqual({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } });
  });
});
