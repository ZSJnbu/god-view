import {
  err,
  errorCodes,
  ok,
  type ActiveChange,
  type Actor,
  type AgentEdgeDeclaration,
  type AgentNodeDeclaration,
  type ChangeStartEvent,
  type EdgeRemoveEvent,
  type EdgeUpsertEvent,
  type GodViewEvent,
  type GraphEdge,
  type GraphNode,
  type Identifier,
  type NodeRemoveEvent,
  type NodeUpsertEvent,
  type StoryUpsertEvent,
  type Result,
} from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import type { GraphSnapshot } from './snapshot.js';
import { reduceAnnotation } from './reduce-annotation.js';
import { reduceProposal } from './reduce-proposal.js';
import { reduceChangeObserved } from './reduce-change-observed.js';
import { reduceChangeComplete } from './reduce-change-complete.js';

type ReduceResult = Result<GraphSnapshot, DomainError>;

interface Mutation {
  readonly nodes?: ReadonlyMap<Identifier, GraphNode>;
  readonly edges?: ReadonlyMap<Identifier, GraphEdge>;
  readonly activeChanges?: ReadonlyMap<Identifier, ActiveChange>;
  readonly stories?: GraphSnapshot['stories'];
  readonly annotations?: GraphSnapshot['annotations'];
  readonly writeAccessRequests?: GraphSnapshot['writeAccessRequests'];
  readonly changeProposals?: GraphSnapshot['changeProposals'];
  readonly completedChanges?: GraphSnapshot['completedChanges'];
  /** 只改变会话状态、不改变图结构的事件不推进地图版本。 */
  readonly bumpsRevision: boolean;
}

const unknownActor: Actor = { kind: 'unknown' };

function actorOf(event: GodViewEvent): Actor {
  return event.actor ?? unknownActor;
}

function isAgentActor(event: GodViewEvent): boolean {
  return actorOf(event).kind === 'agent';
}

function commit(snapshot: GraphSnapshot, event: GodViewEvent, mutation: Mutation): GraphSnapshot {
  return {
    ...snapshot,
    revision: mutation.bumpsRevision ? snapshot.revision + 1 : snapshot.revision,
    lastEventSeq: snapshot.lastEventSeq + 1,
    nodes: mutation.nodes ?? snapshot.nodes,
    edges: mutation.edges ?? snapshot.edges,
    activeChanges: mutation.activeChanges ?? snapshot.activeChanges,
    stories: mutation.stories ?? snapshot.stories,
    annotations: mutation.annotations ?? snapshot.annotations,
    writeAccessRequests: mutation.writeAccessRequests ?? snapshot.writeAccessRequests,
    changeProposals: mutation.changeProposals ?? snapshot.changeProposals,
    completedChanges: mutation.completedChanges ?? snapshot.completedChanges,
    appliedEventIds: new Set([...snapshot.appliedEventIds, event.eventId]),
  };
}

/** 声明内容发生变化后，之前的代码验证结论不再成立，必须重新校验。 */
function resetValidation(): GraphNode['codeValidation'] {
  return { status: 'unverified' };
}

function lifecycleFor(changeSetId: Identifier | undefined): GraphNode['lifecycle'] {
  return changeSetId === undefined ? { status: 'active' } : { status: 'in_progress', changeSetId };
}

function requireActiveChange(
  snapshot: GraphSnapshot,
  changeSetId: Identifier | undefined,
): Result<Identifier | undefined, DomainError> {
  if (changeSetId === undefined) {
    return ok(undefined);
  }
  if (!snapshot.activeChanges.has(changeSetId)) {
    return err(
      domainError(errorCodes.UNKNOWN_CHANGE_SET, `变更 ${changeSetId} 不存在或已结束`, changeSetId),
    );
  }
  return ok(changeSetId);
}

/**
 * 拒绝基于过期基线的覆盖写。
 *
 * 只在 Agent 显式提供 baseMapRevision 时检查：未提供基线的事件属于「不声明前提」，
 * 由上层工具在调用前比对版本，而不是让 reducer 猜测意图。
 */
