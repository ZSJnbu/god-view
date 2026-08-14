/* eslint-disable */
/**
 * 本文件由 packages/protocol/scripts/generate-types.mts 从 schema/*.schema.json 生成。
 * 请勿手工修改；修改协议请编辑 JSON Schema 后运行 `pnpm run generate`。
 */

export type GodViewEvent =
  | SessionStartEvent
  | ChangeStartEvent
  | NodeUpsertEvent
  | NodeRemoveEvent
  | EdgeUpsertEvent
  | EdgeRemoveEvent
  | ChangeCompleteEvent
  | SessionEndEvent
  | StoryUpsertEvent
  | AnnotationCreateEvent
  | AnnotationAnswerEvent
  | AnnotationResolveEvent
  | WriteAccessRequestedEvent
  | ChangeProposalEvent
  | ChangeApprovedEvent
  | ChangeRejectedEvent
  | ChangeObservedEvent
  | ChangeReviewedEvent
  | ScopeExpansionRequestedEvent
  | ScopeExpansionDecidedEvent
  | ReservedEvent;
export type SessionStartEvent = EventEnvelope & {
  type: 'session_start';
  payload: SessionStartPayload;
};
/**
 * major.minor 协议版本。
 */
export type ProtocolVersion = string;
export type Identifier = string;
/**
 * RFC 3339 时间字符串。协议层不使用数值时间戳。
 */
export type Timestamp = string;
export type ActorKind = 'agent' | 'user' | 'system' | 'unknown';
export type ChangeStartEvent = EventEnvelope & {
  type: 'change_start';
  payload: ChangeStartPayload;
};
/**
 * 工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。
 */
export type WorkspacePath = string;
export type NodeUpsertEvent = EventEnvelope & {
  type: 'node_upsert';
  payload: NodeUpsertPayload;
};
export type NodeType =
  | 'entry'
  | 'module'
  | 'group'
  | 'file'
  | 'service'
  | 'external_system'
  | 'storage'
  | 'unclassified';
/**
 * 证据类型。agent_claim 属于 L2 声明，不得展示为代码事实。
 */
export type EvidenceKind = 'file_exists' | 'explicit_import' | 'git_diff' | 'agent_claim';
export type ShortNote = string;
export type NodeRemoveEvent = EventEnvelope & {
  type: 'node_remove';
  payload: NodeRemovePayload;
};
export type EdgeUpsertEvent = EventEnvelope & {
  type: 'edge_upsert';
  payload: EdgeUpsertPayload;
};
export type EdgeType =
  'depends_on' | 'calls' | 'data_flow' | 'contains' | 'reads' | 'writes' | 'publishes';
export type EdgeRemoveEvent = EventEnvelope & {
  type: 'edge_remove';
  payload: EdgeRemovePayload;
};
export type ChangeCompleteEvent = EventEnvelope & {
  type: 'change_complete';
  payload: ChangeCompletePayload;
};
/**
 * 失败或中断只结束临时预览并记录状态，已经产生的代码改动不自动回滚。
 */
export type CompletionStatus = 'completed' | 'failed' | 'interrupted';
export type SessionEndEvent = EventEnvelope & {
  type: 'session_end';
  payload: SessionEndPayload;
};
export type StoryUpsertEvent = EventEnvelope & {
  type: 'story_upsert';
  payload: StoryUpsertPayload;
};
export type AnnotationCreateEvent = EventEnvelope & {
  type: 'annotation_create';
  payload: AnnotationCreatePayload;
};
export type AnnotationAnswerEvent = EventEnvelope & {
  type: 'annotation_answer';
  payload: AnnotationAnswerPayload;
};
export type AnnotationResolveEvent = EventEnvelope & {
  type: 'annotation_resolve';
  payload: AnnotationResolvePayload;
};
export type WriteAccessRequestedEvent = EventEnvelope & {
  type: 'write_access_requested';
  payload: WriteAccessRequestedPayload;
};
export type ChangeProposalEvent = EventEnvelope & {
  type: 'change_proposal';
  payload: ChangeProposalPayload;
};
export type ChangeApprovedEvent = EventEnvelope & {
  type: 'change_approved';
  payload: ChangeApprovedPayload;
};
export type ChangeRejectedEvent = EventEnvelope & {
  type: 'change_rejected';
  payload: ChangeRejectedPayload;
};
export type ChangeObservedEvent = EventEnvelope & {
  type: 'change_observed';
  payload: ChangeObservedPayload;
};
export type ChangeReviewedEvent = EventEnvelope & {
  type: 'change_reviewed';
  payload: ChangeReviewedPayload;
};
export type ScopeExpansionRequestedEvent = EventEnvelope & {
  type: 'scope_expansion_requested';
  payload: ScopeExpansionRequestedPayload;
};
export type ScopeExpansionDecidedEvent = EventEnvelope & {
  type: 'scope_expansion_decided';
  payload: ScopeExpansionDecidedPayload;
};
/**
 * 协议已保留但当前实现尚未支持的事件类型。命令处理层返回 UNSUPPORTED_EVENT_TYPE，不静默接受。
 */
