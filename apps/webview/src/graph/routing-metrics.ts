import type { Identifier } from '@god-view/protocol';
import type { Position } from 'cytoscape';
import type { RoutedEdge, RoutingEdge, RoutingMetrics, RoutingNode } from './edge-routing.js';
import { collinearOverlapLength } from './segment-geometry.js';

interface Rect {
  readonly id: Identifier;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
interface Segment {
  readonly from: Position;
  readonly to: Position;
}

/** 返回人类可读性指标；同一交叉只计一次，端点模块不算穿越。 */
export function measureRouting(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
  routes: ReadonlyMap<Identifier, RoutedEdge>,
): RoutingMetrics {
  const rectangles = nodes.map(toRect);
  const edgeById = new Map(edges.map((edge) => [edge.id, edge] as const));
  const entries = [...routes.entries()].sort(([left], [right]) => left.localeCompare(right));
  let crossings = 0;
  let nodeIntersections = 0;
  let overlappingPairs = 0;
  let overlapLength = 0;
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const leftId = entries[leftIndex]?.[0];
    const leftRoute = entries[leftIndex]?.[1];
    if (leftId === undefined || leftRoute === undefined) continue;
    const leftSegments = visibleSegments(leftRoute.basePoints);
    nodeIntersections += countNodeIntersections(leftSegments, edgeById.get(leftId), rectangles);
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const rightRoute = entries[rightIndex]?.[1];
      if (
        rightRoute !== undefined &&
        routesCross(leftSegments, visibleSegments(rightRoute.basePoints))
      ) {
        crossings += 1;
      }
      if (rightRoute !== undefined) {
        const overlap = routesOverlap(leftSegments, visibleSegments(rightRoute.basePoints));
        if (overlap > 0.5) overlappingPairs += 1;
        overlapLength += overlap;
      }
    }
  }
  return { crossings, nodeIntersections, overlappingPairs, overlapLength };
}

function countNodeIntersections(
  segments: readonly Segment[],
  edge: RoutingEdge | undefined,
  rectangles: readonly Rect[],
): number {
  if (edge === undefined) return 0;
  const obstacles = rectangles.filter((rect) => rect.id !== edge.from && rect.id !== edge.to);
  return segments.reduce(
    (total, segment) =>
      total + obstacles.filter((rect) => segmentHitsRect(segment.from, segment.to, rect)).length,
    0,
  );
}

function routesCross(left: readonly Segment[], right: readonly Segment[]): boolean {
  return left.some((a) => right.some((b) => properIntersection(a.from, a.to, b.from, b.to)));
}

function routesOverlap(left: readonly Segment[], right: readonly Segment[]): number {
  return left.reduce(
    (total, a) => total + right.reduce((sum, b) => sum + collinearOverlap(a, b), 0),
    0,
  );
}

function collinearOverlap(a: Segment, b: Segment): number {
  return collinearOverlapLength(a.from, a.to, b.from, b.to);
}

function toSegments(points: readonly Position[]): Segment[] {
  return points.slice(1).flatMap((to, index) => {
    const from = points[index];
    return from === undefined ? [] : [{ from, to }];
  });
}

/** 第一个与最后一个 segment 位于模块中心到端口之间，由模块盖住，不属于可见线路。 */
function visibleSegments(points: readonly Position[]): Segment[] {
  const segments = toSegments(points);
  return segments.length <= 2 ? segments : segments.slice(1, -1);
}

function toRect(node: RoutingNode): Rect {
  return {
    id: node.id,
    left: node.position.x - node.width / 2,
    right: node.position.x + node.width / 2,
    top: node.position.y - node.height / 2,
    bottom: node.position.y + node.height / 2,
  };
}

function segmentHitsRect(from: Position, to: Position, rect: Rect): boolean {
  if (Math.abs(from.x - to.x) < 0.001) {
    return (
      from.x > rect.left && from.x < rect.right && overlap(from.y, to.y, rect.top, rect.bottom)
    );
  }
  if (Math.abs(from.y - to.y) < 0.001) {
    return (
      from.y > rect.top && from.y < rect.bottom && overlap(from.x, to.x, rect.left, rect.right)
    );
  }
  return false;
}

function overlap(a: number, b: number, low: number, high: number): boolean {
  return Math.max(Math.min(a, b), low) < Math.min(Math.max(a, b), high);
}

function properIntersection(a: Position, b: Position, c: Position, d: Position): boolean {
  const firstHorizontal = Math.abs(a.y - b.y) < 0.001;
  const secondHorizontal = Math.abs(c.y - d.y) < 0.001;
  if (firstHorizontal === secondHorizontal) return false;
  const horizontalA = firstHorizontal ? a : c;
  const horizontalB = firstHorizontal ? b : d;
  const verticalA = firstHorizontal ? c : a;
  const verticalB = firstHorizontal ? d : b;
  return (
    verticalA.x > Math.min(horizontalA.x, horizontalB.x) + 0.001 &&
    verticalA.x < Math.max(horizontalA.x, horizontalB.x) - 0.001 &&
    horizontalA.y > Math.min(verticalA.y, verticalB.y) + 0.001 &&
    horizontalA.y < Math.max(verticalA.y, verticalB.y) - 0.001
  );
}