function checkStaleBaseline(
  event: GodViewEvent,
  existingRevision: number | undefined,
  entityId: Identifier,
): DomainError | undefined {
  if (event.baseMapRevision === undefined || existingRevision === undefined) {
    return undefined;
  }
  if (existingRevision > event.baseMapRevision) {
    return domainError(
      errorCodes.STALE_MAP_REVISION,
      `实体 ${entityId} 已在版本 ${String(existingRevision)} 被更新，事件基线为 ${String(event.baseMapRevision)}`,
      entityId,
    );
  }
  return undefined;
}

function trackTouchedNode(
  snapshot: GraphSnapshot,
  changeSetId: Identifier | undefined,
  nodeId: Identifier,
): ReadonlyMap<Identifier, ActiveChange> | undefined {
  return trackTouched(snapshot, changeSetId, nodeId, 'touchedNodeIds');
}

function trackTouchedEdge(
  snapshot: GraphSnapshot,
  changeSetId: Identifier | undefined,
  edgeId: Identifier,
): ReadonlyMap<Identifier, ActiveChange> | undefined {
  return trackTouched(snapshot, changeSetId, edgeId, 'touchedEdgeIds');
}

function trackTouched(
  snapshot: GraphSnapshot,
  changeSetId: Identifier | undefined,
  entityId: Identifier,
  field: 'touchedNodeIds' | 'touchedEdgeIds',
): ReadonlyMap<Identifier, ActiveChange> | undefined {
  if (changeSetId === undefined) {
    return undefined;
  }
  const change = snapshot.activeChanges.get(changeSetId);
  if (change === undefined || change[field].includes(entityId)) {
    return undefined;
  }
  const next = new Map(snapshot.activeChanges);
  next.set(changeSetId, { ...change, [field]: [...change[field], entityId].sort() });
  return next;
}

function buildNode(
  declaration: AgentNodeDeclaration,
  existing: GraphNode | undefined,
  event: GodViewEvent,
  changeSetId: Identifier | undefined,
  revision: number,
): GraphNode {
  return {
    id: declaration.id,
    type: declaration.type,
    label: declaration.label,
    ...(declaration.responsibility === undefined
      ? {}
      : { responsibility: declaration.responsibility }),
    ...(declaration.parentId === undefined ? {} : { parentId: declaration.parentId }),
    ...(declaration.paths === undefined ? {} : { paths: [...declaration.paths].sort() }),
    ...(declaration.locations === undefined ? {} : { locations: declaration.locations }),
    ...(declaration.evidence === undefined ? {} : { declaredEvidence: declaration.evidence }),
    ...(declaration.uncertainties === undefined
      ? {}
      : { uncertainties: declaration.uncertainties }),
    ...(declaration.visualHint === undefined ? {} : { visualHint: declaration.visualHint }),
    // 首次声明的来源保持不变：后续更新不应把 Agent 声明改写成用户创建，反之亦然。
    source: existing?.source ?? {
      kind: isAgentActor(event) ? 'agent_declared' : 'user_created',
      actor: actorOf(event),
      sessionId: event.sessionId,
      declaredAt: event.timestamp,
    },
    codeValidation: resetValidation(),
    userConfirmation: existing?.userConfirmation ?? { status: 'unconfirmed' },
    lifecycle: lifecycleFor(changeSetId),
    updatedAt: event.timestamp,
    revision,
  };
}

function buildEdge(
  declaration: AgentEdgeDeclaration,
  existing: GraphEdge | undefined,
  event: GodViewEvent,
  changeSetId: Identifier | undefined,
  revision: number,
): GraphEdge {
  return {
    id: declaration.id,
    from: declaration.from,
    to: declaration.to,
    type: declaration.type,
    ...(declaration.reason === undefined ? {} : { reason: declaration.reason }),
    ...(declaration.evidence === undefined ? {} : { declaredEvidence: declaration.evidence }),
    source: existing?.source ?? {
      kind: isAgentActor(event) ? 'agent_declared' : 'user_created',
      actor: actorOf(event),
      sessionId: event.sessionId,
      declaredAt: event.timestamp,
    },
    codeValidation: resetValidation(),
    userConfirmation: existing?.userConfirmation ?? { status: 'unconfirmed' },
    lifecycle: lifecycleFor(changeSetId),
    updatedAt: event.timestamp,
    revision,
  };
}

