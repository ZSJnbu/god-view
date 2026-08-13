import type { EdgeType, GraphEdge, GraphNode, Identifier, NodeType } from '@god-view/protocol';
import type { MapState } from './store.js';

/**
 * 细节层级（TECHNICAL_ARCHITECTURE.md §10.2）。
 *
 * 同一张画布用 LOD 表达三种粒度，而不是分页或断开的子图。
 */
export type DetailLevel = 'overview' | 'modules' | 'files';

export interface ViewOptions {
  readonly level: DetailLevel;
  /** 聚焦模式：只渲染目标的一到两层邻域。 */
  readonly focusNodeId?: Identifier;
  readonly focusDepth?: 1 | 2;
  readonly query?: string;
}

export interface VisibleNode {
  readonly node: GraphNode;
  /** 被折叠进该节点的后代数量，0 表示没有折叠。 */
  readonly rolledUpCount: number;
}

export interface VisibleEdge {
  readonly id: Identifier;
  readonly from: Identifier;
  readonly to: Identifier;
  /** 聚合后的代表关系类型；`mixed` 表示底层关系类型不一致。 */
  readonly type: EdgeType | 'mixed';
  /** 聚合了多少条底层关系。远景下模块边显示该计数。 */
  readonly count: number;
  readonly memberIds: readonly Identifier[];
  /** 用于连线悬停说明；聚合边保留最多两条原始理由，避免标签无限增长。 */
  readonly description: string;
}

export interface VisibleGraph {
  readonly nodes: readonly VisibleNode[];
  readonly edges: readonly VisibleEdge[];
  /** 因聚焦邻域而未绘制的节点数。用于告知用户「少画了」而不是假装不存在。 */
  readonly clippedNodeCount: number;
}

/** 各节点类型最早出现在哪个层级。文件级只在近景出现。 */
const levelForType: Record<NodeType, DetailLevel> = {
  group: 'overview',
  entry: 'modules',
  module: 'modules',
  service: 'modules',
  external_system: 'overview',
  storage: 'modules',
  file: 'files',
  unclassified: 'files',
};

const levelRank: Record<DetailLevel, number> = { overview: 0, modules: 1, files: 2 };

/**
 * 把完整图投影成当前层级下应当绘制的图。
 *
 * 投影只减少绘制，不改变可寻址性：被折叠的节点仍然可以被搜索命中，
 * 并通过 {@link resolveVisibleAnchor} 定位到代表它的可见节点。
 */
export function buildVisibleGraph(state: MapState, options: ViewOptions): VisibleGraph {
  const representative = buildRollUp(state, options.level);
  const rolledUpCount = new Map<Identifier, number>();
  for (const [id, target] of representative) {
    if (id !== target) {
      rolledUpCount.set(target, (rolledUpCount.get(target) ?? 0) + 1);
    }
  }

  const visibleIds = new Set(representative.values());
  const aggregated = aggregateEdges(state.edges.values(), representative, visibleIds);
  const focused = applyFocus(visibleIds, aggregated, options);

  const nodes: VisibleNode[] = [];
  for (const id of focused.nodeIds) {
    const node = state.nodes.get(id);
    if (node !== undefined) {
      nodes.push({ node, rolledUpCount: rolledUpCount.get(id) ?? 0 });
    }
  }
  return {
    nodes,
    edges: focused.edges,
    clippedNodeCount: visibleIds.size - focused.nodeIds.size,
  };
}

/** 每个节点在当前层级由哪个节点代表（自身或最近的可见祖先）。 */
function buildRollUp(state: MapState, level: DetailLevel): ReadonlyMap<Identifier, Identifier> {
  const maxRank = levelRank[level];
  const result = new Map<Identifier, Identifier>();
  for (const node of state.nodes.values()) {
    result.set(node.id, findRepresentative(state, node, maxRank));
  }
  return result;
}

function findRepresentative(state: MapState, node: GraphNode, maxRank: number): Identifier {
  let current: GraphNode | undefined = node;
  let fallback: Identifier = node.id;
  const seen = new Set<Identifier>();
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (levelRank[levelForType[current.type]] <= maxRank) {
      return current.id;
    }
    fallback = current.id;
    const parentId: Identifier | undefined = current.parentId;
    current = parentId === undefined ? undefined : state.nodes.get(parentId);
  }
  // 没有任何祖先适合当前层级时保留节点本身：宁可多画，也不静默丢弃实体。
  return fallback;
}

