import type { Identifier } from '@god-view/protocol';

export interface LayoutNodeInput {
  readonly id: Identifier;
  /** 排序键，保证同一份输入总是得到同一份布局。 */
  readonly label: string;
  readonly column: LayoutColumn;
  readonly weight: number;
}

export interface LayoutEdgeInput {
  readonly from: Identifier;
  readonly to: Identifier;
}

/** 语义泳道。Agent 只能通过 visualHint 建议，最终归入哪一列由布局引擎决定。 */
export type LayoutColumn = 'entry' | 'core' | 'storage' | 'external';

export interface LayoutRequest {
  readonly nodes: readonly LayoutNodeInput[];
  readonly edges: readonly LayoutEdgeInput[];
  /** 用户拖拽过的节点。这些坐标是用户的决定，布局引擎不得覆盖。 */
  readonly pinned: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  /** 常规渲染保留语义泳道；用户显式整理时使用依赖拓扑。 */
  readonly mode?: 'semantic' | 'topological';
}

export interface LayoutResult {
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}

const columnOrder: readonly LayoutColumn[] = ['entry', 'core', 'storage', 'external'];
// Webview 常与详情栏并排显示；过宽泳道会把 9 个模块压缩成不可读的缩略图。
const columnGap = 240;
const rowGap = 108;
// Cytoscape 节点最大文字宽 160px，另有 padding/border。布局以完整可视矩形而不是
// 中心点判重，并额外留下端口与关系线可辨认的空隙。
const nodeFootprintWidth = 224;
const nodeFootprintHeight = 96;

/**
 * 确定性分层布局。
 *
 * 纯函数：相同输入必然得到相同坐标，因此可以在 Worker 中运行、可以直接单测，
 * 也不会在每次快照刷新时把图抖成另一个样子。
 *
 * 核心列内部按依赖深度纵向排序；横向只使用四条互不重叠的语义泳道。
 * 这样 storage/external 不会与较深的 core 节点落在同一坐标上。
 */
export function computeLayout(request: LayoutRequest): LayoutResult {
  if (request.mode === 'topological') return computeTopologicalLayout(request);
  const auto = request.nodes.filter((node) => request.pinned[node.id] === undefined);
  const depth = computeDepth(auto, request.edges);

  const lanes = new Map<string, LayoutNodeInput[]>();
  for (const node of auto) {
    const lane = node.column;
    const bucket = lanes.get(lane);
    if (bucket === undefined) {
      lanes.set(lane, [node]);
    } else {
      bucket.push(node);
    }
  }

  const positions: Record<string, { x: number; y: number }> = {};
  for (const [lane, members] of [...lanes.entries()].sort(compareLane)) {
    const x = laneX(lane);
    // 核心泳道按依赖深度排列，随后按重要性和 label 稳定排序。
    const ordered = [...members].sort(
      (left, right) =>
        (depth.get(left.id) ?? 0) - (depth.get(right.id) ?? 0) ||
        right.weight - left.weight ||
        left.label.localeCompare(right.label),
    );
    const top = -((ordered.length - 1) * rowGap) / 2;
    ordered.forEach((node, index) => {
      positions[node.id] = { x, y: top + index * rowGap };
    });
  }
  for (const [id, position] of Object.entries(request.pinned)) {
    positions[id] = { x: position.x, y: position.y };
  }
  return { positions: resolveNodeOverlaps(request.nodes, positions) };
}

const topologyColumnGap = 320;
const topologyRowGap = 144;

/**
 * 用户显式触发的拓扑整理。
 *
 * 先把环压缩成强连通分量，再对 DAG 做最长路径分层；随后以重心法在相邻层之间
 * 往返排序，降低边的逆序交叉。此模式刻意忽略 pinned：按钮的语义就是放弃旧手工
 * 坐标并重新整理，整理完成后用户仍可继续拖动。
 */