function handleChangeStart(snapshot: GraphSnapshot, event: ChangeStartEvent): ReduceResult {
  const { changeSetId, intent, plannedFiles } = event.payload;
  const invalidApproval = validateChangeApproval(snapshot, event);
  if (invalidApproval !== undefined) return err(invalidApproval);
  if (snapshot.activeChanges.has(changeSetId)) {
    // 同一 changeSetId 重复开始属于 Agent 重试，保持幂等。
    return ok(commit(snapshot, event, { bumpsRevision: false }));
  }
  if (snapshot.activeChanges.size > 0) {
    return err(
      domainError(
        errorCodes.CONCURRENT_CHANGE_SET,
        '同一工作区同时只允许一个进行中的变更',
        changeSetId,
      ),
    );
  }
  const change: ActiveChange = {
    changeSetId,
    sessionId: event.sessionId,
    intent,
    startedAt: event.timestamp,
    ...(plannedFiles === undefined ? {} : { plannedFiles: [...plannedFiles].sort() }),
    touchedNodeIds: [],
    touchedEdgeIds: [],
    ...approvedChangeFields(snapshot, event),
  };
  const activeChanges = new Map(snapshot.activeChanges);
  activeChanges.set(changeSetId, change);
  return ok(commit(snapshot, event, { activeChanges, bumpsRevision: true }));
}

function validateChangeApproval(
  snapshot: GraphSnapshot,
  event: ChangeStartEvent,
): DomainError | undefined {
  const proposalId = event.payload.proposalId;
  if (proposalId === undefined) return undefined;
  const proposal = snapshot.changeProposals.get(proposalId);
  const approval = proposal?.approval;
  if (
    proposal?.status !== 'approved' ||
    approval === undefined ||
    event.payload.approvalToken !== approval.token ||
    proposal.branchKey !== snapshot.branchKey ||
    proposal.baseGitRevision !== snapshot.baseGitRevision ||
    event.baseMapRevision !== approval.mapRevision ||
    snapshot.revision !== approval.mapRevision + 1 ||
    Date.parse(approval.expiresAt) <= Date.parse(event.timestamp)
  ) {
    return domainError(
      errorCodes.STALE_MAP_REVISION,
      `方案 ${proposalId} 的批准令牌无效或已过期`,
      proposalId,
    );
  }
  return (event.payload.plannedFiles ?? []).some((path) => !approval.approvedScope.includes(path))
    ? domainError(
        errorCodes.SCOPE_VIOLATION,
        'ChangeSet 计划文件超出批准范围',
        event.payload.changeSetId,
      )
    : undefined;
}

function approvedChangeFields(
  snapshot: GraphSnapshot,
  event: ChangeStartEvent,
): Partial<ActiveChange> {
  const proposalId = event.payload.proposalId;
  if (proposalId === undefined) return {};
  const approval = snapshot.changeProposals.get(proposalId)?.approval;
  if (approval === undefined) return {};
  return {
    proposalId,
    approvalToken: approval.token,
    approvedScope: approval.approvedScope,
    permissionMode: approval.permissionMode,
    baseMapRevision: approval.mapRevision,
    preexistingChanges: approval.preexistingChanges,
    ...(snapshot.baseGitRevision === undefined
      ? {}
      : { baseGitRevision: snapshot.baseGitRevision }),
  };
}