function aggregateEdges(
  edges: Iterable<GraphEdge>,
  representative: ReadonlyMap<Identifier, Identifier>,
  visibleIds: ReadonlySet<Identifier>,
): readonly VisibleEdge[] {
  const buckets = new Map<string, { from: Identifier; to: Identifier; members: GraphEdge[] }>();
  for (const edge of edges) {
    const from = representative.get(edge.from);
    const to = representative.get(edge.to);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    if (!visibleIds.has(from) || !visibleIds.has(to)) {
      continue;
    }
    // NUL 作为源码字节会让 Git 和审查工具把 TypeScript 误判为二进制；节点 ID 不允许
    // 控制字符，因此用可见分隔符组成仅供聚合 Map 使用的内部 key。
    const key = `${from}->${to}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { from, to, members: [edge] });
    } else {
      bucket.members.push(edge);
    }
  }

  return [...buckets.entries()].map(([key, bucket]) => {
    const types = new Set(bucket.members.map((member) => member.type));
    const first = bucket.members[0];
    return {
      id: bucket.members.length === 1 && first !== undefined ? first.id : `agg:${key}`,
      from: bucket.from,
      to: bucket.to,
      type: types.size === 1 && first !== undefined ? first.type : 'mixed',
      count: bucket.members.length,
      memberIds: bucket.members.map((member) => member.id),
      description: summarizeReasons(bucket.members),
    };
  });
}

function summarizeReasons(edges: readonly GraphEdge[]): string {
  const reasons = [
    ...new Set(
      edges.map((edge) => edge.reason?.trim()).filter((reason): reason is string => !!reason),
    ),
  ];
  if (reasons.length === 0) return '地图中未提供补充说明';
  const shown = reasons.slice(0, 2).join('；');
  return reasons.length > 2 ? `${shown}；另有 ${String(reasons.length - 2)} 条` : shown;
}

function applyFocus(
  visibleIds: ReadonlySet<Identifier>,
  edges: readonly VisibleEdge[],
  options: ViewOptions,
): { nodeIds: ReadonlySet<Identifier>; edges: readonly VisibleEdge[] } {
  const focusId = options.focusNodeId;
  if (focusId === undefined || !visibleIds.has(focusId)) {
    return { nodeIds: visibleIds, edges };
  }
  const depth = options.focusDepth ?? 1;
  const neighbours = new Map<Identifier, Set<Identifier>>();
  for (const edge of edges) {
    addNeighbour(neighbours, edge.from, edge.to);
    addNeighbour(neighbours, edge.to, edge.from);
  }
  const kept = new Set<Identifier>([focusId]);
  let frontier: Identifier[] = [focusId];
  for (let step = 0; step < depth; step += 1) {
    const next: Identifier[] = [];
    for (const id of frontier) {
      for (const neighbour of neighbours.get(id) ?? []) {
        if (!kept.has(neighbour)) {
          kept.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return {
    nodeIds: kept,
    edges: edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}

function addNeighbour(
  map: Map<Identifier, Set<Identifier>>,
  from: Identifier,
  to: Identifier,
): void {
  const existing = map.get(from);
  if (existing === undefined) {
    map.set(from, new Set([to]));
  } else {
    existing.add(to);
  }
}

/**
 * 搜索在全量节点上进行。
 *
 * 视口裁剪与 LOD 折叠只影响绘制，不影响搜索命中范围（§10.2）。
 */
export function searchNodes(state: MapState, query: string): readonly GraphNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  return [...state.nodes.values()]
    .filter((node) => matches(node, needle))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function matches(node: GraphNode, needle: string): boolean {
  if (node.label.toLowerCase().includes(needle)) {
    return true;
  }
  if ((node.responsibility ?? '').toLowerCase().includes(needle)) {
    return true;
  }
  return (node.paths ?? []).some((path) => path.toLowerCase().includes(needle));
}

/** 搜索命中被折叠时，返回当前层级下代表它的可见节点。 */
export function resolveVisibleAnchor(
  state: MapState,
  level: DetailLevel,
  nodeId: Identifier,
): Identifier | undefined {
  const node = state.nodes.get(nodeId);
  if (node === undefined) {
    return undefined;
  }
  return findRepresentative(state, node, levelRank[level]);
}
