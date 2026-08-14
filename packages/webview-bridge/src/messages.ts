import type {
  CoverageReport,
  AnnotationThread,
  ActiveChange,
  ChangeProposal,
  CompletedChange,
  DriftFinding,
  GraphEdge,
  GraphNode,
  GuidedStory,
  GraphSnapshotDocument,
  Identifier,
  WorkspacePath,
  WriteAccessRequest,
} from '@god-view/protocol';

/**
 * Extension ↔ Webview 的消息契约。
 *
 * Command 表示请求、Event 表示已经发生的事实，两者分离
 * （TECHNICAL_ARCHITECTURE.md §6.3）：Webview 不得直接伪造领域事件，
 * 只能发送命令由扩展侧领域层验证后产生事件。
 */

/** 当前环境的能力，用于让 UI 明确禁用而不是伪装可用。 */
export interface ViewCapabilities {
  /** 无 Git 工作区只开放建图、浏览和解释。 */
  readonly hasGit: boolean;
  /** 当前 Adapter 能否由扩展主动调用；仅复制任务时必须为 false。 */
  readonly canExecuteChanges: boolean;
  /** 来自 VS Code 与系统的减少动态效果设置。 */
  readonly reducedMotion: boolean;
  readonly branchKey: Identifier;
}

export interface MapPatch {
  readonly upsertedNodes: readonly GraphNode[];
  readonly upsertedEdges: readonly GraphEdge[];
  readonly removedNodeIds: readonly Identifier[];
  readonly removedEdgeIds: readonly Identifier[];
  /** 协议 1.1 起支持；旧扩展消息缺失时按空数组处理。 */
  readonly upsertedStories?: readonly GuidedStory[];
  /** 协议 1.1 起支持；标注事件与图实体共享 revision 排序。 */
  readonly upsertedAnnotations?: readonly AnnotationThread[];
  /** 协议 1.3 起支持；写入请求本身不构成授权。 */
  readonly upsertedWriteAccessRequests?: readonly WriteAccessRequest[];
  /** 协议 1.3 起支持；只有宿主签发 approval 后才可启动 ChangeSet。 */
  readonly upsertedChangeProposals?: readonly ChangeProposal[];
  readonly upsertedActiveChanges?: readonly ActiveChange[];
  readonly removedActiveChangeIds?: readonly Identifier[];
  readonly upsertedCompletedChanges?: readonly CompletedChange[];
}

export type SyncState = 'idle' | 'receiving' | 'validating' | 'degraded';

export type ConfigurableAgent = 'codex' | 'claude-code';

export interface AgentConfigurationView {
  readonly agent: ConfigurableAgent;
  readonly displayName: string;
  readonly installed: boolean;
  readonly version?: string;
  readonly configuration: 'checking' | 'missing' | 'current' | 'conflict' | 'error';
  readonly workspaceRoot: string;
  readonly detail?: string;
}

export interface AgentFloatingBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AgentPaneView {
  readonly mode: 'docked' | 'floating';
  readonly floatingBounds: AgentFloatingBounds;
}

/**
 * 扩展 → Webview。
 *
 * 图与事实是**两条独立的时间线**，各自有单调递增的版本号：
 * - `revision` 是图版本，只在节点/关系变化时递增；
 * - `factsRevision` 是事实版本，覆盖率与漂移每次重算都递增。
 *
 * 分开的原因：删除一个文件不会改变图，只改变漂移与覆盖率。如果用图版本给事实
 * 排序，这类更新会因为「版本没变大」被当成过期消息丢弃，UI 就停在旧数值上。
 */