function handleNodeUpsert(snapshot: GraphSnapshot, event: NodeUpsertEvent): ReduceResult {
  const declaration = event.payload.node;
  const changeSet = requireActiveChange(snapshot, event.payload.changeSetId);
  if (!changeSet.ok) {
    return err(changeSet.error);
  }
  const existing = snapshot.nodes.get(declaration.id);
  const stale = checkStaleBaseline(event, existing?.revision, declaration.id);
  if (stale !== undefined) {
    return err(stale);
  }
  if (
    existing?.userConfirmation.status === 'confirmed' &&
    existing.type !== declaration.type &&
    isAgentActor(event)
  ) {
    return err(
      domainError(
        errorCodes.STABLE_ID_VIOLATION,
        `模块 ${declaration.id} 已被用户确认，Agent 不能改变其实体类型`,
        declaration.id,
      ),
    );
  }
  if (declaration.parentId !== undefined && !snapshot.nodes.has(declaration.parentId)) {
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `父节点 ${declaration.parentId} 不存在`,
        declaration.parentId,
      ),
    );
  }
  const revision = snapshot.revision + 1;
  const nodes = new Map(snapshot.nodes);
  nodes.set(declaration.id, buildNode(declaration, existing, event, changeSet.value, revision));
  const activeChanges = trackTouchedNode(snapshot, changeSet.value, declaration.id);
  return ok(
    commit(snapshot, event, {
      nodes,
      ...(activeChanges === undefined ? {} : { activeChanges }),
      bumpsRevision: true,
    }),
  );
}

function handleNodeRemove(snapshot: GraphSnapshot, event: NodeRemoveEvent): ReduceResult {
  const { nodeId } = event.payload;
  const changeSet = requireActiveChange(snapshot, event.payload.changeSetId);
  if (!changeSet.ok) {
    return err(changeSet.error);
  }
  const existing = snapshot.nodes.get(nodeId);
  if (existing === undefined) {
    return err(domainError(errorCodes.UNKNOWN_ENTITY, `节点 ${nodeId} 不存在`, nodeId));
  }
  if (existing.userConfirmation.status === 'confirmed' && isAgentActor(event)) {
    return err(
      domainError(
        errorCodes.STABLE_ID_VIOLATION,
        `模块 ${nodeId} 已被用户确认，Agent 不能删除重建；请更新其名称与职责`,
        nodeId,
      ),
    );
  }
  const revision = snapshot.revision + 1;
  const nodes = new Map(snapshot.nodes);
  // 保留墓碑而不是物理删除：标注、历史事件和讲解步骤仍需要通过稳定 ID 追溯该实体。
  nodes.set(nodeId, {
    ...existing,
    lifecycle: {
      status: 'removed',
      ...(changeSet.value === undefined ? {} : { changeSetId: changeSet.value }),
    },
    updatedAt: event.timestamp,
    revision,
  });
  const edges = new Map(snapshot.edges);
  for (const [edgeId, edge] of snapshot.edges) {
    if (edge.lifecycle.status !== 'removed' && (edge.from === nodeId || edge.to === nodeId)) {
      edges.set(edgeId, {
        ...edge,
        lifecycle: { status: 'removed' },
        updatedAt: event.timestamp,
        revision,
      });
    }
  }
  const activeChanges = trackTouchedNode(snapshot, changeSet.value, nodeId);
  return ok(
    commit(snapshot, event, {
      nodes,
      edges,
      ...(activeChanges === undefined ? {} : { activeChanges }),
      bumpsRevision: true,
    }),
  );
}

function handleEdgeUpsert(snapshot: GraphSnapshot, event: EdgeUpsertEvent): ReduceResult {
  const declaration = event.payload.edge;
  const changeSet = requireActiveChange(snapshot, event.payload.changeSetId);
  if (!changeSet.ok) {
    return err(changeSet.error);
  }
  for (const endpoint of [declaration.from, declaration.to]) {
    const node = snapshot.nodes.get(endpoint);
    if (node === undefined || node.lifecycle.status === 'removed') {
      return err(
        domainError(
          errorCodes.DANGLING_EDGE_ENDPOINT,
          `关系端点 ${endpoint} 不存在或已删除`,
          endpoint,
        ),
      );
    }
  }
  const existing = snapshot.edges.get(declaration.id);
  const stale = checkStaleBaseline(event, existing?.revision, declaration.id);
  if (stale !== undefined) {
    return err(stale);
  }
  const revision = snapshot.revision + 1;
  const edges = new Map(snapshot.edges);
  edges.set(declaration.id, buildEdge(declaration, existing, event, changeSet.value, revision));
  const activeChanges = trackTouchedEdge(snapshot, changeSet.value, declaration.id);
  return ok(
    commit(snapshot, event, {
      edges,
      ...(activeChanges === undefined ? {} : { activeChanges }),
      bumpsRevision: true,
    }),
  );
}

