import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@god-view/protocol';
import { computeLayout } from './layout/layout.js';
import { toLayoutRequest } from './layout/layout-input.js';
import type { MapState } from './model/store.js';
import { buildVisibleGraph } from './model/view-model.js';

const timestamp = '2026-08-11T00:00:00.000Z';

function graph(size: number): MapState {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (let index = 0; index < size; index += 1) {
    const id = `module.${String(index).padStart(5, '0')}`;
    nodes.set(id, {
      id,
      type: index === 0 ? 'entry' : 'module',
      label: `Module ${String(index)}`,
      source: {
        kind: 'agent_declared',
        actor: { kind: 'agent', adapterId: 'benchmark' },
        declaredAt: timestamp,
      },
      codeValidation: { status: 'unverified' },
      userConfirmation: { status: 'unconfirmed' },
      lifecycle: { status: 'active' },
      updatedAt: timestamp,
      revision: index + 1,
    });
    if (index > 0) {
      const previous = `module.${String(index - 1).padStart(5, '0')}`;
      const edgeId = `edge.${String(index).padStart(5, '0')}`;
      edges.set(edgeId, {
        id: edgeId,
        from: previous,
        to: id,
        type: 'calls',
        source: {
          kind: 'agent_declared',
          actor: { kind: 'agent', adapterId: 'benchmark' },
          declaredAt: timestamp,
        },
        codeValidation: { status: 'unverified' },
        userConfirmation: { status: 'unconfirmed' },
        lifecycle: { status: 'active' },
        updatedAt: timestamp,
        revision: index + 1,
      });
    }
  }
  return {
    revision: size,
    factsRevision: 1,
    nodes,
    edges,
    stories: new Map(),
    annotations: new Map(),
    writeAccessRequests: new Map(),
    changeProposals: new Map(),
    activeChanges: new Map(),
    completedChanges: new Map(),
    drift: [],
    coverage: undefined,
    capabilities: undefined,
    layout: {},
    hydrated: true,
  };
}

function sample(state: MapState, runs: number): readonly number[] {
  const durations: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const visible = buildVisibleGraph(state, { level: 'modules' });
    const result = computeLayout(toLayoutRequest(visible, {}));
    expect(Object.keys(result.positions)).toHaveLength(state.nodes.size);
    durations.push(performance.now() - started);
  }
  return durations;
}

function p95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

describe('大图交互性能预算', () => {
  it('5,000 个节点的投影与首次布局 P95 不超过 3 秒', () => {
    expect(p95(sample(graph(5_000), 5))).toBeLessThanOrEqual(3_000);
  });

  // 连续采样 5 次；测试时限必须大于单次 5 秒性能预算，避免并行负载下
  // 在 P95 断言执行前被 Vitest 自身的 5 秒默认时限终止。
  it('10,000 个语义实体的全图概览 P95 不超过 5 秒', () => {
    expect(p95(sample(graph(10_000), 5))).toBeLessThanOrEqual(5_000);
  }, 30_000);
});
