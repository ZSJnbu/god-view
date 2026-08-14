import { describe, expect, it } from 'vitest';
import {
  currentProtocolVersion,
  errorCodes,
  type ActiveChange,
  type GodViewEvent,
} from '@god-view/protocol';
import { reduce } from './reduce.js';
import { createEmptySnapshot, fromSnapshotDocument, toSnapshotDocument } from './snapshot.js';
import type { GraphSnapshot } from './snapshot.js';

const now = '2026-08-14T01:00:00.000Z';

function activeSnapshot(status: ActiveChange['executionStatus'] = 'in_progress') {
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
    plannedFiles: ['src/orders.ts'],
    touchedNodeIds: [],
    touchedEdgeIds: [],
    approvedScope: ['src/orders.ts'],
    permissionMode: 'monitored',
    executionStatus: status,
  };
  return { ...empty, revision: 5, activeChanges: new Map([[change.changeSetId, change]]) };
}

function requestEvent(revision = 5, files = ['src/orders.test.ts']): GodViewEvent {
  return {
    version: currentProtocolVersion,
    workspaceId: 'ws',
    branchKey: 'main',
    sessionId: 'agent.session',
    eventId: `scope.request.${String(revision)}.${files.join('-')}`,
    timestamp: now,
    actor: { kind: 'agent' },
    baseMapRevision: revision,
    type: 'scope_expansion_requested',
    payload: {
      request: {
        id: 'scope.orders-tests',
        changeSetId: 'change.orders',
        sessionId: 'agent.session',
        requestedFiles: files,
        reason: '需要补充回归测试',
        status: 'pending',
        requestedAt: now,
      },
    },
  };
}

function decideEvent(decision: 'approved' | 'rejected', actor: 'user' | 'agent' = 'user') {
  return {
    version: currentProtocolVersion,
    workspaceId: 'ws',
    branchKey: 'main',
    sessionId: actor === 'user' ? 'god-view.user' : 'agent.session',
    eventId: `scope.${decision}.${actor}`,
    timestamp: '2026-08-14T01:01:00.000Z',
    actor: { kind: actor },
    type: 'scope_expansion_decided',
    payload: {
      changeSetId: 'change.orders',
      requestId: 'scope.orders-tests',
      decision,
    },
  } as GodViewEvent;
}

function apply(snapshot: GraphSnapshot, event: GodViewEvent) {
  const result = reduce(snapshot, event);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('事前扩围审批', () => {
  it('Agent 只能创建 pending 申请，用户批准后才扩大 approvedScope 并保留审计记录', () => {
    const requested = apply(activeSnapshot(), requestEvent());
    expect(requested.activeChanges.get('change.orders')?.approvedScope).toEqual(['src/orders.ts']);
    expect(requested.activeChanges.get('change.orders')?.scopeExpansionRequests).toMatchObject([
      { id: 'scope.orders-tests', status: 'pending', requestedFiles: ['src/orders.test.ts'] },
    ]);

    const approved = apply(requested, decideEvent('approved'));
    expect(approved.activeChanges.get('change.orders')).toMatchObject({
      approvedScope: ['src/orders.test.ts', 'src/orders.ts'],
      plannedFiles: ['src/orders.test.ts', 'src/orders.ts'],
      scopeExpansionRequests: [
        {
          id: 'scope.orders-tests',
          status: 'approved',
          decidedAt: '2026-08-14T01:01:00.000Z',
        },
      ],
    });
    const restored = fromSnapshotDocument(toSnapshotDocument(approved));
    expect(restored.activeChanges.get('change.orders')?.approvedScope).toContain(
      'src/orders.test.ts',
    );
  });

  it('拒绝申请时保持原范围，且 Agent 不能伪造用户决定', () => {
    const requested = apply(activeSnapshot(), requestEvent());
    const forged = reduce(requested, decideEvent('approved', 'agent'));
    expect(forged.ok ? undefined : forged.error.code).toBe(errorCodes.UNSUPPORTED);

    const rejected = apply(requested, decideEvent('rejected'));
    expect(rejected.activeChanges.get('change.orders')?.approvedScope).toEqual(['src/orders.ts']);
    expect(rejected.activeChanges.get('change.orders')?.scopeExpansionRequests?.[0]?.status).toBe(
      'rejected',
    );
  });

  it('拒绝陈旧、会话不匹配、已批准路径和并发申请', () => {
    expect(reduce(activeSnapshot(), requestEvent(4)).ok).toBe(false);
    expect(reduce(activeSnapshot(), requestEvent(5, ['src/orders.ts'])).ok).toBe(false);
    const directoryScope = activeSnapshot();
    const active = directoryScope.activeChanges.get('change.orders');
    if (active === undefined) throw new Error('missing active change');
    const withDirectory = {
      ...directoryScope,
      activeChanges: new Map([['change.orders', { ...active, approvedScope: ['src'] }]]),
    };
    expect(reduce(withDirectory, requestEvent(5, ['src/new.ts'])).ok).toBe(false);
    const mismatched = requestEvent();
    expect(reduce(activeSnapshot(), { ...mismatched, sessionId: 'other.session' }).ok).toBe(false);
    const requested = apply(activeSnapshot(), requestEvent());
    const concurrent = requestEvent(requested.revision, ['src/helper.ts']);
    expect(reduce(requested, { ...concurrent, eventId: 'scope.concurrent' }).ok).toBe(false);
    const predecided = requestEvent();
    if (predecided.type !== 'scope_expansion_requested') throw new Error('unexpected event');
    expect(
      reduce(activeSnapshot(), {
        ...predecided,
        eventId: 'scope.predecided',
        payload: {
          request: {
            ...predecided.payload.request,
            decidedAt: '2026-08-14T01:00:30.000Z',
          },
        },
      }).ok,
    ).toBe(false);
  });

  it('已经发生越界写入时拒绝申请和事后补批', () => {
    expect(reduce(activeSnapshot('scope_violation'), requestEvent()).ok).toBe(false);
    const requested = apply(activeSnapshot(), requestEvent());
    const change = requested.activeChanges.get('change.orders');
    if (change === undefined) throw new Error('missing active change');
    const violated = {
      ...requested,
      activeChanges: new Map([
        ['change.orders', { ...change, executionStatus: 'scope_violation' as const }],
      ]),
    };
    const result = reduce(violated, decideEvent('approved'));
    expect(result.ok ? undefined : result.error.code).toBe(errorCodes.SCOPE_VIOLATION);
  });
});
