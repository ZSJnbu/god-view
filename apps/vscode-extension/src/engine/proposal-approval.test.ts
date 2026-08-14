import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, type GraphSnapshot } from '@god-view/graph-core';
import type { BranchKey, ChangeProposal, CompletedChange } from '@god-view/protocol';
import type { GitState } from '../workspace/git-adapter.js';
import { prepareApproval } from './proposal-approval.js';

const now = '2026-08-14T00:20:00.000Z';
const gitState: GitState = {
  branchKey: 'main' as BranchKey,
  headRevision: 'head-1',
  hasGit: true,
  preexistingChanges: [],
};
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
    token: 'approval-old',
    approvedScope: ['src/orders.ts'],
    permissionMode: 'monitored',
    approvedAt: '2026-08-14T00:01:00.000Z',
    expiresAt: '2026-08-14T00:16:00.000Z',
    branchKey: 'main',
    mapRevision: 2,
    gitRevision: 'head-1',
    preexistingChanges: [],
  },
};

function snapshot(extra: Partial<GraphSnapshot> = {}): GraphSnapshot {
  return {
    ...createEmptySnapshot({
      workspaceId: 'ws',
      branchKey: 'main',
      baseGitRevision: 'head-1',
      createdAt: '2026-08-14T00:00:00.000Z',
    }),
    revision: 10,
    changeProposals: new Map([[proposal.id, proposal]]),
    ...extra,
  };
}

function completed(status: CompletedChange['status']): CompletedChange {
  return {
    changeSetId: `change.${status}`,
    proposalId: proposal.id,
    status,
    completedAt: '2026-08-14T00:18:00.000Z',
    plannedFiles: ['src/orders.ts'],
    actualFiles: ['src/orders.ts'],
    diff: {
      files: [],
      additions: 0,
      deletions: 0,
      computedAt: '2026-08-14T00:18:00.000Z',
      contentHash: 'a'.repeat(64),
    },
  };
}

function prepare(current: GraphSnapshot) {
  return prepareApproval({
    snapshot: current,
    gitState,
    proposalId: proposal.id,
    approvedScope: ['src/orders.ts'],
    acknowledgePreexistingChanges: false,
    now,
  });
}

function failureReason(result: ReturnType<typeof prepareApproval>): string {
  if (!('ok' in result)) throw new Error('expected approval failure');
  return result.reason;
}

describe('proposal reapproval safety', () => {
  it('允许失败记录或过期授权由用户重新签发', () => {
    expect(
      prepare(
        snapshot({
          completedChanges: new Map([['change.failed', completed('failed')]]),
        }),
      ),
    ).toMatchObject({ proposal, scope: ['src/orders.ts'] });
    expect(prepare(snapshot())).toMatchObject({ proposal, scope: ['src/orders.ts'] });
  });

  it('活动 ChangeSet 或成功结果不能重新批准', () => {
    const active = prepare(
      snapshot({
        activeChanges: new Map([
          [
            'change.active',
            {
              changeSetId: 'change.active',
              sessionId: 'session',
              intent: '执行中',
              startedAt: now,
              proposalId: proposal.id,
              touchedNodeIds: [],
              touchedEdgeIds: [],
            },
          ],
        ]),
      }),
    );
    expect(failureReason(active)).toContain('正在执行');
    const done = prepare(
      snapshot({
        completedChanges: new Map([['change.done', completed('pending_review')]]),
      }),
    );
    expect(failureReason(done)).toContain('已经执行成功');
  });

  it('Git HEAD 变化时要求重新提交方案，不能只续签旧范围', () => {
    const changedHead = prepareApproval({
      snapshot: snapshot(),
      gitState: { ...gitState, headRevision: 'head-2' },
      proposalId: proposal.id,
      approvedScope: ['src/orders.ts'],
      acknowledgePreexistingChanges: false,
      now,
    });
    expect(failureReason(changedHead)).toContain('Git 基线已经变化');
  });
});
