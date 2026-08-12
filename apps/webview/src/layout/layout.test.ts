import { describe, expect, it } from 'vitest';
import { computeLayout, type LayoutNodeInput, type LayoutRequest } from './layout.js';

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

  it('核心列按依赖深度再分层', () => {
    const { positions } = computeLayout(
      request({
        nodes: [node('entry', { column: 'entry' }), node('first'), node('second')],
        edges: [
          { from: 'entry', to: 'first' },
          { from: 'first', to: 'second' },
        ],
      }),
    );

    expect(positions['first']?.x).toBeLessThan(positions['second']?.x ?? 0);
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
});
