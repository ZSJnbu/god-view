import { describe, expect, it } from 'vitest';
import {
  currentProtocolVersion,
  errorCodes,
  type GodViewEvent,
  type Identifier,
} from '@god-view/protocol';
import { createEmptySnapshot, fromSnapshotDocument, toSnapshotDocument } from './snapshot.js';
import { reduce } from './reduce.js';

const now = '2026-08-12T02:00:00.000Z';
let sequence = 0;

function event(
  type: GodViewEvent['type'],
  payload: unknown,
  actor: 'user' | 'agent',
  extra: { readonly baseMapRevision?: number; readonly timestamp?: string } = {},
): GodViewEvent {
  sequence += 1;
  return {
    version: currentProtocolVersion,
    workspaceId: 'ws',
    branchKey: 'main',
    sessionId: actor === 'user' ? 'god-view.user' : 'agent',
    eventId: `proposal-event-${String(sequence)}`,
    timestamp: extra.timestamp ?? now,
    actor: { kind: actor },
    ...(extra.baseMapRevision === undefined ? {} : { baseMapRevision: extra.baseMapRevision }),
    type,
    payload,
  } as GodViewEvent;
}

function apply(snapshot: ReturnType<typeof initial>, next: GodViewEvent) {
  const result = reduce(snapshot, next);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function initial() {
  return createEmptySnapshot({
    workspaceId: 'ws',
    branchKey: 'main',
    baseGitRevision: 'head-1',
    createdAt: now,
  });
}

function annotationCreate(): GodViewEvent {
  return event(
    'annotation_create',
    {
      annotation: {
        id: 'annotation.change',
        type: 'change',
        status: 'sent',
        target: { nodeIds: ['orders'], mapRevision: 1 },
        messages: [{ id: 'question', author: 'user', body: '优化订单', createdAt: now }],
        createdAt: now,
      },
    },
    'user',
  );
}

function seeded() {
  let snapshot = initial();
  snapshot = apply(
    snapshot,
    event('node_upsert', { node: { id: 'orders', type: 'module', label: '订单' } }, 'agent'),
  );
  return apply(snapshot, annotationCreate());
}

function requestEvent(actor: 'user' | 'agent' = 'agent'): GodViewEvent {
  return event(
    'write_access_requested',
    {
      request: {
        id: 'request.change',
        annotationId: 'annotation.change',
        status: 'requested',
        reason: '需要调整订单实现',
        expectedScope: ['src/orders.ts', 'src/orders.test.ts'],
        requestedAt: now,
      },
    },
    actor,
  );
}

function proposalEvent(baseMapRevision: number, plannedFiles = ['src/orders.ts']): GodViewEvent {
  return event(
    'change_proposal',
    {
      proposal: {
        id: 'proposal.change',
        annotationId: 'annotation.change',
        requestId: 'request.change',
        status: 'proposed',
        summary: '调整订单校验',
        plannedFiles,
        structuralChanges: ['更新订单模块'],
        risks: ['兼容性'],
        validationPlan: ['运行订单测试'],
        branchKey: 'main',
        baseMapRevision,
        baseGitRevision: 'head-1',
        createdAt: now,
      },
    },
    'agent',
  );
}

function approvalEvent(mapRevision: number, scope = ['src/orders.ts']): GodViewEvent {
  return event(
    'change_approved',
    {
      proposalId: 'proposal.change',
      approval: {
        token: 'approval-token',
        approvedScope: scope,
        permissionMode: 'monitored',
        approvedAt: now,
        expiresAt: '2026-08-12T02:15:00.000Z',
        branchKey: 'main',
        mapRevision,
        gitRevision: 'head-1',
        preexistingChanges: ['src/user-work.ts'],
      },
    },
    'user',
  );
}

function proposed() {
  const requested = apply(seeded(), requestEvent());
  return apply(requested, proposalEvent(requested.revision));
}

describe('修改方案与批准状态机', () => {
  it('请求和方案都不会创建 ChangeSet，只有有效批准后的 start 才会创建', () => {
    const requested = apply(seeded(), requestEvent());
    expect(requested.activeChanges.size).toBe(0);
    const plan = apply(requested, proposalEvent(requested.revision));
    expect(plan.activeChanges.size).toBe(0);
    const approved = apply(plan, approvalEvent(plan.revision));
    const started = apply(
      approved,
      event(
        'change_start',
        {
          changeSetId: 'change.approved',
          intent: '调整订单校验',
          plannedFiles: ['src/orders.ts'],
          proposalId: 'proposal.change',
          approvalToken: 'approval-token',
        },
        'agent',
        { baseMapRevision: plan.revision },
      ),
    );
    expect(started.activeChanges.get('change.approved')).toMatchObject({
      proposalId: 'proposal.change',
      approvedScope: ['src/orders.ts'],
      permissionMode: 'monitored',
      preexistingChanges: ['src/user-work.ts'],
    });
    expect(started.annotations.get('annotation.change')?.status).toBe('in_progress');
  });

  it('严格区分角色，并拒绝扩大请求或批准范围', () => {
    expect(reduce(seeded(), requestEvent('user')).ok).toBe(false);
    const requested = apply(seeded(), requestEvent());
    const broad = reduce(requested, proposalEvent(requested.revision, ['src/outside.ts']));
    expect(broad.ok ? undefined : broad.error.code).toBe(errorCodes.SCOPE_VIOLATION);
    const plan = apply(requested, proposalEvent(requested.revision));
    const agentApproval = { ...approvalEvent(plan.revision), actor: { kind: 'agent' as const } };
    expect(reduce(plan, agentApproval).ok).toBe(false);
    const broadApproval = reduce(plan, approvalEvent(plan.revision, ['src/orders.test.ts']));
    expect(broadApproval.ok ? undefined : broadApproval.error.code).toBe(
      errorCodes.SCOPE_VIOLATION,
    );
  });

  it('拒绝写入请求的非法角色、关联、状态与重复 ID', () => {
    expect(reduce(seeded(), requestEvent('user')).ok).toBe(false);
    const missing = requestEvent();
    if (missing.type !== 'write_access_requested') throw new Error('test event type');
    expect(
      reduce(seeded(), {
        ...missing,
        payload: { request: { ...missing.payload.request, annotationId: 'missing' } },
      }).ok,
    ).toBe(false);
    const resolved = apply(
      seeded(),
      event('annotation_resolve', { annotationId: 'annotation.change' }, 'user'),
    );
    expect(reduce(resolved, requestEvent()).ok).toBe(false);
    expect(
      reduce(seeded(), {
        ...missing,
        payload: { request: { ...missing.payload.request, status: 'dismissed' } },
      }).ok,
    ).toBe(false);
    const requested = apply(seeded(), requestEvent());
    expect(reduce(requested, requestEvent()).ok).toBe(false);
  });

  it('拒绝方案的非法角色、关联、状态和过期基线', () => {
    const requested = apply(seeded(), requestEvent());
    const plan = proposalEvent(requested.revision);
    expect(reduce(requested, { ...plan, actor: { kind: 'user' } }).ok).toBe(false);
    if (plan.type !== 'change_proposal') throw new Error('test event type');
    expect(
      reduce(requested, {
        ...plan,
        payload: { proposal: { ...plan.payload.proposal, requestId: 'missing' } },
      }).ok,
    ).toBe(false);
    expect(
      reduce(requested, {
        ...plan,
        payload: { proposal: { ...plan.payload.proposal, status: 'approved' } },
      }).ok,
    ).toBe(false);
    expect(
      reduce(requested, {
        ...plan,
        payload: { proposal: { ...plan.payload.proposal, branchKey: 'feature' } },
      }).ok,
    ).toBe(false);
  });

  it('拒绝批准或拒绝不存在、非待处理、过期或越界的方案', () => {
    const plan = proposed();
    expect(reduce(plan, { ...approvalEvent(plan.revision), actor: { kind: 'agent' } }).ok).toBe(
      false,
    );
    expect(
      reduce(
        plan,
        event(
          'change_approved',
          { ...approvalEvent(plan.revision).payload, proposalId: 'missing' },
          'user',
        ),
      ).ok,
    ).toBe(false);
    expect(reduce(plan, approvalEvent(plan.revision, ['outside.ts'])).ok).toBe(false);
    const staleApproval = approvalEvent(plan.revision);
    if (staleApproval.type !== 'change_approved') throw new Error('test event type');
    expect(
      reduce(plan, {
        ...staleApproval,
        payload: {
          ...staleApproval.payload,
          approval: { ...staleApproval.payload.approval, branchKey: 'feature' },
        },
      }).ok,
    ).toBe(false);
    expect(
      reduce(plan, {
        ...staleApproval,
        payload: {
          ...staleApproval.payload,
          approval: { ...staleApproval.payload.approval, expiresAt: now },
        },
      }).ok,
    ).toBe(false);
    const approved = apply(plan, approvalEvent(plan.revision));
    expect(reduce(approved, approvalEvent(approved.revision)).ok).toBe(false);
    expect(
      reduce(plan, event('change_rejected', { proposalId: 'proposal.change' }, 'agent')).ok,
    ).toBe(false);
    expect(reduce(plan, event('change_rejected', { proposalId: 'missing' }, 'user')).ok).toBe(
      false,
    );
    expect(
      reduce(approved, event('change_rejected', { proposalId: 'proposal.change' }, 'user')).ok,
    ).toBe(false);
  });

  it('拒绝陈旧方案、错误令牌、过期令牌和批准后的额外地图事件', () => {
    const requested = apply(seeded(), requestEvent());
    expect(reduce(requested, proposalEvent(requested.revision - 1)).ok).toBe(false);
    const plan = apply(requested, proposalEvent(requested.revision));
    const approved = apply(plan, approvalEvent(plan.revision));
    const buildStart = (token: Identifier, timestamp = now) =>
      event(
        'change_start',
        {
          changeSetId: `change-${token}`,
          intent: '执行',
          plannedFiles: ['src/orders.ts'],
          proposalId: 'proposal.change',
          approvalToken: token,
        },
        'agent',
        { baseMapRevision: plan.revision, timestamp },
      );
    expect(reduce(approved, buildStart('wrong-token')).ok).toBe(false);
    expect(reduce(approved, buildStart('approval-token', '2026-08-12T02:16:00.000Z')).ok).toBe(
      false,
    );
    const advanced = apply(
      approved,
      event('node_upsert', { node: { id: 'other', type: 'module', label: '其它' } }, 'agent'),
    );
    expect(reduce(advanced, buildStart('approval-token')).ok).toBe(false);
  });

  it('用户可以拒绝待处理方案，且拒绝状态可持久化回放', () => {
    const plan = proposed();
    const rejected = apply(
      plan,
      event('change_rejected', { proposalId: 'proposal.change', reason: '风险不可接受' }, 'user'),
    );
    expect(rejected.changeProposals.get('proposal.change')?.status).toBe('rejected');
    expect(rejected.annotations.get('annotation.change')?.status).toBe('rejected');
    const restored = fromSnapshotDocument(toSnapshotDocument(rejected));
    expect(restored.changeProposals.get('proposal.change')?.status).toBe('rejected');
  });

  it('同一工作区仍只允许一个活动 ChangeSet', () => {
    const first = apply(
      initial(),
      event('change_start', { changeSetId: 'first', intent: '建图' }, 'agent'),
    );
    const second = reduce(
      first,
      event('change_start', { changeSetId: 'second', intent: '并发建图' }, 'agent'),
    );
    expect(second.ok ? undefined : second.error.code).toBe(errorCodes.CONCURRENT_CHANGE_SET);
  });

  it('Diff 观察结果随完成记录持久化，越界任务不能伪装为成功', () => {
    const plan = proposed();
    const approved = apply(plan, approvalEvent(plan.revision));
    const started = apply(
      approved,
      event(
        'change_start',
        {
          changeSetId: 'change.diff',
          intent: '修改订单',
          plannedFiles: ['src/orders.ts'],
          proposalId: 'proposal.change',
          approvalToken: 'approval-token',
        },
        'agent',
        { baseMapRevision: plan.revision },
      ),
    );
    const diff = {
      files: [
        {
          path: 'src/orders.ts',
          status: 'modified' as const,
          additions: 2,
          deletions: 1,
          scopeStatus: 'approved' as const,
          attribution: 'change_set' as const,
        },
      ],
      additions: 2,
      deletions: 1,
      computedAt: now,
      contentHash: 'a'.repeat(64),
    };
    const systemObserved = {
      ...event(
        'change_observed',
        { changeSetId: 'change.diff', executionStatus: 'in_progress', diff },
        'user',
      ),
      actor: { kind: 'system' as const },
    };
    const withDiff = reduce(started, systemObserved);
    expect(withDiff.ok).toBe(true);
    if (!withDiff.ok) return;
    const completed = apply(
      withDiff.value,
      event('change_complete', { changeSetId: 'change.diff', status: 'completed' }, 'agent'),
    );
    expect(completed.activeChanges.size).toBe(0);
    expect(completed.completedChanges.get('change.diff')).toMatchObject({
      status: 'pending_review',
      diff: { contentHash: 'a'.repeat(64) },
    });
    expect(fromSnapshotDocument(toSnapshotDocument(completed)).completedChanges.size).toBe(1);
  });

  it('Diff 观察只能来自系统且必须引用活动 ChangeSet，文件按路径规范化', () => {
    const plan = proposed();
    const approved = apply(plan, approvalEvent(plan.revision));
    const started = apply(
      approved,
      event(
        'change_start',
        {
          changeSetId: 'change.observe',
          intent: '修改订单',
          plannedFiles: ['src/orders.ts'],
          proposalId: 'proposal.change',
          approvalToken: 'approval-token',
        },
        'agent',
        { baseMapRevision: plan.revision },
      ),
    );
    const diff = {
      files: [
        {
          path: 'z.ts',
          status: 'modified' as const,
          additions: 1,
          deletions: 0,
          scopeStatus: 'outside_scope' as const,
          attribution: 'change_set' as const,
        },
        {
          path: 'a.ts',
          status: 'modified' as const,
          additions: 1,
          deletions: 0,
          scopeStatus: 'outside_scope' as const,
          attribution: 'change_set' as const,
        },
      ],
      additions: 2,
      deletions: 0,
      computedAt: now,
      contentHash: 'd'.repeat(64),
    };
    expect(
      reduce(
        started,
        event(
          'change_observed',
          { changeSetId: 'change.observe', executionStatus: 'scope_violation', diff },
          'agent',
        ),
      ).ok,
    ).toBe(false);
    const missing = {
      ...event(
        'change_observed',
        { changeSetId: 'missing', executionStatus: 'scope_violation', diff },
        'user',
      ),
      actor: { kind: 'system' as const },
    } as GodViewEvent;
    expect(reduce(started, missing).ok).toBe(false);
    const observed = apply(started, {
      ...missing,
      eventId: 'observe.sorted',
      payload: { changeSetId: 'change.observe', executionStatus: 'scope_violation', diff },
    } as GodViewEvent);
    expect(
      observed.activeChanges.get('change.observe')?.diff?.files.map((file) => file.path),
    ).toEqual(['a.ts', 'z.ts']);
    expect(
      reduce(
        observed,
        event('change_complete', { changeSetId: 'change.observe', status: 'completed' }, 'agent'),
      ).ok,
    ).toBe(false);
  });

  it('只有用户能验收待审查结果，普通接受会被确定性持久化', () => {
    const plan = proposed();
    const approved = apply(plan, approvalEvent(plan.revision));
    const started = apply(
      approved,
      event(
        'change_start',
        {
          changeSetId: 'change.review',
          intent: '修改订单',
          plannedFiles: ['src/orders.ts'],
          proposalId: 'proposal.change',
          approvalToken: 'approval-token',
        },
        'agent',
        { baseMapRevision: plan.revision },
      ),
    );
    const observedEvent = {
      ...event(
        'change_observed',
        {
          changeSetId: 'change.review',
          executionStatus: 'in_progress',
          diff: {
            files: [
              {
                path: 'src/orders.ts',
                status: 'modified',
                additions: 2,
                deletions: 1,
                scopeStatus: 'approved',
                attribution: 'change_set',
              },
            ],
            additions: 2,
            deletions: 1,
            computedAt: now,
            contentHash: 'b'.repeat(64),
          },
        },
        'user',
      ),
      actor: { kind: 'system' as const },
    } as GodViewEvent;
    const observed = apply(started, observedEvent);
    const completed = apply(
      observed,
      event('change_complete', { changeSetId: 'change.review', status: 'completed' }, 'agent'),
    );
    const agentReview = reduce(
      completed,
      event('change_reviewed', { changeSetId: 'change.review', status: 'accepted' }, 'agent'),
    );
    expect(agentReview.ok ? undefined : agentReview.error.code).toBe(errorCodes.UNSUPPORTED);

    const accepted = apply(
      completed,
      event('change_reviewed', { changeSetId: 'change.review', status: 'accepted' }, 'user'),
    );
    expect(accepted.completedChanges.get('change.review')?.status).toBe('accepted');
    expect(accepted.annotations.get('annotation.change')?.status).toBe('resolved');
    const document = toSnapshotDocument(accepted);
    expect(toSnapshotDocument(fromSnapshotDocument(document))).toEqual(document);
    expect(
      reduce(
        accepted,
        event('change_reviewed', { changeSetId: 'change.review', status: 'accepted' }, 'user'),
      ).ok,
    ).toBe(false);
  });

  it('越界 Diff 不能普通接受，但用户可以明确带问题接受', () => {
    const plan = proposed();
    const approved = apply(plan, approvalEvent(plan.revision));
    const started = apply(
      approved,
      event(
        'change_start',
        {
          changeSetId: 'change.outside',
          intent: '修改订单',
          plannedFiles: ['src/orders.ts'],
          proposalId: 'proposal.change',
          approvalToken: 'approval-token',
        },
        'agent',
        { baseMapRevision: plan.revision },
      ),
    );
    const completedChanges = new Map(started.completedChanges);
    completedChanges.set('change.outside', {
      changeSetId: 'change.outside',
      proposalId: 'proposal.change',
      status: 'pending_review',
      completedAt: now,
      plannedFiles: ['src/orders.ts'],
      actualFiles: ['src/outside.ts'],
      diff: {
        files: [
          {
            path: 'src/outside.ts',
            status: 'added',
            additions: 1,
            deletions: 0,
            scopeStatus: 'outside_scope',
            attribution: 'change_set',
          },
        ],
        additions: 1,
        deletions: 0,
        computedAt: now,
        contentHash: 'c'.repeat(64),
      },
    });
    const pending = { ...started, completedChanges };
    const plain = reduce(
      pending,
      event('change_reviewed', { changeSetId: 'change.outside', status: 'accepted' }, 'user'),
    );
    expect(plain.ok ? undefined : plain.error.code).toBe(errorCodes.SCOPE_VIOLATION);
    const preexistingChanges = new Map(completedChanges);
    const outside = preexistingChanges.get('change.outside');
    if (outside === undefined) throw new Error('missing completed change');
    preexistingChanges.set('change.outside', {
      ...outside,
      diff: {
        ...outside.diff,
        files: outside.diff.files.map((file) => ({
          ...file,
          attribution: 'preexisting_overlap' as const,
        })),
      },
    });
    const acceptedPreexisting = apply(
      { ...started, completedChanges: preexistingChanges },
      event('change_reviewed', { changeSetId: 'change.outside', status: 'accepted' }, 'user'),
    );
    expect(acceptedPreexisting.completedChanges.get('change.outside')?.status).toBe('accepted');
    const withIssues = apply(
      pending,
      event(
        'change_reviewed',
        {
          changeSetId: 'change.outside',
          status: 'accepted_with_issues',
          note: '确认保留，但必须继续处理越界文件',
        },
        'user',
      ),
    );
    expect(withIssues.completedChanges.get('change.outside')).toMatchObject({
      status: 'accepted_with_issues',
      note: '确认保留，但必须继续处理越界文件',
    });
  });
});
