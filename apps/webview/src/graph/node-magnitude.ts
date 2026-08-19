import type { Identifier } from '@god-view/protocol';
import type { VisibleGraph } from '../model/view-model.js';

export type NodeMagnitude = 'small' | 'medium' | 'large';

/**
 * 把节点规模映射成三档离散尺寸。
 *
 * 用当前这张图内部的分位数而不是绝对行数：不同项目量级差几个数量级，绝对阈值
 * 要么让所有节点都是「大」，要么全是「小」。分档而不是连续缩放，是为了不越出
 * 布局引擎的固定占位导致节点互相压住。
 */
export function magnitudeScale(
  graph: VisibleGraph,
  magnitudes: Readonly<Record<Identifier, number>> | undefined,
): (id: Identifier) => NodeMagnitude {
  if (magnitudes === undefined) return () => 'medium';
  const values = graph.nodes
    .map(({ node }) => magnitudes[node.id] ?? 0)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (values.length === 0) return () => 'medium';
  const at = (ratio: number): number =>
    values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 0;
  const low = at(0.34);
  const high = at(0.75);
  return (id) => {
    const value = magnitudes[id] ?? 0;
    return value > high ? 'large' : value > low ? 'medium' : 'small';
  };
}
