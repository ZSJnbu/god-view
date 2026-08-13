import { describe, expect, it } from 'vitest';
import {
  countNodeOverlaps,
  resolveDraggedOverlap,
  resolveRenderedOverlaps,
  type NodeRectangle,
} from './node-overlap.js';

function box(id: string, x: number, y: number, width = 180, height = 62): NodeRectangle {
  return { id, position: { x, y }, width, height };
}

describe('node overlap', () => {
  it('按真实矩形尺寸消解增量节点重叠', () => {
    const nodes = [box('module', 100, 100), box('file', 130, 105), box('api', 150, 110)];
    expect(countNodeOverlaps(nodes)).toBe(3);
    const positions = resolveRenderedOverlaps(nodes);
    const resolved = nodes.map((node) => ({
      ...node,
      position: positions[node.id] ?? node.position,
    }));
    expect(countNodeOverlaps(resolved)).toBe(0);
  });

  it('拖到另一个模块上会把被拖节点吸附到最近合法边缘', () => {
    const fixed = box('fixed', 0, 0);
    const moved = box('moved', 10, 5);
    const position = resolveDraggedOverlap(moved, [fixed]);
    expect(countNodeOverlaps([{ ...moved, position }, fixed])).toBe(0);
    expect(position).not.toEqual(moved.position);
  });
});