export type ReservedEvent = EventEnvelope & {
  type: ReservedEventType;
  payload?: {};
};
export type ReservedEventType =
  | 'change_accepted'
  | 'unexpected_write'
  | 'scope_violation'
  | 'change_interrupted'
  | 'change_conflicted'
  | 'change_cancelled'
  | 'change_failed';
/**
 * 实体的声明来源。与 codeValidation、userConfirmation 相互独立，不可互相冒充。
 */
export type SourceKind = 'agent_declared' | 'inferred' | 'user_created';
/**
 * verified 仅表示路径/文件/显式依赖证据成立，不表示业务职责描述正确。
 */
export type CodeValidationStatus = 'unverified' | 'verified' | 'failed' | 'unsupported' | 'drifted';
/**
 * L0 文件事实、L1 显式语法、L2 Agent 声明、L3 系统推断。
 */
export type ValidationLevel = 'L0' | 'L1' | 'L2' | 'L3';
/**
 * 漂移类型。missing_file 表示地图声明的文件已不存在；unclassified_file 表示仓库中的第一方文件尚未归属任何节点。
 */
export type DriftKind =
  'missing_file' | 'unclassified_file' | 'undeclared_change' | 'conflicting_declaration';
export type BeginChangeInput = SessionScopedInput & {
  intent: string;
  /**
   * @maxItems 500
   */
  plannedFiles?: WorkspacePath[];
};
export type UpsertNodeInput = SessionScopedInput & {
  node: AgentNodeDeclaration;
};
export type UpsertEdgeInput = SessionScopedInput & {
  edge: AgentEdgeDeclaration;
};
export type RemoveEntityInput = SessionScopedInput & {
  entityId: Identifier;
  reason: string;
};
export type CompleteChangeInput = SessionScopedInput & {
  changeSetId: Identifier;
  status: CompletionStatus;
  /**
   * @maxItems 2000
   */
  actualFiles?: WorkspacePath[];
  note?: string;
};
export type UpsertStoryInput = SessionScopedInput & {
  story: GuidedStory;
};
export type AnswerAnnotationInput = SessionScopedInput & {
  annotationId: Identifier;
  summary: string;
  detail?: string;
  /**
   * @maxItems 50
   */
  evidence?: Evidence[];
  uncertain?: boolean;
  story?: GuidedStory;
};
export type RequestWriteAccessInput = SessionScopedInput & {
  annotationId: Identifier;
  reason: string;
  /**
   * @minItems 1
   * @maxItems 500
   */
  expectedScope: WorkspacePath[];
};
export type ProposeChangeInput = SessionScopedInput & {
  annotationId: Identifier;
  requestId: Identifier;
  summary: string;
  /**
   * @minItems 1
   * @maxItems 500
   */
  plannedFiles: WorkspacePath[];
  /**
   * @maxItems 100
   */
  structuralChanges: string[];
  /**
   * @maxItems 50
   */
  risks: string[];
  /**
   * @minItems 1
   * @maxItems 50
   */
  validationPlan: string[];
  baseMapRevision: number;
  baseGitRevision?: string;
};
export type StartApprovedChangeInput = SessionScopedInput & {
  proposalId: Identifier;
  approvalToken: Identifier;
};
/**
 * 在修改任何未批准路径之前申请扩大当前 ChangeSet 范围；调用后必须等待用户决定。
 */
export type RequestScopeExpansionInput = SessionScopedInput & {
  changeSetId: Identifier;
  /**
   * @minItems 1
   * @maxItems 100
   */
  requestedFiles: WorkspacePath[];
  reason: string;
};

