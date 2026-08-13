import type { Position } from 'cytoscape';

const epsilon = 0.001;

export function collinearOverlapLength(a: Position, b: Position, c: Position, d: Position): number {
  if (isHorizontal(a, b) && isHorizontal(c, d) && Math.abs(a.y - c.y) < epsilon) {
    return intervalOverlapLength(a.x, b.x, c.x, d.x);
  }
  if (isVertical(a, b) && isVertical(c, d) && Math.abs(a.x - c.x) < epsilon) {
    return intervalOverlapLength(a.y, b.y, c.y, d.y);
  }
  return 0;
}

export function intervalOverlapLength(a: number, b: number, c: number, d: number): number {
  return Math.max(
    0,
    Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d)),
  );
}

export function isHorizontal(from: Position, to: Position): boolean {
  return Math.abs(from.y - to.y) < epsilon;
}

export function isVertical(from: Position, to: Position): boolean {
  return Math.abs(from.x - to.x) < epsilon;
}