function handleEdgeRemove(snapshot: GraphSnapshot, event: EdgeRemoveEvent): ReduceResult {
  const { edgeId } = event.payload;
  const changeSet = requireActiveChange(snapshot, event.payload.changeSetId);
  if (!changeSet.ok) {
    return err(changeSet.error);
  }
  const existing = snapshot.edges.get(edgeId);
  if (existing === undefined) {
    return err(domainError(errorCodes.UNKNOWN_ENTITY, `关系 ${edgeId} 不存在`, edgeId));
  }
  const revision = snapshot.revision + 1;
  const edges = new Map(snapshot.edges);
  edges.set(edgeId, {
    ...existing,
    lifecycle: {
      status: 'removed',
      ...(changeSet.value === undefined ? {} : { changeSetId: changeSet.value }),
    },
    updatedAt: event.timestamp,
    revision,
  });
  const activeChanges = trackTouchedEdge(snapshot, changeSet.value, edgeId);
  return ok(
    commit(snapshot, event, {
      edges,
      ...(activeChanges === undefined ? {} : { activeChanges }),
      bumpsRevision: true,
    }),
  );
}

function validateStory(
  snapshot: GraphSnapshot,
  story: StoryUpsertEvent['payload']['story'],
): DomainError | undefined {
  const orders = new Set(story.steps.map((step) => step.order));
  if (orders.size !== story.steps.length) {
    return domainError(
      errorCodes.SCHEMA_VIOLATION,
      `讲解 ${story.id} 的步骤 order 必须唯一`,
      story.id,
    );
  }
  for (const step of story.steps) {
    for (const nodeId of step.focusNodeIds) {
      if (!snapshot.nodes.has(nodeId)) {
        return domainError(
          errorCodes.UNKNOWN_ENTITY,
          `讲解 ${story.id} 引用了不存在的节点 ${nodeId}`,
          nodeId,
        );
      }
    }
    for (const edgeId of step.focusEdgeIds ?? []) {
      if (!snapshot.edges.has(edgeId)) {
        return domainError(
          errorCodes.UNKNOWN_ENTITY,
          `讲解 ${story.id} 引用了不存在的关系 ${edgeId}`,
          edgeId,
        );
      }
    }
  }
  return undefined;
}

function normalizedStory(story: StoryUpsertEvent['payload']['story']) {
  return {
    ...story,
    steps: [...story.steps]
      .sort((left, right) => left.order - right.order)
      .map((step) => ({
        ...step,
        focusNodeIds: [...step.focusNodeIds],
        ...(step.focusEdgeIds === undefined ? {} : { focusEdgeIds: [...step.focusEdgeIds] }),
      })),
  };
}

function handleStoryUpsert(snapshot: GraphSnapshot, event: StoryUpsertEvent): ReduceResult {
  const story = event.payload.story;
  const invalid = validateStory(snapshot, story);
  if (invalid !== undefined) {
    return err(invalid);
  }
  const stories = new Map(snapshot.stories);
  stories.set(story.id, normalizedStory(story));
  return ok(commit(snapshot, event, { stories, bumpsRevision: true }));
}

/**
 * 事件归约。
 *
 * 纯函数：不读取时间、不生成随机 ID、不访问文件系统。相同的快照与事件序列
 * 必须产生语义等价的结果（TECHNICAL_ARCHITECTURE.md §8.1）。
 */
function isAnnotationEvent(
  event: GodViewEvent,
): event is Extract<
  GodViewEvent,
  { type: 'annotation_create' | 'annotation_answer' | 'annotation_resolve' }
