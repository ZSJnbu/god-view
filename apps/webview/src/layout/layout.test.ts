import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  computeTopologicalLayout,
  resolveNodeOverlaps,
  type LayoutNodeInput,
  type LayoutRequest,
} from './layout.js';

function node(id: string, extra: Partial<LayoutNodeInput> = {}): LayoutNodeInput {
  return { id, label: id, column: 'core', weight: 2, ...extra };
}

function request(overrides: Partial<LayoutRequest> = {}): LayoutRequest {
  return { nodes: [], edges: [], pinned: {}, ...overrides };
}

describe('computeLayout', () => {
  it('相同输入产生相同结果', () => {
    const input = request({
      nodes: [node('a', { column: 'entry' }), node('b'), node('c', { column: 'storage' })],
      edges: [{ from: 'a', to: 'b' }],
    });

    expect(computeLayout(input)).toEqual(computeLayout(input));
  });

  it('按语义泳道分列：入口在左，外部系统在右', () => {
    const { positions } = computeLayout(
      request({
        nodes: [
          node('entry', { column: 'entry' }),
          node('core'),
          node('store', { column: 'storage' }),
          node('ext', { column: 'external' }),
        ],
      }),
    );

    const x = (id: string): number => positions[id]?.x ?? Number.NaN;
    expect(x('entry')).toBeLessThan(x('core'));
    expect(x('core')).toBeLessThan(x('store'));
    expect(x('store')).toBeLessThan(x('ext'));
  });

  it('核心列按依赖深度纵向排序，但不侵占存储泳道', () => {
    const { positions } = computeLayout(
      request({
        nodes: [node('entry', { column: 'entry' }), node('first'), node('second')],
        edges: [
          { from: 'entry', to: 'first' },
          { from: 'first', to: 'second' },
        ],
      }),
    );

    expect(positions['first']?.x).toBe(positions['second']?.x);
    expect(positions['first']?.y).toBeLessThan(positions['second']?.y ?? 0);

    const withStorage = computeLayout(
      request({
        nodes: [
          node('entry', { column: 'entry' }),
          node('first'),
          node('store', { column: 'storage' }),
        ],
        edges: [{ from: 'entry', to: 'first' }],
      }),
    );
    expect(withStorage.positions['first']).not.toEqual(withStorage.positions['store']);
  });

  it('存在环时不死循环', () => {
    const { positions } = computeLayout(
      request({
        nodes: [node('a', { column: 'entry' }), node('b'), node('c')],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'b' },
        ],
      }),
    );

    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c']);
  });

  it('重要节点排在同列上方', () => {
    const { positions } = computeLayout(
      request({
        nodes: [node('minor', { weight: 1 }), node('major', { weight: 3 })],
      }),
    );

    expect(positions['major']?.y).toBeLessThan(positions['minor']?.y ?? 0);
  });

  it('同权重按 label 排序，不受输入顺序影响', () => {
    const forward = computeLayout(request({ nodes: [node('a'), node('b')] }));
    const reversed = computeLayout(request({ nodes: [node('b'), node('a')] }));

    expect(forward).toEqual(reversed);
  });

  it('用户拖拽过的节点保持原坐标', () => {
    const { positions } = computeLayout(
      request({
        nodes: [node('pinned'), node('auto')],
        pinned: { pinned: { x: 999, y: -42 } },
      }),
    );

    expect(positions['pinned']).toEqual({ x: 999, y: -42 });
    expect(positions['auto']).not.toEqual({ x: 999, y: -42 });
  });

  it('没有入口节点时也能布局', () => {
    const { positions } = computeLayout(
      request({ nodes: [node('a'), node('b')], edges: [{ from: 'a', to: 'b' }] }),
    );

    expect(Object.keys(positions).sort()).toEqual(['a', 'b']);
  });

  it('空输入返回空布局', () => {
    expect(computeLayout(request()).positions).toEqual({});
  });

  it('真实 9 模块与部分持久坐标不会发生可视矩形碰撞', () => {
    const nodes = [
      node('application-operations'),
      node('background-runtime'),
      node('data-persistence', { column: 'storage' }),
      node('delivery-assurance'),
      node('domain-rules'),
      node('external-integrations', { column: 'external' }),
      node('platform-foundations'),
      node('product-surfaces', { column: 'entry' }),
      node('runtime-entry', { column: 'entry' }),
    ];
    const pinned = {
      'delivery-assurance': { x: 230.49, y: 150.98 },
      'platform-foundations': { x: 290.9, y: -353.31 },
      'application-operations': { x: 614.08, y: -196.53 },
      'background-runtime': { x: 565.69, y: 169.37 },
      'external-integrations': { x: 940.63, y: -45.2 },
      'product-surfaces': { x: 311.57, y: -143.95 },
    };
    const { positions } = computeLayout(
      request({
        nodes,
        edges: [
          { from: 'runtime-entry', to: 'product-surfaces' },
          { from: 'product-surfaces', to: 'application-operations' },
          { from: 'application-operations', to: 'domain-rules' },
          { from: 'application-operations', to: 'data-persistence' },
          { from: 'runtime-entry', to: 'background-runtime' },
          { from: 'background-runtime', to: 'external-integrations' },
        ],
        pinned,
      }),
    );
    expect(Object.keys(positions)).toHaveLength(9);
    expect(countOverlaps(positions)).toBe(0);
  });

  it('增量文件节点撞上已有 pinned 模块时会保持间距并确定性避让', () => {
    const nodes = [node('module'), node('file-a'), node('file-b')];
    const positions = {
      module: { x: 100, y: 100 },
      'file-a': { x: 110, y: 110 },
      'file-b': { x: 120, y: 120 },
    };

    const resolved = resolveNodeOverlaps(nodes, positions);
    expect(resolved).toEqual(resolveNodeOverlaps(nodes, positions));
    expect(countOverlaps(resolved)).toBe(0);
  });
});

