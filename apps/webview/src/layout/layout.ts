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
}

export interface LayoutResult {
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}

const columnOrder: readonly LayoutColumn[] = ['entry', 'core', 'storage', 'external'];
const columnGap = 320;
const rowGap = 120;

/**
 * 确定性分层布局。
 *
 * 纯函数：相同输入必然得到相同坐标，因此可以在 Worker 中运行、可以直接单测，
 * 也不会在每次快照刷新时把图抖成另一个样子。
 *
 * 核心列内部按依赖深度再分层，让「谁调用谁」在横向上可读。
 */
export function computeLayout(request: LayoutRequest): LayoutResult {
  const auto = request.nodes.filter((node) => request.pinned[node.id] === undefined);
  const depth = computeDepth(auto, request.edges);

  const lanes = new Map<string, LayoutNodeInput[]>();
  for (const node of auto) {
    const lane = laneKey(node, depth.get(node.id) ?? 0);
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
    // 重要节点靠上；同权重按 label 排序，避免 Map 迭代顺序影响结果。
    const ordered = [...members].sort(
      (left, right) => right.weight - left.weight || left.label.localeCompare(right.label),
    );
    const top = -((ordered.length - 1) * rowGap) / 2;
    ordered.forEach((node, index) => {
      positions[node.id] = { x, y: top + index * rowGap };
    });
  }
  for (const [id, position] of Object.entries(request.pinned)) {
    positions[id] = { x: position.x, y: position.y };
  }
  return { positions };
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

function laneKey(node: LayoutNodeInput, depth: number): string {
  // 只有核心列按深度细分；入口、存储和外部系统保持单列，让边界一眼可见。
  return node.column === 'core' ? `core:${String(depth)}` : `${node.column}:0`;
}

function laneX(lane: string): number {
  const [column = 'core', rawDepth = '0'] = lane.split(':');
  const base = columnOrder.indexOf(column as LayoutColumn);
  const depth = Number.parseInt(rawDepth, 10);
  return (base < 0 ? 1 : base) * columnGap + depth * columnGap;
}

function compareLane(left: readonly [string, unknown], right: readonly [string, unknown]): number {
  return laneX(left[0]) - laneX(right[0]) || left[0].localeCompare(right[0]);
}