> {
  return ['annotation_create', 'annotation_answer', 'annotation_resolve'].includes(event.type);
}

function isProposalEvent(
  event: GodViewEvent,
): event is Extract<
  GodViewEvent,
  { type: 'write_access_requested' | 'change_proposal' | 'change_approved' | 'change_rejected' }
> {
  return [
    'write_access_requested',
    'change_proposal',
    'change_approved',
    'change_rejected',
  ].includes(event.type);
}

function reduceSpecialEvent(
  snapshot: GraphSnapshot,
  event: GodViewEvent,
): ReduceResult | undefined {
  if (isAnnotationEvent(event)) return reduceAnnotation(snapshot, event);
  if (isProposalEvent(event)) return reduceProposal(snapshot, event);
  if (event.type === 'change_observed') return reduceChangeObserved(snapshot, event);
  if (event.type === 'change_reviewed') return reduceChangeReviewed(snapshot, event);
  return undefined;
}

function reduceChangeReviewed(
  snapshot: GraphSnapshot,
  event: Extract<GodViewEvent, { type: 'change_reviewed' }>,
): ReduceResult {
  if (event.actor?.kind !== 'user')
    return err(domainError(errorCodes.UNSUPPORTED, '只有用户可以接受 ChangeSet 结果'));
  const completed = snapshot.completedChanges.get(event.payload.changeSetId);
  if (completed?.status !== 'pending_review')
    return err(
      domainError(
        errorCodes.UNKNOWN_CHANGE_SET,
        `变更 ${event.payload.changeSetId} 不存在或不在待审查状态`,
        event.payload.changeSetId,
      ),
    );
  if (
    event.payload.status === 'accepted' &&
    completed.diff.files.some((file) => file.scopeStatus === 'outside_scope')
  )
    return err(
      domainError(
        errorCodes.SCOPE_VIOLATION,
        '存在越界文件时只能选择带问题接受',
        completed.changeSetId,
      ),
    );
  const completedChanges = new Map(snapshot.completedChanges);
  completedChanges.set(completed.changeSetId, {
    ...completed,
    status: event.payload.status,
    ...(event.payload.note === undefined ? {} : { note: event.payload.note }),
  });
  return ok(commit(snapshot, event, { completedChanges, bumpsRevision: true }));
}

export function reduce(snapshot: GraphSnapshot, event: GodViewEvent): ReduceResult {
  if (event.workspaceId !== snapshot.workspaceId || event.branchKey !== snapshot.branchKey) {
    return err(
      domainError(
        errorCodes.WORKSPACE_MISMATCH,
        `事件属于 ${event.workspaceId}/${event.branchKey}，当前地图为 ${snapshot.workspaceId}/${snapshot.branchKey}`,
      ),
    );
  }
  // 幂等：Agent 重试同一事件不得产生重复节点或重复推进版本。
  if (snapshot.appliedEventIds.has(event.eventId)) {
    return ok(snapshot);
  }

  const special = reduceSpecialEvent(snapshot, event);
  if (special !== undefined) return special;

  switch (event.type) {
    case 'session_start':
    case 'session_end':
      return ok(commit(snapshot, event, { bumpsRevision: false }));
    case 'change_start':
      return handleChangeStart(snapshot, event);
    case 'node_upsert':
      return handleNodeUpsert(snapshot, event);
    case 'node_remove':
      return handleNodeRemove(snapshot, event);
    case 'edge_upsert':
      return handleEdgeUpsert(snapshot, event);
    case 'edge_remove':
      return handleEdgeRemove(snapshot, event);
    case 'change_complete':
      return reduceChangeComplete(snapshot, event);
    case 'story_upsert':
      return handleStoryUpsert(snapshot, event);
    default:
      return err(
        domainError(
          errorCodes.UNSUPPORTED_EVENT_TYPE,
          `事件类型 ${event.type} 已在协议中保留，但当前版本尚未实现`,
        ),
      );
  }
}