export function computeTopologicalLayout(request: LayoutRequest): LayoutResult {
  if (request.nodes.length === 0) return { positions: {} };
  const orderedNodes = [...request.nodes].sort(compareNode);
  const known = new Set(orderedNodes.map((node) => node.id));
  const edges = request.edges
    .filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to)
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  // 真实架构图经常包含回调与双向数据流，一个巨大 SCC 不能被粗暴塞进同一列。
  // 先用反馈弧启发式给循环图找稳定方向，再只用向前边做最长路径分层。
  const dependencyOrder = feedbackArcOrder(orderedNodes, edges);
  const orderIndex = new Map(dependencyOrder.map((id, index) => [id, index] as const));
  const forwardEdges = edges.filter(
    (edge) => (orderIndex.get(edge.from) ?? 0) < (orderIndex.get(edge.to) ?? 0),
  );
  const rankOf = nodeRanks(dependencyOrder, forwardEdges);

  const layers = new Map<number, LayoutNodeInput[]>();
  for (const node of orderedNodes) {
    const rank = rankOf.get(node.id) ?? 0;
    const bucket = layers.get(rank);
    if (bucket === undefined) layers.set(rank, [node]);
    else bucket.push(node);
  }
  for (const members of layers.values()) members.sort(compareNode);

  // 四次双向 sweep 对常见的 5–20 模块图足够稳定，也不会让点击产生可感知停顿。
  for (let sweep = 0; sweep < 4; sweep += 1) {
    const ranksAscending = [...layers.keys()].sort((left, right) => left - right);
    for (const rank of ranksAscending.slice(1)) {
      reorderLayer(layers, rank, edges, true);
    }
    for (const rank of [...ranksAscending].reverse().slice(1)) {
      reorderLayer(layers, rank, edges, false);
    }
  }

  const positions: Record<string, { x: number; y: number }> = {};
  for (const [rank, members] of [...layers.entries()].sort(([left], [right]) => left - right)) {
    const top = -((members.length - 1) * topologyRowGap) / 2;
    members.forEach((node, index) => {
      positions[node.id] = { x: rank * topologyColumnGap, y: top + index * topologyRowGap };
    });
  }
  return { positions: resolveNodeOverlaps(request.nodes, positions) };
}

/**
 * 确保任意两个节点的可视矩形都不相交。
 *
 * 增量补图时旧节点通常全部带 pinned 坐标，新文件节点则来自自动布局；单纯合并两组
 * 坐标会产生截图中的覆盖。这里按当前画面从上到下稳定放置，发生碰撞时只沿纵向推开，
 * 保留原来的语义泳道和大致阅读顺序。
 */
export function resolveNodeOverlaps(
  nodes: readonly LayoutNodeInput[],
  input: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
): Readonly<Record<string, { readonly x: number; readonly y: number }>> {
  const nodeById = new Map(nodes.map((item) => [item.id, item] as const));
  const ordered = Object.entries(input).sort(([leftId, left], [rightId, right]) => {
    const leftNode = nodeById.get(leftId);
    const rightNode = nodeById.get(rightId);
    return (
      left.y - right.y ||
      left.x - right.x ||
      (leftNode !== undefined && rightNode !== undefined
        ? compareNode(leftNode, rightNode)
        : leftId.localeCompare(rightId))
    );
  });
  const resolved: Record<string, { x: number; y: number }> = {};
  const placed: { readonly id: string; readonly x: number; readonly y: number }[] = [];
  for (const [id, original] of ordered) {
    let y = original.y;
    let guard = 0;
    while (guard < ordered.length * 2) {
      const collision = placed.find(
        (other) =>
          Math.abs(original.x - other.x) < nodeFootprintWidth &&
          Math.abs(y - other.y) < nodeFootprintHeight,
      );
      if (collision === undefined) break;
      y = collision.y + nodeFootprintHeight;
      guard += 1;
    }
    resolved[id] = { x: original.x, y };
    placed.push({ id, x: original.x, y });
  }
  return resolved;
}

