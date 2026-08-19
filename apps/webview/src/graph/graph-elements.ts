import type { ElementDefinition } from 'cytoscape';
import type { Identifier } from '@god-view/protocol';
import type { LayoutPositions } from '../model/store.js';
import type { VisibleGraph } from '../model/view-model.js';
import { badgesFor, isFailed, isInProgress, nodeTypeLabels } from '../model/presentation.js';
import { edgeTypeLabels } from '../model/edge-presentation.js';
import { magnitudeScale } from './node-magnitude.js';

/**
 * 可见图 → Cytoscape 元素。
 *
 * 只做映射：颜色、可信度徽章与规模分档都从既有派生数据读出，不在这里产生新的业务判断
 * （TECHNICAL_ARCHITECTURE.md §10.1）。
 */

export function toElements(
  graph: VisibleGraph,
  positions: LayoutPositions,
  magnitudes: Readonly<Record<Identifier, number>> | undefined,
): ElementDefinition[] {
  const colors = assignModuleColors(graph);
  const scale = magnitudeScale(graph, magnitudes);
  const nodes: ElementDefinition[] = graph.nodes.map(({ node, rolledUpCount }) => {
    const badges = badgesFor(node);
    const position = positions[node.id];
    const color = colors.get(node.id) ?? defaultModuleColor;
    return {
      group: 'nodes',
      data: {
        id: node.id,
        label: rolledUpCount > 0 ? `${node.label}  (+${String(rolledUpCount)})` : node.label,
        kind: nodeTypeLabels[node.type],
        trust: badges.trust,
        state: isFailed(node) ? 'failed' : isInProgress(node) ? 'pending' : 'settled',
        fillColor: color.fill,
        edgeColor: color.edge,
        textColor: color.text,
        magnitude: scale(node.id),
      },
      ...(position === undefined ? {} : { position: { x: position.x, y: position.y } }),
    };
  });

  const edges: ElementDefinition[] = graph.edges.map((edge) => {
    return {
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        color: (colors.get(edge.from) ?? defaultModuleColor).edge,
        relationTitle: `${edgeTypeLabels[edge.type]}${edge.count > 1 ? ` ×${String(edge.count)}` : ''}`,
        description: shorten(edge.description, 180),
      },
    };
  });

  return [...nodes, ...edges];
}

function shorten(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

interface ModuleColor {
  readonly fill: string;
  readonly edge: string;
  readonly text: string;
}

const modulePalette: readonly ModuleColor[] = [
  { fill: '#1d4ed8', edge: '#60a5fa', text: '#ffffff' },
  { fill: '#047857', edge: '#34d399', text: '#ffffff' },
  { fill: '#6d28d9', edge: '#a78bfa', text: '#ffffff' },
  { fill: '#9a3412', edge: '#fb923c', text: '#ffffff' },
  { fill: '#be123c', edge: '#fb7185', text: '#ffffff' },
  { fill: '#0e7490', edge: '#22d3ee', text: '#ffffff' },
  { fill: '#3f6212', edge: '#a3e635', text: '#ffffff' },
  { fill: '#7e22ce', edge: '#d8b4fe', text: '#ffffff' },
  { fill: '#334155', edge: '#94a3b8', text: '#ffffff' },
  { fill: '#a16207', edge: '#facc15', text: '#ffffff' },
  { fill: '#0f766e', edge: '#5eead4', text: '#ffffff' },
  { fill: '#4338ca', edge: '#818cf8', text: '#ffffff' },
];
const defaultModuleColor: ModuleColor = modulePalette[0] ?? {
  fill: '#1d4ed8',
  edge: '#60a5fa',
  text: '#ffffff',
};

function assignModuleColors(graph: VisibleGraph): ReadonlyMap<Identifier, ModuleColor> {
  const result = new Map<Identifier, ModuleColor>();
  const used = new Set<number>();
  for (const { node } of [...graph.nodes].sort((left, right) =>
    left.node.id.localeCompare(right.node.id),
  )) {
    const preferred = stableHash(node.id) % modulePalette.length;
    let slot = preferred;
    while (used.has(slot) && used.size < modulePalette.length) {
      slot = (slot + 1) % modulePalette.length;
    }
    used.add(slot);
    result.set(node.id, modulePalette[slot] ?? defaultModuleColor);
  }
  return result;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
