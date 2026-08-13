import { describe, expect, it } from 'vitest';
import { routeEdges, type RoutingNode } from './edge-routing.js';
import { measureRouting } from './routing-metrics.js';

function node(id: string, x: number, y: number, width = 120, height = 56): RoutingNode {
  return { id, position: { x, y }, width, height };
}

describe('routeEdges', () => {
  it('正交路径绕过位于起点与终点之间的模块', () => {
    const nodes = [node('source', 0, 0), node('blocker', 200, 0), node('target', 400, 0)];
    const route = routeEdges(nodes, [{ id: 'edge', from: 'source', to: 'target' }]).get('edge');

    expect(route).toBeDefined();
    expect(route?.points.some((point) => Math.abs(point.y) >= 44)).toBe(true);
    expect(route?.points).not.toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
  });

  it('相同拓扑总是产生相同路径', () => {
    const nodes = [node('a', 0, 0), node('b', 240, -90), node('c', 240, 90), node('d', 480, 0)];
    const edges = [
      { id: 'a-d', from: 'a', to: 'd' },
      { id: 'b-c', from: 'b', to: 'c' },
    ];

    expect(routeEdges(nodes, edges)).toEqual(routeEdges(nodes, edges));
  });

  it('无法避免的正交交叉在后画线路上生成跳线控制点', () => {
    const nodes = [
      node('left', 0, 0),
      node('right', 400, 0),
      node('top', 200, -200),
      node('bottom', 200, 200),
    ];
    const routes = routeEdges(nodes, [
      { id: 'horizontal', from: 'left', to: 'right' },
      { id: 'vertical', from: 'top', to: 'bottom' },
    ]);

    expect(
      (routes.get('horizontal')?.bridges ?? 0) + (routes.get('vertical')?.bridges ?? 0),
    ).toBeGreaterThanOrEqual(1);
  });

  it('所有线路段都不进入无关模块内部', () => {
    const nodes = [
      node('a', 0, 0),
      node('block-1', 160, 0),
      node('block-2', 320, 80),
      node('d', 480, 0),
    ];
    const route = routeEdges(nodes, [{ id: 'a-d', from: 'a', to: 'd' }]).get('a-d');
    expect(route).toBeDefined();
    const blockers = nodes.filter(({ id }) => id.startsWith('block'));
    for (let index = 1; index < (route?.points.length ?? 0); index += 1) {
      const from = route?.points[index - 1];
      const to = route?.points[index];
      if (from === undefined || to === undefined) continue;
      for (const blocker of blockers) {
        expect(axisAlignedSegmentHitsNode(from, to, blocker)).toBe(false);
      }
    }
  });

  it('同一起点的多条关系立即扇出，不会覆盖成一根线', () => {
    const nodes = [
      node('source', 0, 0),
      node('top', 360, -140),
      node('middle', 360, 0),
      node('bottom', 360, 140),
    ];
    const edges = [
      { id: 'to-top', from: 'source', to: 'top' },
      { id: 'to-middle', from: 'source', to: 'middle' },
      { id: 'to-bottom', from: 'source', to: 'bottom' },
    ];
    const routes = routeEdges(nodes, edges);
    const metrics = measureRouting(nodes, edges, routes);

    expect(metrics.overlappingPairs).toBe(0);
    expect(metrics.overlapLength).toBe(0);
    expect(
      new Set([...routes.values()].map((route) => JSON.stringify(route.basePoints[1]))).size,
    ).toBe(3);
  });
});

function axisAlignedSegmentHitsNode(
  from: { x: number; y: number },
  to: { x: number; y: number },
  obstacle: RoutingNode,
): boolean {
  const left = obstacle.position.x - obstacle.width / 2;
  const right = obstacle.position.x + obstacle.width / 2;
  const top = obstacle.position.y - obstacle.height / 2;
  const bottom = obstacle.position.y + obstacle.height / 2;
  if (Math.abs(from.x - to.x) < 0.001) {
    return (
      from.x > left &&
      from.x < right &&
      Math.max(Math.min(from.y, to.y), top) < Math.min(Math.max(from.y, to.y), bottom)
    );
  }
  if (Math.abs(from.y - to.y) < 0.001) {
    return (
      from.y > top &&
      from.y < bottom &&
      Math.max(Math.min(from.x, to.x), left) < Math.min(Math.max(from.x, to.x), right)
    );
  }
  return false;
}