/**
 * 仅用于类型生成的聚合入口：把所有需要导出的协议类型集中引用一次，使 json-schema-to-typescript 输出单个无重复声明的模块。本文件不用于运行时校验。
 */
export interface GodViewProtocolBundle {
  event?: GodViewEvent;
  agentNode?: AgentNodeDeclaration;
  agentEdge?: AgentEdgeDeclaration;
  snapshot?: GraphSnapshotDocument;
  coverage?: CoverageReport;
  drift?: DriftFinding;
  story?: GuidedStory;
  annotation?: AnnotationThread;
  writeAccessRequest?: WriteAccessRequest;
  changeProposal?: ChangeProposal;
  activeChange?: ActiveChange;
  scopeExpansionRequest?: ScopeExpansionRequest;
  changeDiffSummary?: ChangeDiffSummary;
  completedChange?: CompletedChange;
  changeReviewedPayload?: ChangeReviewedPayload;
  toolResult?: ToolResult;
  getMapInput?: GetMapInput;
  getMapResult?: GetMapResult;
  beginChangeInput?: BeginChangeInput;
  upsertNodeInput?: UpsertNodeInput;
  upsertEdgeInput?: UpsertEdgeInput;
  removeEntityInput?: RemoveEntityInput;
  completeChangeInput?: CompleteChangeInput;
  upsertStoryInput?: UpsertStoryInput;
  answerAnnotationInput?: AnswerAnnotationInput;
  requestWriteAccessInput?: RequestWriteAccessInput;
  proposeChangeInput?: ProposeChangeInput;
  startApprovedChangeInput?: StartApprovedChangeInput;
  requestScopeExpansionInput?: RequestScopeExpansionInput;
  changeRejectedPayload?: ChangeRejectedPayload;
  adapterCapabilities?: AdapterCapabilities;
}
export interface EventEnvelope {
  version: ProtocolVersion;
  workspaceId: Identifier;
  branchKey: Identifier;
  sessionId: Identifier;
  eventId: Identifier;
  timestamp: Timestamp;
  actor?: Actor;
  baseMapRevision?: number;
  baseGitRevision?: string;
  summary?: string;
}
/**
 * 事件来源。Adapter 无法提供可靠任务关联证据时必须使用 kind=unknown。
 */
export interface Actor {
  kind: ActorKind;
  adapterId?: Identifier;
  displayName?: string;
}
export interface SessionStartPayload {
  adapterId: Identifier;
  /**
   * @maxItems 20
   */
  protocolVersions?: ProtocolVersion[];
}
export interface ChangeStartPayload {
  changeSetId: Identifier;
  intent: string;
  /**
   * @maxItems 500
   */
  plannedFiles?: WorkspacePath[];
  proposalId?: Identifier;
  approvalToken?: Identifier;
}
export interface NodeUpsertPayload {
  node: AgentNodeDeclaration;
  changeSetId?: Identifier;
}
export interface AgentNodeDeclaration {
  id: Identifier;
  type: NodeType;
  label: string;
  responsibility?: string;
  parentId?: Identifier;
  /**
   * @maxItems 500
   */
  paths?: WorkspacePath[];
  /**
   * @maxItems 50
   */
  locations?: CodeLocation[];
  /**
   * @maxItems 50
   */
  evidence?: Evidence[];
  /**
   * @maxItems 20
   */
  uncertainties?: ShortNote[];
  visualHint?: VisualHint;
}
export interface CodeLocation {
  path: WorkspacePath;
  startLine?: number;
  endLine?: number;
}
export interface Evidence {
  kind: EvidenceKind;
  location?: CodeLocation;
  detail?: string;
}
/**
 * Agent 只能给出布局建议，最终位置由布局引擎决定。
 */
