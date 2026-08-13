import type { Identifier } from '@god-view/protocol';
import type { Position } from 'cytoscape';
import { collinearOverlapLength, isHorizontal, isVertical } from './segment-geometry.js';
import {
  addBridges,
  compressCollinear,
  distance as manhattan,
  properIntersection,
  toSegments,
  type RouteSegment as Segment,
} from './route-path.js';

export interface RoutingNode {
  readonly id: Identifier;
  readonly position: Position;
  readonly width: number;
  readonly height: number;
}

export interface RoutingEdge {
  readonly id: Identifier;
  readonly from: Identifier;
  readonly to: Identifier;
}

export interface RoutedEdge {
  readonly id: Identifier;
  /** 含源/目标中心点；交给 Cytoscape 时只使用中间控制点。 */
  readonly points: readonly Position[];
  readonly bridges: number;
  /** 未插入跳线弧的正交主路径，用于可读性指标与避障复验。 */
  readonly basePoints: readonly Position[];
}

export interface RoutingMetrics {
  readonly crossings: number;
  readonly nodeIntersections: number;
  readonly overlappingPairs: number;
  readonly overlapLength: number;
}

interface Rect {
  readonly id: Identifier;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly center: Position;
}

interface SearchState {
  readonly point: number;
  readonly direction: Direction;
}

type Direction = 'start' | 'horizontal' | 'vertical';

const obstaclePadding = 16;
const outerChannel = 44;
const bendPenalty = 48;
const crossingPenalty = 280;
const overlapPenalty = 1_200;
const laneSpacing = 8;
const epsilon = 0.001;

/**
 * 确定性电路式布线。
 *
 * 每个模块是矩形障碍物；候选通道位于所有模块边界之外。Dijkstra 以路径长度、
 * 转弯和已布线路交叉为成本，随后在无法避免的交叉处给后画线路插入跳线弧。
 */
export function routeEdges(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
): ReadonlyMap<Identifier, RoutedEdge> {
  // 文件关系图可能包含上千节点；完整障碍网格适用于人能阅读的模块图，不允许拖垮大图。
  // 大图使用确定性的外侧总线路由，仍避免直线穿过模块，并保持交互响应。
  if (nodes.length > 40 || edges.length > 100) return routeLargeGraph(nodes, edges);
  const rectangles = new Map(nodes.map((node) => [node.id, toRect(node)] as const));
  const routed = new Map<Identifier, RoutedEdge>();
  const occupied: Segment[] = [];
  for (const edge of [...edges].sort((left, right) => left.id.localeCompare(right.id))) {
    const source = rectangles.get(edge.from);
    const target = rectangles.get(edge.to);
    if (source === undefined || target === undefined) continue;
    const raw = findRoute(source, target, [...rectangles.values()], occupied);
    const withBridges = addBridges(raw, occupied);
    const segments = toSegments(raw, edge.id);
    occupied.push(...segments);
    routed.set(edge.id, {
      id: edge.id,
      points: withBridges.points,
      bridges: withBridges.bridges,
      basePoints: raw,
    });
  }
  return routed;
}

