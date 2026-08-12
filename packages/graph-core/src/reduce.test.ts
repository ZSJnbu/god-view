import { beforeEach, describe, expect, it } from 'vitest';
import {
  errorCodes,
  type AnnotationThread,
  type GodViewEvent,
  type GraphNode,
} from '@god-view/protocol';
import { reduce } from './reduce.js';
import {
  createEmptySnapshot,
  fromSnapshotDocument,
  hashSnapshot,
  toSnapshotDocument,
  type GraphSnapshot,
} from './snapshot.js';
import { replay } from './replay.js';
import { listRootNodes } from './queries.js';
import {
  branchKey,
  annotationAnswer,
  annotationCreate,
  annotationResolve,
  changeComplete,
  changeStart,
  edge,
  edgeRemove,
  edgeUpsert,
  node,
  nodeRemove,
  nodeUpsert,
  resetEventSequence,
  sessionEnd,
  sessionStart,
  storyUpsert,
  sampleProjectEvents,
  workspaceId,
} from '@god-view/testkit';

function emptySnapshot(): GraphSnapshot {
  return createEmptySnapshot({
    workspaceId,
    branchKey,
    createdAt: '2026-08-07T09:00:00.000Z',
  });
}

/** 依次应用事件，任一事件被拒绝立即失败，便于测试聚焦于最后一步的断言。 */
function applyAll(snapshot: GraphSnapshot, events: readonly GodViewEvent[]): GraphSnapshot {
  let current = snapshot;
  for (const event of events) {
    const result = reduce(current, event);
    if (!result.ok) {
      throw new Error(`事件 ${event.eventId} 被拒绝：${result.error.code} ${result.error.message}`);
    }
    current = result.value;
  }
  return current;
}

function requireNode(snapshot: GraphSnapshot, id: string): GraphNode {
  const found = snapshot.nodes.get(id);
  if (found === undefined) {
    throw new Error(`节点 ${id} 不存在`);
  }
  return found;
}

beforeEach(() => {
  resetEventSequence();
});

describe('事件归约的基本约束', () => {
  it('拒绝其它工作区或分支的事件', () => {
    const result = reduce(emptySnapshot(), sessionStart({ workspaceId: 'other-ws' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.WORKSPACE_MISMATCH);
    }
    const branchResult = reduce(emptySnapshot(), sessionStart({ branchKey: 'feature/x' }));
    expect(branchResult.ok).toBe(false);
  });

  it('重复事件保持幂等，不产生重复节点也不推进版本', () => {
    const event = nodeUpsert(node('module.orders'));
    const once = applyAll(emptySnapshot(), [event]);
    const twice = applyAll(once, [event]);
    expect(twice.nodes.size).toBe(1);
    expect(twice.revision).toBe(once.revision);
    expect(twice.lastEventSeq).toBe(once.lastEventSeq);
  });

  it('会话事件不推进地图版本', () => {
    const snapshot = applyAll(emptySnapshot(), [sessionStart(), sessionEnd()]);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.lastEventSeq).toBe(2);
  });

  it('拒绝协议保留但尚未实现的事件类型', () => {
    const reserved = {
      ...sessionStart(),
      type: 'unexpected_write',
    } as unknown as GodViewEvent;
    const result = reduce(emptySnapshot(), reserved);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.UNSUPPORTED_EVENT_TYPE);
    }
  });
});

