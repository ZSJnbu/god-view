import type { Identifier } from '@god-view/protocol';
import type { Position } from 'cytoscape';
import { isHorizontal, isVertical } from './segment-geometry.js';

export interface RouteSegment {
  readonly from: Position;
  readonly to: Position;
  readonly edgeId: Identifier;
}

const epsilon = 0.001;
const bridgeHalfWidth = 9;
const bridgeHeight = 8;

export function addBridges(
  points: readonly Position[],
  occupied: readonly RouteSegment[],
): { readonly points: readonly Position[]; readonly bridges: number } {
  const first = points[0];
  if (points.length < 2 || first === undefined) return { points, bridges: 0 };
  const result: Position[] = [first];
  let bridges = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    const intersections = occupied
      .map((segment) => intersectionPoint(from, to, segment.from, segment.to))
      .filter((point): point is Position => point !== undefined)
      .filter((point) => distance(from, point) > 18 && distance(point, to) > 18)
      .sort((left, right) => distance(from, left) - distance(from, right));
    for (const crossing of intersections) {
      appendBridge(result, from, to, crossing);
      bridges += 1;
    }
    result.push(to);
  }
  return { points: compressCollinear(result), bridges };
}

function appendBridge(result: Position[], from: Position, to: Position, point: Position): void {
  const horizontal = isHorizontal(from, to);
  const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);
  if (horizontal) {
    result.push(
      { x: point.x - direction * bridgeHalfWidth, y: point.y },
      { x: point.x - (direction * bridgeHalfWidth) / 2, y: point.y - bridgeHeight },
      { x: point.x + (direction * bridgeHalfWidth) / 2, y: point.y - bridgeHeight },
      { x: point.x + direction * bridgeHalfWidth, y: point.y },
    );
  } else {
    result.push(
      { x: point.x, y: point.y - direction * bridgeHalfWidth },
      { x: point.x + bridgeHeight, y: point.y - (direction * bridgeHalfWidth) / 2 },
      { x: point.x + bridgeHeight, y: point.y + (direction * bridgeHalfWidth) / 2 },
      { x: point.x, y: point.y + direction * bridgeHalfWidth },
    );
  }
}

export function toSegments(points: readonly Position[], edgeId: Identifier): RouteSegment[] {
  return points.slice(1).flatMap((to, index) => {
    const from = points[index];
    return from === undefined ? [] : [{ from, to, edgeId }];
  });
}

export function properIntersection(a: Position, b: Position, c: Position, d: Position): boolean {
  return intersectionPoint(a, b, c, d) !== undefined;
}

function intersectionPoint(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): Position | undefined {
  const firstHorizontal = isHorizontal(a, b);
  const secondHorizontal = isHorizontal(c, d);
  if ((!firstHorizontal || !isVertical(c, d)) && (!secondHorizontal || !isVertical(a, b)))
    return undefined;
  const horizontalA = firstHorizontal ? a : c;
  const horizontalB = firstHorizontal ? b : d;
  const verticalA = firstHorizontal ? c : a;
  const verticalB = firstHorizontal ? d : b;
  const point = { x: verticalA.x, y: horizontalA.y };
  return point.x > Math.min(horizontalA.x, horizontalB.x) + epsilon &&
    point.x < Math.max(horizontalA.x, horizontalB.x) - epsilon &&
    point.y > Math.min(verticalA.y, verticalB.y) + epsilon &&
    point.y < Math.max(verticalA.y, verticalB.y) - epsilon
    ? point
    : undefined;
}

export function compressCollinear(points: readonly Position[]): Position[] {
  const result: Position[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous !== undefined && distance(previous, point) < epsilon) continue;
    const before = result.at(-2);
    if (
      before !== undefined &&
      previous !== undefined &&
      ((isVertical(before, previous) && isVertical(previous, point)) ||
        (isHorizontal(before, previous) && isHorizontal(previous, point)))
    )
      result[result.length - 1] = point;
    else result.push(point);
  }
  return result;
}

export function distance(left: Position, right: Position): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}