export interface VisualHint {
  group?: string;
  importance?: 'primary' | 'secondary' | 'detail';
  preferredPosition?: 'entry' | 'core' | 'storage' | 'external' | 'auto';
  icon?: string;
  collapsedByDefault?: boolean;
}
export interface NodeRemovePayload {
  nodeId: Identifier;
  reason: string;
  changeSetId?: Identifier;
}
export interface EdgeUpsertPayload {
  edge: AgentEdgeDeclaration;
  changeSetId?: Identifier;
}
export interface AgentEdgeDeclaration {
  id: Identifier;
  from: Identifier;
  to: Identifier;
  type: EdgeType;
  reason?: string;
  /**
   * @maxItems 50
   */
  evidence?: Evidence[];
}
export interface EdgeRemovePayload {
  edgeId: Identifier;
  reason: string;
  changeSetId?: Identifier;
}
export interface ChangeCompletePayload {
  changeSetId: Identifier;
  status: CompletionStatus;
  /**
   * @maxItems 2000
   */
  actualFiles?: WorkspacePath[];
  note?: string;
}
export interface SessionEndPayload {
  status: CompletionStatus;
  note?: string;
}
export interface StoryUpsertPayload {
  story: GuidedStory;
}
/**
 * Agent 只提交声明式讲解，不提交任何 HTML、SVG、CSS 或脚本。
 */
export interface GuidedStory {
  id: Identifier;
  type: 'project_intro' | 'key_flow' | 'change_replay';
  title: string;
  /**
   * @minItems 3
   * @maxItems 8
   */
  steps: GuidedStoryStep[];
}
export interface GuidedStoryStep {
  order: number;
  /**
   * @minItems 1
   * @maxItems 20
   */
  focusNodeIds: Identifier[];
  /**
   * @maxItems 20
   */
  focusEdgeIds?: Identifier[];
  caption: string;
  cameraHint?: 'fit' | 'focus' | 'overview';
}
export interface AnnotationCreatePayload {
  annotation: AnnotationThread;
}
export interface AnnotationThread {
  id: Identifier;
  type: 'note' | 'explain' | 'change' | 'risk';
  status:
    | 'draft'
    | 'sent'
    | 'answered'
    | 'resolved'
    | 'write_requested'
    | 'plan_proposed'
    | 'approved'
    | 'in_progress'
    | 'rejected'
    | 'cancelled'
    | 'needs_clarification';
  target: AnnotationTarget;
  /**
   * @minItems 1
   * @maxItems 100
   */
  messages: AnnotationMessage[];
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
  pinned?: boolean;
}
export interface AnnotationTarget {
  /**
   * @maxItems 20
   */
  nodeIds?: Identifier[];
  /**
   * @maxItems 20
   */
  edgeIds?: Identifier[];
  storyId?: Identifier;
  changeSetId?: Identifier;
  /**
   * @maxItems 50
   */
  codeLocations?: CodeLocation[];
  mapRevision: number;
  baseGitRevision?: string;
}
export interface AnnotationMessage {
  id: Identifier;
  author: 'user' | 'agent' | 'system';
  body: string;
  detail?: string;
  /**
   * @maxItems 50
   */
  evidence?: Evidence[];
  uncertain?: boolean;
  createdAt: Timestamp;
}
export interface AnnotationAnswerPayload {
  annotationId: Identifier;
  message: AnnotationMessage;
  story?: GuidedStory;
}
export interface AnnotationResolvePayload {
  annotationId: Identifier;
}
export interface WriteAccessRequestedPayload {
  request: WriteAccessRequest;
}
export interface WriteAccessRequest {
  id: Identifier;
  annotationId: Identifier;
  status: 'requested' | 'dismissed' | 'converted';
  reason: string;
  /**
   * @minItems 1
   * @maxItems 500
   */
  expectedScope: WorkspacePath[];
  requestedAt: Timestamp;
}
export interface ChangeProposalPayload {
  proposal: ChangeProposal;
}
export interface ChangeProposal {
  id: Identifier;
  annotationId: Identifier;
  requestId: Identifier;
  status: 'proposed' | 'approved' | 'rejected' | 'cancelled' | 'stale';
  summary: string;
  /**
   * @minItems 1
   * @maxItems 500
   */
  plannedFiles: WorkspacePath[];
  /**
   * @maxItems 100
   */
  structuralChanges: string[];
  /**
   * @maxItems 50
   */
  risks: string[];
  /**
   * @minItems 1
   * @maxItems 50
   */
  validationPlan: string[];
  branchKey: Identifier;
  baseMapRevision: number;
  baseGitRevision?: string;
  createdAt: Timestamp;
  approval?: Approval;
}
export interface Approval {
  token: Identifier;
  /**
   * @minItems 1
   * @maxItems 500
   */
  approvedScope: WorkspacePath[];
  permissionMode: 'enforced' | 'monitored';
  approvedAt: Timestamp;
  expiresAt: Timestamp;
  branchKey: Identifier;
  mapRevision: number;
  gitRevision?: string;
  /**
   * @maxItems 2000
   */
  preexistingChanges: WorkspacePath[];
}
export interface ChangeApprovedPayload {
  proposalId: Identifier;
  approval: Approval;
}
export interface ChangeRejectedPayload {
  proposalId: Identifier;
  reason: string;
}
export interface ChangeObservedPayload {
  changeSetId: Identifier;
  executionStatus: 'in_progress' | 'scope_violation' | 'conflicted' | 'interrupted' | 'failed';
  diff: ChangeDiffSummary;
}
export interface ChangeDiffSummary {
  /**
   * @maxItems 2000
   */
  files: DiffFile[];
  additions: number;
  deletions: number;
  computedAt: Timestamp;
  contentHash: string;
}
export interface DiffFile {
  path: WorkspacePath;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  additions: number;
  deletions: number;
  scopeStatus: 'approved' | 'outside_scope';
  attribution: 'change_set' | 'preexisting_overlap' | 'unknown_external';
}
export interface ChangeReviewedPayload {
  changeSetId: Identifier;
  status: 'accepted' | 'accepted_with_issues';
  note?: string;
}
export interface ScopeExpansionRequestedPayload {
  request: ScopeExpansionRequest;
}
/**
 * Agent 在写入批准范围外文件之前提出的扩围申请。只有用户事件可以把 pending 改为 approved 或 rejected。
 */