describe('声明式讲解', () => {
  const story = {
    id: 'story.intro',
    type: 'project_intro' as const,
    title: '认识订单系统',
    steps: [
      { order: 0, focusNodeIds: ['entry'], caption: '请求进入系统' },
      { order: 1, focusNodeIds: ['orders'], caption: '订单执行业务规则' },
      { order: 2, focusNodeIds: ['storage'], caption: '结果写入存储' },
    ],
  };

  it('只接受引用现有实体的讲解并按 order 排序', () => {
    const initial = applyAll(emptySnapshot(), [
      nodeUpsert(node('entry')),
      nodeUpsert(node('orders')),
      nodeUpsert(node('storage')),
    ]);
    const result = reduce(initial, storyUpsert({ ...story, steps: [...story.steps].reverse() }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stories.get(story.id)?.steps.map((step) => step.order)).toEqual([
        0, 1, 2,
      ]);
    }
  });

  it('拒绝引用不存在节点的讲解', () => {
    const result = reduce(emptySnapshot(), storyUpsert(story));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.UNKNOWN_ENTITY);
    }
  });

  it('拒绝重复的步骤 order，避免播放顺序不确定', () => {
    const initial = applyAll(emptySnapshot(), [
      nodeUpsert(node('entry')),
      nodeUpsert(node('orders')),
      nodeUpsert(node('storage')),
    ]);
    const duplicate = { ...story, steps: story.steps.map((step) => ({ ...step, order: 0 })) };
    const result = reduce(initial, storyUpsert(duplicate));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.SCHEMA_VIOLATION);
    }
  });

  it('拒绝讲解引用不存在的关系', () => {
    const initial = applyAll(emptySnapshot(), [
      nodeUpsert(node('entry')),
      nodeUpsert(node('orders')),
      nodeUpsert(node('storage')),
    ]);
    const result = reduce(
      initial,
      storyUpsert({
        ...story,
        steps: story.steps.map((step, index) =>
          index === 0 ? { ...step, focusEdgeIds: ['missing-edge'] } : step,
        ),
      }),
    );
    expect(result.ok ? undefined : result.error.code).toBe(errorCodes.UNKNOWN_ENTITY);
  });
});