function feedbackArcOrder(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
): readonly Identifier[] {
  const remaining = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const left: Identifier[] = [];
  const right: Identifier[] = [];
  const degrees = (id: Identifier): { incoming: number; outgoing: number } => ({
    incoming: edges.filter((edge) => edge.to === id && remaining.has(edge.from)).length,
    outgoing: edges.filter((edge) => edge.from === id && remaining.has(edge.to)).length,
  });
  const stable = (ids: readonly Identifier[]): Identifier[] =>
    [...ids].sort((leftId, rightId) => {
      const leftNode = nodeById.get(leftId);
      const rightNode = nodeById.get(rightId);
      if (leftNode === undefined || rightNode === undefined) return leftId.localeCompare(rightId);
      return compareNode(leftNode, rightNode);
    });

  while (remaining.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      const sinks = stable([...remaining].filter((id) => degrees(id).outgoing === 0));
      for (const id of sinks) {
        remaining.delete(id);
        right.unshift(id);
        changed = true;
      }
      const sources = stable([...remaining].filter((id) => degrees(id).incoming === 0));
      for (const id of sources) {
        remaining.delete(id);
        left.push(id);
        changed = true;
      }
    }
    if (remaining.size === 0) break;
    const candidate = stable([...remaining]).sort((leftId, rightId) => {
      const leftDegree = degrees(leftId);
      const rightDegree = degrees(rightId);
      return (
        rightDegree.outgoing - rightDegree.incoming - (leftDegree.outgoing - leftDegree.incoming) ||
        leftId.localeCompare(rightId)
      );
    })[0];
    if (candidate === undefined) break;
    remaining.delete(candidate);
    left.push(candidate);
  }
  return [...left, ...right];
}

function nodeRanks(
  order: readonly Identifier[],
  edges: readonly LayoutEdgeInput[],
): ReadonlyMap<Identifier, number> {
  const ranks = new Map<Identifier, number>();
  for (const id of order) {
    const predecessors = edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    ranks.set(
      id,
      predecessors.reduce(
        (rank, predecessor) => Math.max(rank, (ranks.get(predecessor) ?? -1) + 1),
        0,
      ),
    );
  }
  return ranks;
}

function reorderLayer(
  layers: Map<number, LayoutNodeInput[]>,
  rank: number,
  edges: readonly LayoutEdgeInput[],
  usePredecessors: boolean,
): void {
  const members = layers.get(rank);
  const adjacent = layers.get(rank + (usePredecessors ? -1 : 1));
  if (members === undefined || adjacent === undefined || members.length < 2) return;
  const adjacentOrder = new Map(adjacent.map((node, index) => [node.id, index] as const));
  const previousOrder = new Map(members.map((node, index) => [node.id, index] as const));
  const score = (id: Identifier): number => {
    const neighbours = edges
      .flatMap((edge) =>
        usePredecessors && edge.to === id
          ? [edge.from]
          : !usePredecessors && edge.from === id
            ? [edge.to]
            : [],
      )
      .map((neighbour) => adjacentOrder.get(neighbour))
      .filter((value): value is number => value !== undefined);
    return neighbours.length === 0
      ? (previousOrder.get(id) ?? 0)
      : neighbours.reduce((sum, value) => sum + value, 0) / neighbours.length;
  };
  members.sort(
    (left, right) =>
      score(left.id) - score(right.id) ||
      (previousOrder.get(left.id) ?? 0) - (previousOrder.get(right.id) ?? 0) ||
      compareNode(left, right),
  );
}

function compareNode(left: LayoutNodeInput, right: LayoutNodeInput): number {
  return (
    right.weight - left.weight ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * 核心节点的依赖深度。
 *
 * 从入口出发做广度优先；图中允许存在环，因此每个节点只取首次到达的深度。
 */
function computeDepth(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
): ReadonlyMap<Identifier, number> {
  const known = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<Identifier, Identifier[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      continue;
    }
    const bucket = outgoing.get(edge.from);
    if (bucket === undefined) {
      outgoing.set(edge.from, [edge.to]);
    } else {
      bucket.push(edge.to);
    }
  }

  const depth = new Map<Identifier, number>();
  const roots = nodes
    .filter((node) => node.column === 'entry')
    .map((node) => node.id)
    .sort();
  let frontier =
    roots.length > 0
      ? roots
      : nodes
          .map((node) => node.id)
          .sort()
          .slice(0, 1);
  let level = 0;
  for (const id of frontier) {
    depth.set(id, 0);
  }
  while (frontier.length > 0 && level < nodes.length) {
    level += 1;
    const next: Identifier[] = [];
    for (const id of frontier) {
      for (const target of [...(outgoing.get(id) ?? [])].sort()) {
        if (!depth.has(target)) {
          depth.set(target, level);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

function laneX(lane: string): number {
  const base = columnOrder.indexOf(lane as LayoutColumn);
  return (base < 0 ? 1 : base) * columnGap;
}

function compareLane(left: readonly [string, unknown], right: readonly [string, unknown]): number {
  return laneX(left[0]) - laneX(right[0]) || left[0].localeCompare(right[0]);
}
