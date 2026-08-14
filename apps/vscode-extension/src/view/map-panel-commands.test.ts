import { describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '@god-view/graph-core';
import type { ChangeProposal, CompletedChange, GraphNode } from '@god-view/protocol';
import {
  approvedChangeStartIssue,
  formatApprovedChangeTask,
  projectChangeContextNodeIds,
} from './map-panel-commands.js';

const timestamp = '2026-08-14T00:00:00.000Z';

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: 'module',
    label: id,
    source: { kind: 'agent_declared', actor: { kind: 'agent' }, declaredAt: timestamp },
    codeValidation: { status: 'unverified' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: timestamp,
    revision: 1,
    ...extra,
  };
}

describe('projectChangeContextNodeIds', () => {
  it('未选择节点时只取稳定排序的活跃顶层语义节点', () => {
    const nodes = new Map<string, GraphNode>([
      ['child', node('child', { parentId: 'root.z' })],
      ['file', node('file', { type: 'file' })],
      ['removed', node('removed', { lifecycle: { status: 'removed' } })],
      ['root.z', node('root.z', { type: 'group' })],
      ['root.a', node('root.a', { type: 'entry' })],
    ]);

    expect(projectChangeContextNodeIds(nodes)).toEqual(['root.a', 'root.z']);
  });

  it('异常地图没有根节点时回退到非文件语义节点', () => {
    const nodes = new Map<string, GraphNode>([
      ['module.b', node('module.b', { parentId: 'module.a' })],
      ['module.a', node('module.a', { parentId: 'module.b' })],
      ['file', node('file', { type: 'file', parentId: 'module.a' })],
    ]);

    expect(projectChangeContextNodeIds(nodes)).toEqual(['module.a', 'module.b']);
  });
});

const approvedProposal: ChangeProposal = {
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
  createdAt: timestamp,
  approval: {
    token: 'approval-new-token',
    approvedScope: ['src/orders.ts'],
    permissionMode: 'monitored',
    approvedAt: '2026-08-14T00:10:00.000Z',
    expiresAt: '2026-08-14T00:25:00.000Z',
    branchKey: 'main',
    mapRevision: 2,
    gitRevision: 'head-1',
    preexistingChanges: [],
  },
};

function approvedSnapshot() {
  const empty = createEmptySnapshot({
    workspaceId: 'ws',
    branchKey: 'main',
    baseGitRevision: 'head-1',
    createdAt: timestamp,
  });
  return {
    ...empty,
    revision: 3,
    changeProposals: new Map([[approvedProposal.id, approvedProposal]]),
  };
}

function completed(status: CompletedChange['status'], completedAt: string): CompletedChange {
  return {
    changeSetId: `change.${status}`,
    proposalId: approvedProposal.id,
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

describe('approved change start guard', () => {
  it('有效新授权可以启动，并用 token 生成新的幂等键', () => {
    expect(
      approvedChangeStartIssue(approvedSnapshot(), approvedProposal.id, '2026-08-14T00:20:00Z'),
    ).toBeUndefined();
    expect(formatApprovedChangeTask(approvedProposal)).toContain(
      '"idempotencyKey": "start-approval-new-token"',
    );
  });

  it('过期、活动中和已完成方案返回明确原因', () => {
    expect(
      approvedChangeStartIssue(approvedSnapshot(), approvedProposal.id, '2026-08-14T00:26:00Z')
        ?.code,
    ).toBe('PROPOSAL_REAPPROVAL_REQUIRED');
    const active = {
      ...approvedSnapshot(),
      activeChanges: new Map([
        [
          'change.active',
          {
            changeSetId: 'change.active',
            sessionId: 'session',
            intent: '修改订单',
            startedAt: '2026-08-14T00:20:00Z',
            proposalId: approvedProposal.id,
            touchedNodeIds: [],
            touchedEdgeIds: [],
          },
        ],
      ]),
    };
    expect(
      approvedChangeStartIssue(active, approvedProposal.id, '2026-08-14T00:20:00Z')?.code,
    ).toBe('CHANGE_SET_ACTIVE');
    const done = {
      ...approvedSnapshot(),
      completedChanges: new Map([
        ['change.done', completed('pending_review', '2026-08-14T00:20:00Z')],
      ]),
    };
    expect(approvedChangeStartIssue(done, approvedProposal.id, '2026-08-14T00:21:00Z')?.code).toBe(
      'PROPOSAL_ALREADY_EXECUTED',
    );
  });

  it('旧失败要求重新批准，新批准时间晚于失败后即可启动', () => {
    const failed = {
      ...approvedSnapshot(),
      completedChanges: new Map([['change.failed', completed('failed', '2026-08-14T00:20:00Z')]]),
    };
    expect(
      approvedChangeStartIssue(failed, approvedProposal.id, '2026-08-14T00:21:00Z')?.code,
    ).toBe('PROPOSAL_REAPPROVAL_REQUIRED');
    if (approvedProposal.approval === undefined) throw new Error('missing approval fixture');
    const reapprovedProposal: ChangeProposal = {
      ...approvedProposal,
      approval: {
        ...approvedProposal.approval,
        token: 'approval-retry',
        approvedAt: '2026-08-14T00:22:00Z',
        expiresAt: '2026-08-14T00:37:00Z',
        mapRevision: 3,
      },
    };
    const reapproved = {
      ...failed,
      revision: 4,
      changeProposals: new Map([[approvedProposal.id, reapprovedProposal]]),
    };
    expect(
      approvedChangeStartIssue(reapproved, approvedProposal.id, '2026-08-14T00:23:00Z'),
    ).toBeUndefined();
  });
});