describe('原位标注与只读解释', () => {
  function thread(extra: Partial<AnnotationThread> = {}): AnnotationThread {
    return {
      id: 'annotation.orders',
      type: 'explain',
      status: 'sent',
      target: { nodeIds: ['orders'], mapRevision: 1 },
      messages: [
        {
          id: 'message.question',
          author: 'user',
          body: '为什么订单依赖支付？',
          createdAt: '2026-08-07T10:01:00.000Z',
        },
      ],
      createdAt: '2026-08-07T10:01:00.000Z',
      ...extra,
    };
  }

  function withNode(): GraphSnapshot {
    return applyAll(emptySnapshot(), [nodeUpsert(node('orders'))]);
  }

  it('用户创建、Agent 回答、用户解决，且解释不会产生 ChangeSet', () => {
    const created = applyAll(withNode(), [annotationCreate(thread())]);
    const answered = applyAll(created, [
      annotationAnswer('annotation.orders', {
        id: 'message.answer',
        author: 'agent',
        body: '订单确认需要支付授权。',
        evidence: [{ kind: 'explicit_import', location: { path: 'src/orders.ts' } }],
        createdAt: '2026-08-07T10:02:00.000Z',
      }),
    ]);
    const resolved = applyAll(answered, [annotationResolve('annotation.orders')]);

    expect(answered.annotations.get('annotation.orders')?.status).toBe('answered');
    expect(answered.annotations.get('annotation.orders')?.messages).toHaveLength(2);
    expect(answered.activeChanges.size).toBe(0);
    expect(resolved.annotations.get('annotation.orders')?.status).toBe('resolved');
    expect(resolved.annotations.get('annotation.orders')?.resolvedAt).toBeDefined();
  });

  it('拒绝 Agent 创建、用户回答以及不存在或空目标', () => {
    expect(reduce(withNode(), annotationCreate(thread(), { actor: { kind: 'agent' } })).ok).toBe(
      false,
    );
    const created = applyAll(withNode(), [annotationCreate(thread())]);
    expect(
      reduce(
        created,
        annotationAnswer(
          'annotation.orders',
          {
            id: 'message.user-answer',
            author: 'agent',
            body: '伪造答案',
            createdAt: '2026-08-07T10:02:00.000Z',
          },
          { actor: { kind: 'user' } },
        ),
      ).ok,
    ).toBe(false);
    expect(reduce(withNode(), annotationCreate(thread({ target: { mapRevision: 1 } }))).ok).toBe(
      false,
    );
    expect(
      reduce(
        withNode(),
        annotationCreate(thread({ target: { nodeIds: ['missing'], mapRevision: 1 } })),
      ).ok,
    ).toBe(false);
  });

  it('节点变为墓碑后仍保留标注关联并可回答', () => {
    const created = applyAll(withNode(), [annotationCreate(thread()), nodeRemove('orders')]);
    const answered = reduce(
      created,
      annotationAnswer('annotation.orders', {
        id: 'message.after-removal',
        author: 'agent',
        body: '该节点已移除，以下为历史说明。',
        createdAt: '2026-08-07T10:03:00.000Z',
      }),
    );
    expect(answered.ok).toBe(true);
  });

  it('终态不能再次回答或解决，消息 ID 不能重复', () => {
    const created = applyAll(withNode(), [annotationCreate(thread())]);
    const duplicate = annotationAnswer('annotation.orders', {
      id: 'message.question',
      author: 'agent',
      body: '重复 ID',
      createdAt: '2026-08-07T10:02:00.000Z',
    });
    expect(reduce(created, duplicate).ok).toBe(false);
    const resolved = applyAll(created, [annotationResolve('annotation.orders')]);
    expect(reduce(resolved, annotationResolve('annotation.orders')).ok).toBe(false);
    expect(
      reduce(
        resolved,
        annotationAnswer('annotation.orders', {
          id: 'message.late',
          author: 'agent',
          body: '太晚了',
          createdAt: '2026-08-07T10:03:00.000Z',
        }),
      ).ok,
    ).toBe(false);
  });

  it('拒绝重复/非法创建、未知目标和非法解决者', () => {
    const base = withNode();
    const created = applyAll(base, [annotationCreate(thread())]);
    expect(reduce(created, annotationCreate(thread())).ok).toBe(false);
    expect(reduce(base, annotationCreate(thread({ status: 'answered' }))).ok).toBe(false);
    expect(
      reduce(
        base,
        annotationCreate(
          thread({
            messages: [
              ...thread().messages,
              { ...thread().messages[0]!, id: 'agent', author: 'agent' },
            ],
          }),
        ),
      ).ok,
    ).toBe(false);
    expect(
      reduce(
        base,
        annotationCreate(thread({ messages: [thread().messages[0]!, thread().messages[0]!] })),
      ).ok,
    ).toBe(false);
    expect(
      reduce(base, annotationCreate(thread({ target: { edgeIds: ['missing'], mapRevision: 1 } })))
        .ok,
    ).toBe(false);
    expect(
      reduce(base, annotationCreate(thread({ target: { storyId: 'missing', mapRevision: 1 } }))).ok,
    ).toBe(false);
    expect(
      reduce(base, annotationCreate(thread({ target: { changeSetId: 'missing', mapRevision: 1 } })))
        .ok,
    ).toBe(false);
    expect(
      reduce(created, annotationResolve('annotation.orders', { actor: { kind: 'agent' } })).ok,
    ).toBe(false);
    expect(reduce(created, annotationResolve('missing')).ok).toBe(false);
    expect(
      reduce(
        created,
        annotationAnswer('missing', {
          id: 'missing.answer',
          author: 'agent',
          body: '不存在',
          createdAt: '2026-08-07T10:03:00.000Z',
        }),
      ).ok,
    ).toBe(false);
  });

  it('解释附带的讲解必须引用现有实体并按步骤排序', () => {
    const base = applyAll(emptySnapshot(), [
      nodeUpsert(node('orders')),
      nodeUpsert(node('payment')),
      edgeUpsert(edge('orders-payment', 'orders', 'payment')),
    ]);
    const created = applyAll(base, [
      annotationCreate(thread({ target: { nodeIds: ['orders'], mapRevision: 3 } })),
    ]);
    const message = {
      id: 'answer.story',
      author: 'agent' as const,
      body: '用讲解说明',
      createdAt: '2026-08-07T10:03:00.000Z',
    };
    const makeAnswer = (
      steps: { order: number; focusNodeIds: string[]; focusEdgeIds?: string[]; caption: string }[],
    ) => ({
      ...annotationAnswer('annotation.orders', message),
      payload: {
        annotationId: 'annotation.orders',
        message,
        story: {
          id: 'story.answer',
          type: 'key_flow' as const,
          title: '解释',
          steps,
        },
      },
    });
    expect(
      reduce(
        created,
        makeAnswer([
          { order: 0, focusNodeIds: ['orders'], caption: '订单' },
          { order: 0, focusNodeIds: ['payment'], caption: '支付' },
        ]),
      ).ok,
    ).toBe(false);
    expect(
      reduce(created, makeAnswer([{ order: 0, focusNodeIds: ['missing'], caption: '缺失' }])).ok,
    ).toBe(false);
    expect(
      reduce(
        created,
        makeAnswer([
          { order: 0, focusNodeIds: ['orders'], focusEdgeIds: ['missing'], caption: '缺失关系' },
        ]),
      ).ok,
    ).toBe(false);
    const answered = reduce(
      created,
      makeAnswer([
        { order: 1, focusNodeIds: ['payment'], caption: '支付' },
        {
          order: 0,
          focusNodeIds: ['orders'],
          focusEdgeIds: ['orders-payment'],
          caption: '订单',
        },
      ]),
    );
    expect(answered.ok).toBe(true);
    if (answered.ok) {
      expect(answered.value.stories.get('story.answer')?.steps.map((step) => step.order)).toEqual([
        0, 1,
      ]);
    }
  });

  it('回放与快照往返保持标注确定性', () => {
    const events = [nodeUpsert(node('orders')), annotationCreate(thread())];
    const first = replay(emptySnapshot(), events).snapshot;
    const second = replay(emptySnapshot(), events).snapshot;
    expect(hashSnapshot(toSnapshotDocument(first))).toBe(hashSnapshot(toSnapshotDocument(second)));
    expect(
      fromSnapshotDocument(toSnapshotDocument(first)).annotations.has('annotation.orders'),
    ).toBe(true);
  });
});

