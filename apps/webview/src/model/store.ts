import type {
  AnnotationThread,
  ActiveChange,
  ChangeProposal,
  CompletedChange,
  CoverageReport,
  DriftFinding,
  GraphEdge,
  GraphNode,
  GuidedStory,
  GraphSnapshotDocument,
  Identifier,
  WriteAccessRequest,
} from '@god-view/protocol';
import type { MapPatch, ViewCapabilities } from '@god-view/webview-bridge';

/** 用户拖拽后的坐标，按 workspace + branch 持久化在扩展侧。 */
export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export type LayoutPositions = Readonly<Record<string, NodePosition>>;

/**
 * Webview 侧的地图真源。
 *
 * 业务状态只存在这里，不放进 Cytoscape 实例或 React 组件局部 state
 * （TECHNICAL_ARCHITECTURE.md §10.1）。React 通过订阅读取，Cytoscape 只做渲染映射。
 */
export interface MapState {
  readonly revision: number;
  /**
   * 事实版本，与图版本相互独立。
   *
   * 删除一个文件不改变图，只改变覆盖率与漂移。用图版本给这类更新排序会把它们
   * 当成过期消息丢掉，UI 就永远停在旧数值上。
   */
  readonly factsRevision: number;
  readonly nodes: ReadonlyMap<Identifier, GraphNode>;
  readonly edges: ReadonlyMap<Identifier, GraphEdge>;
  readonly stories: ReadonlyMap<Identifier, GuidedStory>;
  readonly annotations: ReadonlyMap<Identifier, AnnotationThread>;
  readonly writeAccessRequests: ReadonlyMap<Identifier, WriteAccessRequest>;
  readonly changeProposals: ReadonlyMap<Identifier, ChangeProposal>;
  readonly activeChanges: ReadonlyMap<Identifier, ActiveChange>;
  readonly completedChanges: ReadonlyMap<Identifier, CompletedChange>;
  readonly drift: readonly DriftFinding[];
  readonly coverage: CoverageReport | undefined;
  readonly capabilities: ViewCapabilities | undefined;
  readonly layout: LayoutPositions;
  /** 已收到首帧快照。未收到前 UI 显示加载态，而不是空地图。 */
  readonly hydrated: boolean;
}

export const emptyMapState: MapState = {
  revision: 0,
  factsRevision: 0,
  nodes: new Map(),
  edges: new Map(),
  stories: new Map(),
  annotations: new Map(),
  writeAccessRequests: new Map(),
  changeProposals: new Map(),
  activeChanges: new Map(),
  completedChanges: new Map(),
  drift: [],
  coverage: undefined,
  capabilities: undefined,
  layout: {},
  hydrated: false,
};

/** 用完整快照替换状态。快照是权威的，不与既有内容合并。 */
export function applySnapshot(
  state: MapState,
  input: {
    readonly document: GraphSnapshotDocument;
    readonly capabilities: ViewCapabilities;
    readonly factsRevision: number;
    readonly drift: readonly DriftFinding[];
    readonly coverage?: CoverageReport;
    readonly layout?: LayoutPositions;
  },
): MapState {
  const coverage = input.coverage ?? input.document.coverage;
  return {
    revision: input.document.revision,
    // 快照重置事实基线：切分支后新分支的事实版本可能比旧分支小，
    // 沿用旧基线会让新分支的事实更新全部被丢弃。
    factsRevision: input.factsRevision,
    nodes: new Map(input.document.nodes.map((node) => [node.id, node])),
    edges: new Map(input.document.edges.map((edge) => [edge.id, edge])),
    stories: new Map((input.document.stories ?? []).map((story) => [story.id, story])),
    annotations: new Map(
      (input.document.annotations ?? []).map((annotation) => [annotation.id, annotation]),
    ),
    writeAccessRequests: new Map(
      (input.document.writeAccessRequests ?? []).map((request) => [request.id, request]),
    ),
    changeProposals: new Map(
      (input.document.changeProposals ?? []).map((proposal) => [proposal.id, proposal]),
    ),
    activeChanges: new Map(
      (input.document.activeChanges ?? []).map((change) => [change.changeSetId, change]),
    ),
    completedChanges: new Map(
      (input.document.completedChanges ?? []).map((change) => [change.changeSetId, change]),
    ),
    drift: input.drift,
    coverage,
    capabilities: input.capabilities,
    // 扩展侧没有存过布局时保留当前布局，避免刷新快照把用户拖拽结果清零。
    layout: input.layout ?? state.layout,
    hydrated: true,
  };
}

