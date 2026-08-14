import { describe, expect, it } from 'vitest';
import type { ActiveChange, ChangeProposal, CompletedChange } from '@god-view/protocol';
import { proposalExecutionState, proposalRemainsActionable } from './proposal-execution.js';

const proposal: ChangeProposal = {
  id: 'proposal.orders',
  annotationId: 'annotation.orders',
  requestId: 'request.orders',
  status: 'approved',
  summary: '修改订单',
  plannedFiles: ['src/orders.ts'],
  structuralChanges: [],
  risks: [],
  validationPlan: ['pnpm test'],
  branchKey: 'main',
  baseMapRevision: 1,
  baseGitRevision: 'head-1',
  createdAt: '2026-08-14T00:00:00.000Z',
  approval: {
    token: 'approval-token',
    approvedScope: ['src/orders.ts'],
    permissionMode: 'monitored',
    approvedAt: '2026-08-14T00:00:00.000Z',
    expiresAt: '2026-08-14T00:15:00.000Z',
    branchKey: 'main',
    mapRevision: 2,
    gitRevision: 'head-1',
    preexistingChanges: [],
  },
};

function completed(status: CompletedChange['status'], completedAt: string): CompletedChange {
  return {
    changeSetId: `change.${status}`,
    proposalId: proposal.id,
    status,
    completedAt,
    plannedFiles: ['src/orders.ts'],
    actualFiles: ['src/orders.ts'],
    diff: {
      files: [],
      additions: 0,
      deletions: 0,
      computedAt: completedAt,
      contentHash: 'a'.repeat(64),
    },
  };
}

describe('proposal execution state', () => {
  it('把有效授权与过期授权区分开', () => {
    expect(proposalExecutionState(proposal, [], [], Date.parse('2026-08-14T00:10:00Z')).kind).toBe(
      'ready',
    );
    expect(proposalExecutionState(proposal, [], [], Date.parse('2026-08-14T00:16:00Z')).kind).toBe(
      'expired',
    );
  });

  it('活动 ChangeSet 优先于旧失败记录，避免重复启动', () => {
    const active: ActiveChange = {
      changeSetId: 'change.retry',
      sessionId: 'session.retry',
      intent: '重试',
      startedAt: '2026-08-14T00:20:00.000Z',
      proposalId: proposal.id,
      touchedNodeIds: [],
      touchedEdgeIds: [],
    };
    expect(
      proposalExecutionState(proposal, [active], [completed('failed', '2026-08-14T00:10:00Z')], 0)
        .kind,
    ).toBe('active');
  });

  it('失败或中断允许显式重试，成功结果不再显示启动入口', () => {
    const failed = completed('failed', '2026-08-14T00:20:00Z');
    const successful = completed('pending_review', '2026-08-14T00:21:00Z');
    expect(proposalExecutionState(proposal, [], [failed], 0).kind).toBe('retryable');
    expect(proposalRemainsActionable(proposal, [failed])).toBe(true);
    expect(proposalExecutionState(proposal, [], [failed, successful], 0).kind).toBe('completed');
    expect(proposalRemainsActionable(proposal, [failed, successful])).toBe(false);
  });
});