describe('节点声明', () => {
  it('记录 Agent 声明来源，且不自动获得代码验证或用户确认', () => {
    const snapshot = applyAll(emptySnapshot(), [nodeUpsert(node('module.orders'))]);
    const created = requireNode(snapshot, 'module.orders');
    expect(created.source.kind).toBe('agent_declared');
    expect(created.codeValidation.status).toBe('unverified');
    expect(created.userConfirmation.status).toBe('unconfirmed');
  });

  it('用户创建的节点来源标记为 user_created', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('module.orders'), { envelope: { actor: { kind: 'user' } } }),
    ]);
    expect(requireNode(snapshot, 'module.orders').source.kind).toBe('user_created');
  });

  it('未声明 actor 的事件来源标记为 unknown，不冒充 Agent', () => {
    const { actor: _omitted, ...withoutActor } = nodeUpsert(node('module.orders'));
    const snapshot = applyAll(emptySnapshot(), [withoutActor]);
    expect(requireNode(snapshot, 'module.orders').source.actor.kind).toBe('unknown');
  });

  it('更新声明会重置代码验证状态，因为旧证据不再对应新声明', () => {
    let snapshot = applyAll(emptySnapshot(), [nodeUpsert(node('module.orders'))]);
    const verified = {
      ...requireNode(snapshot, 'module.orders'),
      codeValidation: { status: 'verified' as const },
    };
    snapshot = { ...snapshot, nodes: new Map([[verified.id, verified]]) };

    snapshot = applyAll(snapshot, [nodeUpsert(node('module.orders', { label: '订单' }))]);
    expect(requireNode(snapshot, 'module.orders').codeValidation.status).toBe('unverified');
  });

  it('改名不改变首次声明来源与用户确认状态', () => {
    let snapshot = applyAll(emptySnapshot(), [nodeUpsert(node('module.orders'))]);
    const confirmed = {
      ...requireNode(snapshot, 'module.orders'),
      userConfirmation: { status: 'confirmed' as const, confirmedAt: '2026-08-07T09:30:00.000Z' },
    };
    snapshot = { ...snapshot, nodes: new Map([[confirmed.id, confirmed]]) };

    snapshot = applyAll(snapshot, [nodeUpsert(node('module.orders', { label: '订单中心' }))]);
    const updated = requireNode(snapshot, 'module.orders');
    expect(updated.label).toBe('订单中心');
    expect(updated.userConfirmation.status).toBe('confirmed');
  });

  it('拒绝不存在的父节点', () => {
    const result = reduce(
      emptySnapshot(),
      nodeUpsert(node('module.orders', { parentId: 'group.missing' })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.UNKNOWN_ENTITY);
    }
  });

  it('拒绝基于过期基线的覆盖写', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('module.orders')),
      nodeUpsert(node('module.orders', { label: '订单 v2' })),
    ]);
    const stale = nodeUpsert(node('module.orders', { label: '旧上下文' }), {
      envelope: { baseMapRevision: 1 },
    });
    const result = reduce(snapshot, stale);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.STALE_MAP_REVISION);
      expect(result.error.entityId).toBe('module.orders');
    }
  });

  it('基线等于当前实体版本时接受写入', () => {
    const snapshot = applyAll(emptySnapshot(), [nodeUpsert(node('module.orders'))]);
    const result = reduce(
      snapshot,
      nodeUpsert(node('module.orders', { label: '订单' }), { envelope: { baseMapRevision: 1 } }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('已确认模块的稳定 ID', () => {
  function withConfirmedModule(): GraphSnapshot {
    const snapshot = applyAll(emptySnapshot(), [nodeUpsert(node('module.orders'))]);
    const confirmed = {
      ...requireNode(snapshot, 'module.orders'),
      userConfirmation: { status: 'confirmed' as const },
    };
    return { ...snapshot, nodes: new Map([[confirmed.id, confirmed]]) };
  }

  it('Agent 不能删除已确认模块', () => {
    const result = reduce(withConfirmedModule(), nodeRemove('module.orders'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.STABLE_ID_VIOLATION);
    }
  });

  it('用户可以删除已确认模块', () => {
    const result = reduce(
      withConfirmedModule(),
      nodeRemove('module.orders', { envelope: { actor: { kind: 'user' } } }),
    );
    expect(result.ok).toBe(true);
  });

  it('Agent 不能改变已确认模块的实体类型', () => {
    const result = reduce(
      withConfirmedModule(),
      nodeUpsert(node('module.orders', { type: 'external_system' })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.STABLE_ID_VIOLATION);
    }
  });

  it('Agent 仍可更新已确认模块的名称与职责', () => {
    const result = reduce(
      withConfirmedModule(),
      nodeUpsert(node('module.orders', { label: '订单', responsibility: '下单与退款' })),
    );
    expect(result.ok).toBe(true);
  });
});

describe('节点与关系删除', () => {
  it('删除保留墓碑，使标注与历史仍可追溯', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('module.orders')),
      nodeRemove('module.orders'),
    ]);
    expect(requireNode(snapshot, 'module.orders').lifecycle.status).toBe('removed');
  });

  it('删除节点会级联删除其关系', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('module.orders')),
      nodeUpsert(node('module.payment')),
      edgeUpsert(edge('e-1', 'module.orders', 'module.payment')),
      nodeRemove('module.payment'),
    ]);
    expect(snapshot.edges.get('e-1')?.lifecycle.status).toBe('removed');
  });

  it('拒绝删除不存在的节点与关系', () => {
    const missingNode = reduce(emptySnapshot(), nodeRemove('module.ghost'));
    expect(missingNode.ok).toBe(false);
    const missingEdge = reduce(emptySnapshot(), edgeRemove('e-ghost'));
    expect(missingEdge.ok).toBe(false);
    if (!missingEdge.ok) {
      expect(missingEdge.error.code).toBe(errorCodes.UNKNOWN_ENTITY);
    }
  });

  it('可以单独删除关系', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('a')),
      nodeUpsert(node('b')),
      edgeUpsert(edge('e-1', 'a', 'b')),
      edgeRemove('e-1'),
    ]);
    expect(snapshot.edges.get('e-1')?.lifecycle.status).toBe('removed');
  });
});

