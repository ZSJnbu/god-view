import type { Position } from 'cytoscape';

export interface NodeRectangle {
  readonly id: string;
  readonly position: Position;
  readonly width: number;
  readonly height: number;
}

const defaultGap = 20;

export function countNodeOverlaps(nodes: readonly NodeRectangle[], gap = defaultGap): number {
  let count = 0;
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const one = nodes[left];
      const two = nodes[right];
      if (one !== undefined && two !== undefined && overlaps(one, two, gap)) count += 1;
    }
  }
  return count;
}

/** 按真实渲染尺寸稳定向下避让，用于布局完成和增量节点进入画布后兜底。 */
export function resolveRenderedOverlaps(
  nodes: readonly NodeRectangle[],
  gap = defaultGap,
): Readonly<Record<string, Position>> {
  const ordered = [...nodes].sort(
    (left, right) =>
      left.position.y - right.position.y ||
      left.position.x - right.position.x ||
      left.id.localeCompare(right.id),
  );
  const placed: NodeRectangle[] = [];
  const result: Record<string, Position> = {};
  for (const original of ordered) {
    let candidate = original;
    let guard = 0;
    while (guard < ordered.length * 2) {
      const collision = placed.find((other) => overlaps(candidate, other, gap));
      if (collision === undefined) break;
      candidate = {
        ...candidate,
        position: {
          x: candidate.position.x,
          y: collision.position.y + (collision.height + candidate.height) / 2 + gap,
        },
      };
      guard += 1;
    }
    result[candidate.id] = candidate.position;
    placed.push(candidate);
  }
  return result;
}

/** 拖放只移动用户正在拖的节点；若落在别的模块上，就吸附到最近的合法边缘。 */
export function resolveDraggedOverlap(
  moved: NodeRectangle,
  others: readonly NodeRectangle[],
  gap = defaultGap,
): Position {
  let candidate = moved;
  let guard = 0;
  while (guard < others.length * 2) {
    const collision = others.find((other) => overlaps(candidate, other, gap));
    if (collision === undefined) break;
    const horizontal = (collision.width + candidate.width) / 2 + gap;
    const vertical = (collision.height + candidate.height) / 2 + gap;
    const choices: Position[] = [
      { x: collision.position.x - horizontal, y: candidate.position.y },
      { x: collision.position.x + horizontal, y: candidate.position.y },
      { x: candidate.position.x, y: collision.position.y - vertical },
      { x: candidate.position.x, y: collision.position.y + vertical },
    ];
    const nearest = choices.sort(
      (left, right) =>
        distanceSquared(left, moved.position) - distanceSquared(right, moved.position),
    )[0];
    if (nearest === undefined) break;
    candidate = { ...candidate, position: nearest };
    guard += 1;
  }
  return candidate.position;
}

function overlaps(left: NodeRectangle, right: NodeRectangle, gap: number): boolean {
  return (
    Math.abs(left.position.x - right.position.x) < (left.width + right.width) / 2 + gap &&
    Math.abs(left.position.y - right.position.y) < (left.height + right.height) / 2 + gap
  );
}

function distanceSquared(left: Position, right: Position): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}