export interface ScopeExpansionRequest {
  id: Identifier;
  changeSetId: Identifier;
  sessionId: Identifier;
  /**
   * @minItems 1
   * @maxItems 100
   */
  requestedFiles: WorkspacePath[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Timestamp;
  decidedAt?: Timestamp;
}
export interface ScopeExpansionDecidedPayload {
  changeSetId: Identifier;
  requestId: Identifier;
  decision: 'approved' | 'rejected';
}
export interface GraphSnapshotDocument {
  schemaVersion: ProtocolVersion;
  workspaceId: Identifier;
  branchKey: Identifier;
  revision: number;
  lastEventSeq: number;
  baseGitRevision?: string;
  createdAt: Timestamp;
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeChanges?: ActiveChange[];
  stories?: GuidedStory[];
  annotations?: AnnotationThread[];
  writeAccessRequests?: WriteAccessRequest[];
  changeProposals?: ChangeProposal[];
  completedChanges?: CompletedChange[];
  coverage?: CoverageReport;
  /**
   * 用于幂等的已处理事件 ID，按字典序排序。
   */
  appliedEventIds: Identifier[];
}
export interface GraphNode {
  id: Identifier;
  type: NodeType;
  label: string;
  responsibility?: string;
  parentId?: Identifier;
  paths?: WorkspacePath[];
  locations?: CodeLocation[];
  declaredEvidence?: Evidence[];
  uncertainties?: string[];
  visualHint?: VisualHint;
  source: Provenance;
  codeValidation: CodeValidationState;
  userConfirmation: UserConfirmationState;
  lifecycle: LifecycleState;
  updatedAt: Timestamp;
  /**
   * 最后一次修改该实体时的地图版本号。用于检测 Agent 基于过期基线的覆盖写。
   */
  revision: number;
}
export interface Provenance {
  kind: SourceKind;
  actor: Actor;
  sessionId?: Identifier;
  declaredAt: Timestamp;
}
export interface CodeValidationState {
  status: CodeValidationStatus;
  level?: ValidationLevel;
  validator?: Identifier;
  checkedAt?: Timestamp;
  /**
   * @maxItems 100
   */
  evidence?: Evidence[];
  detail?: string;
}
export interface UserConfirmationState {
  status: 'unconfirmed' | 'confirmed' | 'rejected';
  confirmedAt?: Timestamp;
}
export interface LifecycleState {
  /**
   * change_start 与 change_complete 之间的实体标记为 in_progress，用户可见但不是完成状态；变更失败或中断时标记为 failed，已产生的代码改动不自动回滚。
   */
  status: 'planned' | 'in_progress' | 'active' | 'failed' | 'removed';
  changeSetId?: Identifier;
}
export interface GraphEdge {
  id: Identifier;
  from: Identifier;
  to: Identifier;
  type: EdgeType;
  reason?: string;
  declaredEvidence?: Evidence[];
  source: Provenance;
  codeValidation: CodeValidationState;
  userConfirmation: UserConfirmationState;
  lifecycle: LifecycleState;
  updatedAt: Timestamp;
  /**
   * 最后一次修改该实体时的地图版本号。用于检测 Agent 基于过期基线的覆盖写。
   */
  revision: number;
}
export interface ActiveChange {
  changeSetId: Identifier;
  sessionId: Identifier;
  intent: string;
  startedAt: Timestamp;
  plannedFiles?: WorkspacePath[];
  touchedNodeIds: Identifier[];
  touchedEdgeIds: Identifier[];
  proposalId?: Identifier;
  approvalToken?: Identifier;
  approvedScope?: WorkspacePath[];
  permissionMode?: 'enforced' | 'monitored';
  baseMapRevision?: number;
  baseGitRevision?: string;
  /**
   * @maxItems 2000
   */
  preexistingChanges?: WorkspacePath[];
  /**
   * @maxItems 50
   */
  scopeExpansionRequests?: ScopeExpansionRequest[];
  executionStatus?: 'in_progress' | 'scope_violation' | 'conflicted' | 'interrupted' | 'failed';
  diff?: ChangeDiffSummary;
}
export interface CompletedChange {
  changeSetId: Identifier;
  proposalId: Identifier;
  status: 'pending_review' | 'accepted' | 'accepted_with_issues' | 'failed' | 'interrupted';
  completedAt: Timestamp;
  plannedFiles: WorkspacePath[];
  actualFiles: WorkspacePath[];
  touchedNodeIds?: Identifier[];
  touchedEdgeIds?: Identifier[];
  diff: ChangeDiffSummary;
  note?: string;
}
/**
 * 覆盖率以插件生成的第一方文件清单为分母，禁止由 Agent 自报节点数量计算。
 */
export interface CoverageReport {
  includedSources: number;
  includedConfigs: number;
  includedAssets: number;
  classified: number;
  unclassified: number;
  excluded: number;
  failed: number;
  /**
   * @maxItems 5000
   */
  unclassifiedPaths?: WorkspacePath[];
  reasons: CoverageReason[];
  computedAt: Timestamp;
}
export interface CoverageReason {
  reason: string;
  count: number;
}
export interface DriftFinding {
  kind: DriftKind;
  detail: string;
  targetId?: Identifier;
  path?: WorkspacePath;
  detectedAt?: Timestamp;
}
export interface ToolResult {
  accepted: boolean;
  mapRevision: number;
  eventId?: Identifier;
  changeSetId?: Identifier;
  scopeExpansionRequest?: ScopeExpansionRequest;
  errors: ToolError[];
  warnings?: ShortNote[];
}
export interface ToolError {
  code: string;
  message: string;
  path?: string;
}
export interface GetMapInput {
  includeCoverage?: boolean;
  /**
   * @maxItems 200
   */
  nodeIds?: Identifier[];
}
export interface GetMapResult {
  mapRevision: number;
  branchKey: Identifier;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stories?: GuidedStory[];
  annotations?: AnnotationThread[];
  writeAccessRequests?: WriteAccessRequest[];
  changeProposals?: ChangeProposal[];
  activeChanges?: ActiveChange[];
  coverage?: CoverageReport;
}
/**
 * 所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。
 */
export interface SessionScopedInput {
  sessionId: Identifier;
  idempotencyKey: Identifier;
  baseMapRevision?: number;
  changeSetId?: Identifier;
}
/**
 * UI 只展示 Adapter 真实声明的能力，不通过 Agent 名称猜测。
 */
export interface AdapterCapabilities {
  adapterId: Identifier;
  displayName?: string;
  protocolVersion: ProtocolVersion;
  canBeInvoked: boolean;
  supportsMcp: boolean;
  /**
   * enforced 表示运行时强制限制；monitored 表示只能通过文件/Git 变化监控，不得描述为强制。
   */
  explainPermissionMode: 'enforced' | 'monitored';
  supportsScopeEnforcement?: boolean;
  supportsCancellation: boolean;
  supportsStreaming?: boolean;
  /**
   * Adapter 无法确认数据去向时必须为 true。
   */
  maySendCodeToCloud: boolean;
  costEstimateAvailable?: boolean;
}