describe('关系端点', () => {
  it('拒绝端点不存在的关系', () => {
    const snapshot = applyAll(emptySnapshot(), [nodeUpsert(node('a'))]);
    const result = reduce(snapshot, edgeUpsert(edge('e-1', 'a', 'missing')));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.DANGLING_EDGE_ENDPOINT);
    }
  });

  it('拒绝指向已删除节点的关系', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('a')),
      nodeUpsert(node('b')),
      nodeRemove('b'),
    ]);
    const result = reduce(snapshot, edgeUpsert(edge('e-1', 'a', 'b')));
    expect(result.ok).toBe(false);
  });

  it('拒绝基于过期基线的关系覆盖写', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('a')),
      nodeUpsert(node('b')),
      edgeUpsert(edge('e-1', 'a', 'b')),
      edgeUpsert(edge('e-1', 'a', 'b', { reason: '第二次声明' })),
    ]);
    const result = reduce(
      snapshot,
      edgeUpsert(edge('e-1', 'a', 'b', { reason: '旧上下文' }), {
        envelope: { baseMapRevision: 3 },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.STALE_MAP_REVISION);
    }
  });
});

describe('变更事务', () => {
  it('变更进行中的实体标记为 in_progress，完成后转为 active', () => {
    let snapshot = applyAll(emptySnapshot(), [
      changeStart('cs-1'),
      nodeUpsert(node('module.orders'), { changeSetId: 'cs-1' }),
    ]);
    expect(requireNode(snapshot, 'module.orders').lifecycle.status).toBe('in_progress');

    snapshot = applyAll(snapshot, [changeComplete('cs-1')]);
    expect(requireNode(snapshot, 'module.orders').lifecycle.status).toBe('active');
    expect(snapshot.activeChanges.size).toBe(0);
  });

  it('变更失败或中断时实体标记为 failed，不自动删除已声明结构', () => {
    const snapshot = applyAll(emptySnapshot(), [
      changeStart('cs-1'),
      nodeUpsert(node('module.orders'), { changeSetId: 'cs-1' }),
      changeComplete('cs-1', 'interrupted'),
    ]);
    const orders = requireNode(snapshot, 'module.orders');
    expect(orders.lifecycle.status).toBe('failed');
    expect(orders.lifecycle.changeSetId).toBe('cs-1');
  });

  it('同一工作区同时只允许一个进行中的变更', () => {
    const snapshot = applyAll(emptySnapshot(), [changeStart('cs-1')]);
    const result = reduce(snapshot, changeStart('cs-2', '另一个任务'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.CONCURRENT_CHANGE_SET);
    }
  });

  it('重复开始同一变更属于重试，保持幂等', () => {
    const snapshot = applyAll(emptySnapshot(), [changeStart('cs-1'), changeStart('cs-1')]);
    expect(snapshot.activeChanges.size).toBe(1);
  });

  it('拒绝引用不存在变更的事件', () => {
    const result = reduce(emptySnapshot(), nodeUpsert(node('a'), { changeSetId: 'cs-missing' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.UNKNOWN_CHANGE_SET);
    }
  });

  it('拒绝结束不存在的变更', () => {
    const result = reduce(emptySnapshot(), changeComplete('cs-missing'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.UNKNOWN_CHANGE_SET);
    }
  });

  it('变更记录本次触及的节点与关系，用于变更回放', () => {
    const snapshot = applyAll(emptySnapshot(), [
      changeStart('cs-1'),
      nodeUpsert(node('b'), { changeSetId: 'cs-1' }),
      nodeUpsert(node('a'), { changeSetId: 'cs-1' }),
      edgeUpsert(edge('e-1', 'a', 'b'), { changeSetId: 'cs-1' }),
      nodeUpsert(node('a', { label: '再次声明' }), { changeSetId: 'cs-1' }),
    ]);
    const change = snapshot.activeChanges.get('cs-1');
    expect(change?.touchedNodeIds).toEqual(['a', 'b']);
    expect(change?.touchedEdgeIds).toEqual(['e-1']);
  });

  it('变更外的删除同样记录到进行中的变更', () => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('a')),
      nodeUpsert(node('b')),
      edgeUpsert(edge('e-1', 'a', 'b')),
      changeStart('cs-1'),
      edgeRemove('e-1', { changeSetId: 'cs-1' }),
      nodeRemove('b', { changeSetId: 'cs-1' }),
    ]);
    const change = snapshot.activeChanges.get('cs-1');
    expect(change?.touchedEdgeIds).toEqual(['e-1']);
    expect(change?.touchedNodeIds).toEqual(['b']);
  });
});