function countOverlaps(
  positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
): number {
  const values = Object.values(positions);
  let overlaps = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const one = values[left];
      const two = values[right];
      if (
        one !== undefined &&
        two !== undefined &&
        Math.abs(one.x - two.x) < 224 &&
        Math.abs(one.y - two.y) < 96
      )
        overlaps += 1;
    }
  }
  return overlaps;
}

describe('computeTopologicalLayout', () => {
  it('按依赖从左到右分层，并用重心排序消除可避免的交叉', () => {
    const input = request({
      nodes: [node('a', { column: 'entry' }), node('b', { column: 'entry' }), node('c'), node('d')],
      // 初始 label 顺序会把 a→d 与 b→c 排成交叉；重心 sweep 应交换目标层。
      edges: [
        { from: 'a', to: 'd' },
        { from: 'b', to: 'c' },
      ],
      pinned: {
        a: { x: 999, y: 999 },
        b: { x: -999, y: -999 },
      },
    });
    const { positions } = computeTopologicalLayout(input);

    expect(positions['a']?.x).toBeLessThan(positions['c']?.x ?? 0);
    expect(Math.sign((positions['a']?.y ?? 0) - (positions['b']?.y ?? 0))).toBe(
      Math.sign((positions['d']?.y ?? 0) - (positions['c']?.y ?? 0)),
    );
    expect(positions['a']).not.toEqual({ x: 999, y: 999 });
  });

  it('相同输入确定性输出，且环会被压缩后完整布局', () => {
    const input = request({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'b', to: 'c' },
      ],
    });

    expect(computeTopologicalLayout(input)).toEqual(computeTopologicalLayout(input));
    expect(Object.keys(computeTopologicalLayout(input).positions).sort()).toEqual(['a', 'b', 'c']);
    expect(computeLayout({ ...input, mode: 'topological' })).toEqual(
      computeTopologicalLayout(input),
    );
  });
});