function routeLargeGraph(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
): ReadonlyMap<Identifier, RoutedEdge> {
  const rectangles = new Map(nodes.map((node) => [node.id, toRect(node)] as const));
  const bounds = [...rectangles.values()].reduce(
    (current, rect) => ({
      left: Math.min(current.left, rect.left),
      right: Math.max(current.right, rect.right),
      top: Math.min(current.top, rect.top),
      bottom: Math.max(current.bottom, rect.bottom),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
  const result = new Map<Identifier, RoutedEdge>();
  [...edges]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((edge, index) => {
      const source = rectangles.get(edge.from);
      const target = rectangles.get(edge.to);
      if (source === undefined || target === undefined) return;
      const above = index % 2 === 0;
      const sourceX = source.center.x + (portOffsets(source.right - source.left)[index % 5] ?? 0);
      const targetX =
        target.center.x + (portOffsets(target.right - target.left)[(index * 3) % 5] ?? 0);
      const channelY =
        (above ? bounds.top - outerChannel : bounds.bottom + outerChannel) +
        (above ? -1 : 1) * Math.floor(index / 2) * 4;
      result.set(edge.id, {
        id: edge.id,
        points: compressCollinear([
          source.center,
          {
            x: sourceX,
            y: above ? source.top - obstaclePadding : source.bottom + obstaclePadding,
          },
          { x: sourceX, y: channelY },
          { x: targetX, y: channelY },
          {
            x: targetX,
            y: above ? target.top - obstaclePadding : target.bottom + obstaclePadding,
          },
          target.center,
        ]),
        bridges: 0,
        basePoints: compressCollinear([
          source.center,
          {
            x: sourceX,
            y: above ? source.top - obstaclePadding : source.bottom + obstaclePadding,
          },
          { x: sourceX, y: channelY },
          { x: targetX, y: channelY },
          {
            x: targetX,
            y: above ? target.top - obstaclePadding : target.bottom + obstaclePadding,
          },
          target.center,
        ]),
      });
    });
  return result;
}

function toRect(node: RoutingNode): Rect {
  return {
    id: node.id,
    left: node.position.x - node.width / 2,
    right: node.position.x + node.width / 2,
    top: node.position.y - node.height / 2,
    bottom: node.position.y + node.height / 2,
    center: node.position,
  };
}

function findRoute(
  source: Rect,
  target: Rect,
  obstacles: readonly Rect[],
  occupied: readonly Segment[],
): Position[] {
  const sourcePorts = ports(source).filter((port) =>
    stubIsClear(source.center, port, obstacles, source.id),
  );
  const targetPorts = ports(target).filter((port) =>
    stubIsClear(target.center, port, obstacles, target.id),
  );
  const xs = uniqueSorted([
    ...obstacles.flatMap((rect) => [rect.left - obstaclePadding, rect.right + obstaclePadding]),
    ...sourcePorts.map((point) => point.x),
    ...targetPorts.map((point) => point.x),
    ...occupied
      .filter((segment) => isVertical(segment.from, segment.to))
      .flatMap((segment) => [segment.from.x - laneSpacing, segment.from.x + laneSpacing]),
    Math.min(...obstacles.map((rect) => rect.left)) - outerChannel,
    Math.max(...obstacles.map((rect) => rect.right)) + outerChannel,
  ]);
  const ys = uniqueSorted([
    ...obstacles.flatMap((rect) => [rect.top - obstaclePadding, rect.bottom + obstaclePadding]),
    ...sourcePorts.map((point) => point.y),
    ...targetPorts.map((point) => point.y),
    ...occupied
      .filter((segment) => isHorizontal(segment.from, segment.to))
      .flatMap((segment) => [segment.from.y - laneSpacing, segment.from.y + laneSpacing]),
    Math.min(...obstacles.map((rect) => rect.top)) - outerChannel,
    Math.max(...obstacles.map((rect) => rect.bottom)) + outerChannel,
  ]);
  const points = xs
    .flatMap((x) => ys.map((y) => ({ x, y })))
    .filter((point) => !obstacles.some((rect) => insideExpanded(point, rect)));
  const pointIndex = new Map(points.map((point, index) => [pointKey(point), index] as const));
  const starts = sourcePorts
    .map((point) => pointIndex.get(pointKey(point)))
    .filter((index): index is number => index !== undefined);
  const goals = new Set(
    targetPorts
      .map((point) => pointIndex.get(pointKey(point)))
      .filter((index): index is number => index !== undefined),
  );
  const neighbours = buildVisibilityGraph(points, obstacles);
  const path = shortestPath(
    points,
    neighbours,
    starts,
    goals,
    occupied,
    source.center,
    target.center,
  );
  if (path.length === 0) {
    return outerFallbackRoute(source, target, obstacles, occupied);
  }
  return compressCollinear([source.center, ...path, target.center]);
}

/**
 * 网格搜索极端情况下仍必须保证不穿过模块。四个外侧通道都是明确可验证的
 * 正交候选；选择交叉最少、其次最短的一条，绝不退回穿越障碍的对角直线。
 */
function outerFallbackRoute(
  source: Rect,
  target: Rect,
  obstacles: readonly Rect[],
  occupied: readonly Segment[],
): Position[] {
  const bounds = {
    left: Math.min(...obstacles.map((rect) => rect.left)),
    right: Math.max(...obstacles.map((rect) => rect.right)),
    top: Math.min(...obstacles.map((rect) => rect.top)),
    bottom: Math.max(...obstacles.map((rect) => rect.bottom)),
  };
  // 每个方向提供足够多的外侧平行通道。模块端口也横向/纵向错开，避免进入
  // 外侧通道前先叠在同一条短线上。
  const candidates = Array.from({ length: 16 }, (_, lane) => lane)
    .flatMap((lane) => {
      const offset = outerChannel + lane * laneSpacing;
      const sourceX = source.center.x + (portOffsets(source.right - source.left)[lane % 5] ?? 0);
      const targetX =
        target.center.x + (portOffsets(target.right - target.left)[(lane * 3) % 5] ?? 0);
      const sourceY = source.center.y + (portOffsets(source.bottom - source.top)[lane % 5] ?? 0);
      const targetY =
        target.center.y + (portOffsets(target.bottom - target.top)[(lane * 3) % 5] ?? 0);
      return [
        [
          source.center,
          { x: sourceX, y: source.top - obstaclePadding },
          { x: sourceX, y: bounds.top - offset },
          { x: targetX, y: bounds.top - offset },
          { x: targetX, y: target.top - obstaclePadding },
          target.center,
        ],
        [
          source.center,
          { x: sourceX, y: source.bottom + obstaclePadding },
          { x: sourceX, y: bounds.bottom + offset },
          { x: targetX, y: bounds.bottom + offset },
          { x: targetX, y: target.bottom + obstaclePadding },
          target.center,
        ],
        [
          source.center,
          { x: source.left - obstaclePadding, y: sourceY },
          { x: bounds.left - offset, y: sourceY },
          { x: bounds.left - offset, y: targetY },
          { x: target.left - obstaclePadding, y: targetY },
          target.center,
        ],
        [
          source.center,
          { x: source.right + obstaclePadding, y: sourceY },
          { x: bounds.right + offset, y: sourceY },
          { x: bounds.right + offset, y: targetY },
          { x: target.right + obstaclePadding, y: targetY },
          target.center,
        ],
      ];
    })
    .map(compressCollinear);
  const unrelated = obstacles.filter((rect) => rect.id !== source.id && rect.id !== target.id);
  const clear = candidates.filter((points) =>
    toSegments(points, 'fallback').every((segment) =>
      unrelated.every((rect) => !segmentHitsRect(segment.from, segment.to, rect)),
    ),
  );
  const viable = clear.length > 0 ? clear : candidates;
  return (
    [...viable].sort((leftPoints, rightPoints) => {
      const leftScore = routeScore(leftPoints, occupied);
      const rightScore = routeScore(rightPoints, occupied);
      return leftScore - rightScore || routeKey(leftPoints).localeCompare(routeKey(rightPoints));
    })[0] ?? [source.center, target.center]
  );
}

function routeScore(points: readonly Position[], occupied: readonly Segment[]): number {
  const segments = toSegments(points, 'candidate');
  const crossings = segments.reduce(
    (total, segment) =>
      total +
      occupied.filter((other) => properIntersection(segment.from, segment.to, other.from, other.to))
        .length,
    0,
  );
  const overlap = segments.reduce(
    (total, segment) =>
      total +
      occupied.reduce(
        (sum, other) =>
          sum + collinearOverlapLength(segment.from, segment.to, other.from, other.to),
        0,
      ),
    0,
  );
  return (
    crossings * crossingPenalty +
    overlap * overlapPenalty +
    segments.reduce((sum, segment) => sum + manhattan(segment.from, segment.to), 0)
  );
}

function routeKey(points: readonly Position[]): string {
  return points.map((point) => `${String(point.x)},${String(point.y)}`).join(';');
}

function ports(rect: Rect): Position[] {
  const verticalSlots = portOffsets(rect.bottom - rect.top);
  const horizontalSlots = portOffsets(rect.right - rect.left);
  return [
    ...verticalSlots.map((offset) => ({
      x: rect.left - obstaclePadding,
      y: rect.center.y + offset,
    })),
    ...verticalSlots.map((offset) => ({
      x: rect.right + obstaclePadding,
      y: rect.center.y + offset,
    })),
    ...horizontalSlots.map((offset) => ({
      x: rect.center.x + offset,
      y: rect.top - obstaclePadding,
    })),
    ...horizontalSlots.map((offset) => ({
      x: rect.center.x + offset,
      y: rect.bottom + obstaclePadding,
    })),
  ];
}

function portOffsets(size: number): readonly number[] {
  const extent = Math.max(0, size / 2 - 8);
  return [-1, -0.5, 0, 0.5, 1].map((ratio) => Math.round(ratio * extent * 1000) / 1000);
}

function stubIsClear(
  center: Position,
  port: Position,
  obstacles: readonly Rect[],
  ownId: Identifier,
): boolean {
  return obstacles.every((rect) => rect.id === ownId || !segmentHitsRect(center, port, rect));
}

function buildVisibilityGraph(
  points: readonly Position[],
  obstacles: readonly Rect[],
): ReadonlyMap<number, readonly number[]> {
  const result = new Map<number, number[]>();
  const rows = new Map<number, number[]>();
  const columns = new Map<number, number[]>();
  points.forEach((point, index) => {
    append(rows, point.y, index);
    append(columns, point.x, index);
  });
  for (const indexes of rows.values()) {
    connectAdjacent(indexes, points, obstacles, result, (index) => points[index]?.x ?? 0);
  }
  for (const indexes of columns.values()) {
    connectAdjacent(indexes, points, obstacles, result, (index) => points[index]?.y ?? 0);
  }
  return result;
}

function append(map: Map<number, number[]>, key: number, value: number): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

function connectAdjacent(
  indexes: readonly number[],
  points: readonly Position[],
  obstacles: readonly Rect[],
  result: Map<number, number[]>,
  coordinate: (index: number) => number,
): void {
  const ordered = [...indexes].sort((left, right) => coordinate(left) - coordinate(right));
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    if (left === undefined || right === undefined) continue;
    const from = points[left];
    const to = points[right];
    if (from === undefined || to === undefined) continue;
    if (obstacles.some((rect) => segmentHitsRect(from, to, rect))) continue;
    append(result, left, right);
    append(result, right, left);
  }
}

function shortestPath(
  points: readonly Position[],
  neighbours: ReadonlyMap<number, readonly number[]>,
  starts: readonly number[],
  goals: ReadonlySet<number>,
  occupied: readonly Segment[],
  sourceCenter: Position,
  targetCenter: Position,
): Position[] {
  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const states = new Map<string, SearchState>();
  const queue: { key: string; cost: number }[] = [];
  for (const point of starts) {
    const state: SearchState = { point, direction: 'start' };
    const key = stateKey(state);
    const cost = segmentCost(sourceCenter, points[point] ?? sourceCenter, occupied);
    if (!Number.isFinite(cost)) continue;
    distances.set(key, cost);
    states.set(key, state);
    queue.push({ key, cost: 0 });
  }
  let goalKey: string | undefined;
  let goalCost = Number.POSITIVE_INFINITY;
  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost || left.key.localeCompare(right.key));
    const currentItem = queue.shift();
    if (currentItem === undefined || currentItem.cost !== distances.get(currentItem.key)) continue;
    const current = states.get(currentItem.key);
    if (current === undefined) continue;
    if (currentItem.cost >= goalCost) break;
    if (goals.has(current.point)) {
      const candidate = goalCandidate(
        currentItem.key,
        currentItem.cost,
        points[current.point],
        targetCenter,
        occupied,
      );
      if (candidate !== undefined && candidate.cost < goalCost) {
        goalCost = candidate.cost;
        goalKey = candidate.key;
      }
      continue;
    }
    relaxNeighbours({
      current,
      currentKey: currentItem.key,
      currentCost: currentItem.cost,
      points,
      neighbours,
      occupied,
      distances,
      previous,
      states,
      queue,
    });
  }
  if (goalKey === undefined) return [];
  const indexes: number[] = [];
  for (let key: string | undefined = goalKey; key !== undefined; key = previous.get(key)) {
    const state = states.get(key);
    if (state !== undefined) indexes.push(state.point);
  }
  return indexes
    .reverse()
    .map((index) => points[index])
    .filter((point): point is Position => point !== undefined);
}