/**
 * 应用增量补丁。
 *
 * 旧补丁（revision 不大于当前）直接丢弃：消息可能乱序到达，重放过期补丁
 * 会让视图倒退。首帧快照到达前的补丁同样丢弃，避免拼出残缺的图。
 */
export function applyPatch(
  state: MapState,
  input: {
    readonly revision: number;
    readonly factsRevision: number;
    readonly patch: MapPatch;
    readonly drift: readonly DriftFinding[];
    readonly coverage?: CoverageReport;
  },
): MapState {
  if (!state.hydrated || input.revision <= state.revision) {
    return state;
  }
  const nodes = patchMap(
    state.nodes,
    input.patch.upsertedNodes,
    input.patch.removedNodeIds,
    (v) => v.id,
  );
  const edges = patchMap(
    state.edges,
    input.patch.upsertedEdges,
    input.patch.removedEdgeIds,
    (v) => v.id,
  );
  const stories = patchMap(state.stories, input.patch.upsertedStories ?? [], [], (v) => v.id);
  const annotations = patchMap(
    state.annotations,
    input.patch.upsertedAnnotations ?? [],
    [],
    (v) => v.id,
  );
  const writeAccessRequests = patchMap(
    state.writeAccessRequests,
    input.patch.upsertedWriteAccessRequests ?? [],
    [],
    (v) => v.id,
  );
  const changeProposals = patchMap(
    state.changeProposals,
    input.patch.upsertedChangeProposals ?? [],
    [],
    (v) => v.id,
  );
  const activeChanges = patchMap(
    state.activeChanges,
    input.patch.upsertedActiveChanges ?? [],
    input.patch.removedActiveChangeIds ?? [],
    (v) => v.changeSetId,
  );
  const completedChanges = patchMap(
    state.completedChanges,
    input.patch.upsertedCompletedChanges ?? [],
    [],
    (value) => value.changeSetId,
  );
  // 移除节点后残留的悬空边会让 Cytoscape 抛错，这里统一清掉。
  for (const [id, edge] of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      edges.delete(id);
    }
  }
  return {
    ...state,
    revision: input.revision,
    factsRevision: Math.max(state.factsRevision, input.factsRevision),
    nodes,
    edges,
    stories,
    annotations,
    writeAccessRequests,
    changeProposals,
    activeChanges,
    completedChanges,
    drift: input.drift,
    coverage: input.coverage ?? state.coverage,
  };
}

function patchMap<T>(
  current: ReadonlyMap<Identifier, T>,
  upserted: readonly T[],
  removed: readonly Identifier[],
  idOf: (value: T) => Identifier,
): Map<Identifier, T> {
  const next = new Map(current);
  for (const id of removed) next.delete(id);
  for (const value of upserted) next.set(idOf(value), value);
  return next;
}

/**
 * 只更新覆盖率与漂移，不动图。
 *
 * 按 factsRevision 排序而不是图版本：文件增删改通常不改变图，图版本不会递增，
 * 用它判断新旧会把每一条事实更新都判成过期。
 */
export function applyFacts(
  state: MapState,
  input: {
    readonly factsRevision: number;
    readonly drift: readonly DriftFinding[];
    readonly coverage?: CoverageReport;
  },
): MapState {
  if (!state.hydrated || input.factsRevision <= state.factsRevision) {
    return state;
  }
  return {
    ...state,
    factsRevision: input.factsRevision,
    drift: input.drift,
    coverage: input.coverage ?? state.coverage,
  };
}

/** 记录用户拖拽结果。位置由用户掌握，Agent 的语义更新不得覆盖它。 */
export function applyLayout(state: MapState, positions: LayoutPositions): MapState {
  return { ...state, layout: { ...state.layout, ...positions } };
}
