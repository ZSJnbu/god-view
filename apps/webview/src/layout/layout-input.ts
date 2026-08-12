import type { GraphNode, NodeType } from '@god-view/protocol';
import type { VisibleGraph } from '../model/view-model.js';
import type { LayoutColumn, LayoutNodeInput, LayoutRequest } from './layout.js';
import type { LayoutPositions } from '../model/store.js';

const columnForType: Record<NodeType, LayoutColumn> = {
  entry: 'entry',
  module: 'core',
  group: 'core',
  service: 'core',
  file: 'core',
  unclassified: 'core',
  storage: 'storage',
  external_system: 'external',
};

const weightForImportance: Record<'primary' | 'secondary' | 'detail', number> = {
  primary: 3,
  secondary: 2,
  detail: 1,
};

/**
 * 把可见图翻译成布局输入。
 *
 * `visualHint` 是 Agent 的建议：这里只把它当作提示读取，节点类型仍然优先，
 * 因为类型经过 Schema 校验，而 hint 可以是任意字符串。
 */
export function toLayoutRequest(graph: VisibleGraph, pinned: LayoutPositions): LayoutRequest {
  return {
    nodes: graph.nodes.map(({ node }) => toLayoutNode(node)),
    edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    pinned: filterPinned(pinned, graph),
  };
}

function toLayoutNode(node: GraphNode): LayoutNodeInput {
  const hinted = node.visualHint?.preferredPosition;
  const column =
    hinted === undefined || hinted === 'auto' ? columnForType[node.type] : hintColumn(hinted);
  return {
    id: node.id,
    label: node.label,
    column,
    weight: weightForImportance[node.visualHint?.importance ?? 'secondary'],
  };
}

function hintColumn(hint: 'entry' | 'core' | 'storage' | 'external'): LayoutColumn {
  return hint;
}

/** 只保留当前可见节点的固定坐标，避免把历史布局带进新的层级。 */
function filterPinned(pinned: LayoutPositions, graph: VisibleGraph): LayoutRequest['pinned'] {
  const visible = new Set(graph.nodes.map(({ node }) => node.id));
  const result: Record<string, { x: number; y: number }> = {};
  for (const [id, position] of Object.entries(pinned)) {
    if (visible.has(id)) {
      result[id] = position;
    }
  }
  return result;
}