export type ExtensionEvent =
  | {
      readonly type: 'map/snapshot';
      readonly document: GraphSnapshotDocument;
      readonly capabilities: ViewCapabilities;
      readonly factsRevision: number;
      readonly coverage?: CoverageReport;
      readonly drift: readonly DriftFinding[];
      readonly layout?: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
      /** 已有地图中底部原生 Agent 入口视窗的工作区级高度。 */
      readonly agentPaneHeight?: number;
      readonly agentPaneView?: AgentPaneView;
    }
  | {
      readonly type: 'map/patch';
      readonly revision: number;
      readonly factsRevision: number;
      readonly patch: MapPatch;
      readonly drift: readonly DriftFinding[];
      readonly coverage?: CoverageReport;
    }
  | {
      /** 图没变，只有覆盖率与漂移变了。 */
      readonly type: 'map/facts';
      readonly factsRevision: number;
      readonly drift: readonly DriftFinding[];
      readonly coverage?: CoverageReport;
    }
  | { readonly type: 'status'; readonly state: SyncState; readonly detail?: string }
  | {
      readonly type: 'agent/status';
      readonly agents: readonly AgentConfigurationView[];
      readonly selectedAgent?: ConfigurableAgent;
    }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

/** Webview → 扩展。 */
export type WebviewCommand =
  | { readonly type: 'ready' }
  | { readonly type: 'requestSnapshot' }
  | { readonly type: 'generateAgentTask' }
  | { readonly type: 'copyAgentSetup' }
  | { readonly type: 'configureAgent'; readonly agent: 'codex' | 'claude-code' }
  | { readonly type: 'refreshAgentStatus' }
  | { readonly type: 'openAgentTerminal'; readonly agent: ConfigurableAgent }
  | { readonly type: 'startInitialization'; readonly agent: ConfigurableAgent }
  | { readonly type: 'startReinitialization'; readonly agent: ConfigurableAgent }
  | {
      readonly type: 'startMapCompletion';
      readonly agent: ConfigurableAgent;
      readonly target: 'groups' | 'files';
    }
  | {
      readonly type: 'decideScopeExpansion';
      readonly requestId: Identifier;
      readonly changeSetId: Identifier;
      readonly decision: 'approved' | 'rejected';
    }
  | {
      readonly type: 'sendAgentMessage';
      readonly agent: ConfigurableAgent;
      readonly message: string;
      readonly mode: 'chat' | 'change';
      readonly nodeIds?: readonly Identifier[];
    }
  | {
      readonly type: 'createAnnotation';
      readonly annotationType: 'note' | 'explain' | 'risk' | 'change';
      readonly body: string;
      readonly nodeIds: readonly Identifier[];
      /** 用户在预览中明确移除的上下文路径；扩展会重新计算并校验，而非直接信任。 */
      readonly excludedPaths?: readonly WorkspacePath[];
      /** 配置可用时，创建后立即把解释任务发送到官方 Agent 终端。 */
      readonly autoAnswerAgent?: ConfigurableAgent;
    }
  | {
      readonly type: 'startAnnotationAnswer';
      readonly annotationId: Identifier;
      readonly agent: ConfigurableAgent;
    }
  | { readonly type: 'resolveAnnotation'; readonly annotationId: Identifier }
  | { readonly type: 'copyAnnotationTask'; readonly annotationId: Identifier }
  | {
      readonly type: 'approveProposal';
      readonly proposalId: Identifier;
      readonly approvedScope: readonly WorkspacePath[];
      /** 批准成功后直接把已批准任务发送到官方 Agent 终端。 */
      readonly autoStartAgent?: ConfigurableAgent;
    }
  | {
      readonly type: 'startApprovedChange';
      readonly proposalId: Identifier;
      readonly agent: ConfigurableAgent;
    }
  | { readonly type: 'rejectProposal'; readonly proposalId: Identifier }
  | { readonly type: 'copyApprovedChangeTask'; readonly proposalId: Identifier }
  | { readonly type: 'openDiff'; readonly path: WorkspacePath }
  | { readonly type: 'interruptChange'; readonly changeSetId: Identifier }
  | {
      readonly type: 'reviewChange';
      readonly changeSetId: Identifier;
      readonly status: 'accepted' | 'accepted_with_issues';
      readonly note?: string;
    }
  | {
      readonly type: 'openSource';
      readonly path: WorkspacePath;
      readonly startLine?: number;
    }
  | {
      readonly type: 'saveLayout';
      readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
    }
  | { readonly type: 'saveAgentPaneHeight'; readonly height: number }
  | { readonly type: 'saveAgentPaneView'; readonly view: AgentPaneView };

export type ExtensionEventType = ExtensionEvent['type'];
export type WebviewCommandType = WebviewCommand['type'];