function goalCandidate(
  key: string,
  currentCost: number,
  port: Position | undefined,
  target: Position,
  occupied: readonly Segment[],
): { readonly key: string; readonly cost: number } | undefined {
  const finalCost = segmentCost(port ?? target, target, occupied);
  return Number.isFinite(finalCost) ? { key, cost: currentCost + finalCost } : undefined;
}

function relaxNeighbours(input: {
  readonly current: SearchState;
  readonly currentKey: string;
  readonly currentCost: number;
  readonly points: readonly Position[];
  readonly neighbours: ReadonlyMap<number, readonly number[]>;
  readonly occupied: readonly Segment[];
  readonly distances: Map<string, number>;
  readonly previous: Map<string, string>;
  readonly states: Map<string, SearchState>;
  readonly queue: { key: string; cost: number }[];
}): void {
  const from = input.points[input.current.point];
  if (from === undefined) return;
  for (const nextPoint of input.neighbours.get(input.current.point) ?? []) {
    const to = input.points[nextPoint];
    if (to === undefined) continue;
    const direction: Direction = Math.abs(from.x - to.x) < epsilon ? 'vertical' : 'horizontal';
    const turnCost =
      input.current.direction === 'start' || input.current.direction === direction
        ? 0
        : bendPenalty;
    const nextCost = input.currentCost + segmentCost(from, to, input.occupied) + turnCost;
    if (!Number.isFinite(nextCost)) continue;
    const next: SearchState = { point: nextPoint, direction };
    const nextKey = stateKey(next);
    if (nextCost + epsilon >= (input.distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
    input.distances.set(nextKey, nextCost);
    input.previous.set(nextKey, input.currentKey);
    input.states.set(nextKey, next);
    input.queue.push({ key: nextKey, cost: nextCost });
  }
}

function segmentCost(from: Position, to: Position, occupied: readonly Segment[]): number {
  const crossings = occupied.filter((segment) =>
    properIntersection(from, to, segment.from, segment.to),
  ).length;
  const overlap = occupied.reduce(
    (total, segment) => total + collinearOverlapLength(from, to, segment.from, segment.to),
    0,
  );
  // 线段共线会让两条关系在人眼中合并为一条。可读模块图把它视为不可用通道，
  // 只有外侧兜底路由在确实无路时才允许用高额成本比较候选。
  if (overlap > 0.5) return Number.POSITIVE_INFINITY;
  return manhattan(from, to) + crossings * crossingPenalty + overlap * overlapPenalty;
}

function segmentHitsRect(from: Position, to: Position, rect: Rect): boolean {
  const left = rect.left - obstaclePadding + epsilon;
  const right = rect.right + obstaclePadding - epsilon;
  const top = rect.top - obstaclePadding + epsilon;
  const bottom = rect.bottom + obstaclePadding - epsilon;
  if (Math.abs(from.x - to.x) < epsilon) {
    return from.x > left && from.x < right && rangesOverlap(from.y, to.y, top, bottom);
  }
  if (Math.abs(from.y - to.y) < epsilon) {
    return from.y > top && from.y < bottom && rangesOverlap(from.x, to.x, left, right);
  }
  return false;
}

function insideExpanded(point: Position, rect: Rect): boolean {
  return (
    point.x > rect.left - obstaclePadding + epsilon &&
    point.x < rect.right + obstaclePadding - epsilon &&
    point.y > rect.top - obstaclePadding + epsilon &&
    point.y < rect.bottom + obstaclePadding - epsilon
  );
}

function rangesOverlap(a: number, b: number, low: number, high: number): boolean {
  return Math.max(Math.min(a, b), low) < Math.min(Math.max(a, b), high);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort(
    (left, right) => left - right,
  );
}

function pointKey(point: Position): string {
  return `${String(point.x)}:${String(point.y)}`;
}

function stateKey(state: SearchState): string {
  return `${String(state.point)}:${state.direction}`;
}
