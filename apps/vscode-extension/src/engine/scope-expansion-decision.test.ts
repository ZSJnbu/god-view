import { describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot, type GraphSnapshot } from '@god-view/graph-core';
import { currentProtocolVersion, type ActiveChange, type GodViewEvent } from '@god-view/protocol';
import { decidePendingScopeExpansion } from './scope-expansion-decision.js';
import type { GitState } from '../workspace/git-adapter.js';

const now = '2026-08-14T01:00:00.000Z';

function snapshot(): GraphSnapshot {
  const empty = createEmptySnapshot({
    workspaceId: 'ws',
    branchKey: 'main',
    baseGitRevision: 'head-1',
    createdAt: now,
  });
  const change: ActiveChange = {
    changeSetId: 'change.orders',
    sessionId: 'agent.session',
    intent: '修改订单',
    startedAt: now,
    touchedNodeIds: [],
    touchedEdgeIds: [],
    approvedScope: ['src/orders.ts'],
    permissionMode: 'monitored',
    baseGitRevision: 'head-1',
    scopeExpansionRequests: [
      {
        id: 'scope.tests',
        changeSetId: 'change.orders',
        sessionId: 'agent.session',
        requestedFiles: ['src/orders.test.ts'],
        reason: '补充测试',
        status: 'pending',
        requestedAt: now,
      },
    ],
  };
  return { ...empty, activeChanges: new Map([[change.changeSetId, change]]) };
}

function decisionEvent(state: GraphSnapshot): GodViewEvent {
  return {
    version: currentProtocolVersion,
    workspaceId: state.workspaceId,
    branchKey: state.branchKey,
    sessionId: 'god-view.user',
    eventId: 'user.scope.approve',
    timestamp: now,
    actor: { kind: 'user' },
    type: 'scope_expansion_decided',
    payload: {
      changeSetId: 'change.orders',
      requestId: 'scope.tests',
      decision: 'approved',
    },
  };
}

describe('宿主扩围决定', () => {
  it('Git 基线一致时先观察最新 Diff，再提交用户决定', async () => {
    const state = snapshot();
    const order: string[] = [];
    const result = await decidePendingScopeExpansion({
      snapshot: () => state,
      readGit: () =>
        Promise.resolve({
          branchKey: 'main' as GitState['branchKey'],
          headRevision: 'head-1',
          hasGit: true,
          preexistingChanges: [],
        }),
      rememberGit: () => order.push('git'),
      observe: () => {
        order.push('observe');
        return Promise.resolve();
      },
      buildEvent: (current) => {
        order.push('build');
        return decisionEvent(current);
      },
      apply: () => {
        order.push('apply');
        return Promise.resolve({ accepted: true, mapRevision: 2, errors: [] });
      },
      changeSetId: 'change.orders',
      requestId: 'scope.tests',
    });

    expect(result).toBe(true);
    expect(order).toEqual(['git', 'observe', 'build', 'apply']);
  });

  it('Git HEAD 已变化时拒绝扩大范围且不产生用户事件', async () => {
    const state = snapshot();
    const observe = vi.fn(() => Promise.resolve());
    const apply = vi.fn(() => Promise.resolve({ accepted: true, mapRevision: 2, errors: [] }));
    const result = await decidePendingScopeExpansion({
      snapshot: () => state,
      readGit: () =>
        Promise.resolve({
          branchKey: 'main' as GitState['branchKey'],
          headRevision: 'head-2',
          hasGit: true,
          preexistingChanges: [],
        }),
      rememberGit: vi.fn(),
      observe,
      buildEvent: decisionEvent,
      apply,
      changeSetId: 'change.orders',
      requestId: 'scope.tests',
    });

    expect(result).toBe(false);
    expect(observe).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