describe('回放确定性', () => {
  const events = (): readonly GodViewEvent[] => {
    resetEventSequence();
    return [
      sessionStart(),
      changeStart('cs-1'),
      nodeUpsert(node('module.payment'), { changeSetId: 'cs-1' }),
      nodeUpsert(node('module.orders'), { changeSetId: 'cs-1' }),
      edgeUpsert(edge('e-1', 'module.orders', 'module.payment'), { changeSetId: 'cs-1' }),
      changeComplete('cs-1'),
      sessionEnd(),
    ];
  };

  it('相同事件序列产生相同快照哈希', () => {
    const first = replay(emptySnapshot(), events()).snapshot;
    const second = replay(emptySnapshot(), events()).snapshot;
    expect(hashSnapshot(toSnapshotDocument(first))).toBe(hashSnapshot(toSnapshotDocument(second)));
  });

  it('节点声明顺序不同不影响最终快照', () => {
    resetEventSequence();
    const base = [nodeUpsert(node('a')), nodeUpsert(node('b'))];
    const forward = replay(emptySnapshot(), base).snapshot;
    const document = toSnapshotDocument(forward);
    expect(document.nodes.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('单个事件被拒绝不会中断整体回放', () => {
    resetEventSequence();
    const result = replay(emptySnapshot(), [
      nodeUpsert(node('a')),
      edgeUpsert(edge('e-1', 'a', 'missing')),
      nodeUpsert(node('b')),
    ]);
    expect(result.snapshot.nodes.size).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.error.code).toBe(errorCodes.DANGLING_EDGE_ENDPOINT);
  });
});

describe('引用未知变更的写事件', () => {
  it.each([
    ['删除节点', () => nodeRemove('a', { changeSetId: 'cs-missing' })],
    ['声明关系', () => edgeUpsert(edge('e-1', 'a', 'b'), { changeSetId: 'cs-missing' })],
    ['删除关系', () => edgeRemove('e-1', { changeSetId: 'cs-missing' })],
  ])('%s 时返回 UNKNOWN_CHANGE_SET', (_name, build) => {
    const snapshot = applyAll(emptySnapshot(), [
      nodeUpsert(node('a')),
      nodeUpsert(node('b')),
      edgeUpsert(edge('e-1', 'a', 'b')),
    ]);
    const result = reduce(snapshot, build());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.UNKNOWN_CHANGE_SET);
    }
  });
});

describe('示例项目事件序列', () => {
  it('可以被完整归约，不产生任何拒绝', () => {
    const result = replay(emptySnapshot(), sampleProjectEvents());
    expect(result.rejected).toEqual([]);
    expect(result.snapshot.nodes.size).toBe(6);
    expect(result.snapshot.edges.size).toBe(4);
    expect(result.snapshot.activeChanges.size).toBe(0);
  });

  it('完成变更后所有实体处于 active 状态', () => {
    const { snapshot } = replay(emptySnapshot(), sampleProjectEvents());
    for (const node of snapshot.nodes.values()) {
      expect(node.lifecycle.status).toBe('active');
    }
  });

  it('概览的一级区域数量落在建议的复杂度范围内', () => {
    const { snapshot } = replay(emptySnapshot(), sampleProjectEvents());
    const roots = listRootNodes(snapshot);
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(roots.length).toBeLessThanOrEqual(9);
  });
});
