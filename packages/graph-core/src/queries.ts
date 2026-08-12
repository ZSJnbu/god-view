import type { GraphEdge, GraphNode, Identifier } from '@god-view/protocol';
import type { GraphSnapshot } from './snapshot.js';

/** 默认排除墓碑实体：删除的节点仍保留以支持追溯，但不属于当前地图。 */
export interface VisibilityOptions {
  readonly includeRemoved?: boolean;
}

function isVisible(
  entity: { readonly lifecycle: { readonly status: string } },
  options: VisibilityOptions | undefined,
): boolean {
  return options?.includeRemoved === true || entity.lifecycle.status !== 'removed';
}

export function listNodes(
  snapshot: GraphSnapshot,
  options?: VisibilityOptions,
): readonly GraphNode[] {
  return [...snapshot.nodes.values()].filter((node) => isVisible(node, options));
}

export function listEdges(
  snapshot: GraphSnapshot,
  options?: VisibilityOptions,
): readonly GraphEdge[] {
  return [...snapshot.edges.values()].filter((edge) => isVisible(edge, options));
}

/** 按工作区相对路径定位节点，用于「Reveal in God View」。 */
export function findNodesByPath(
  snapshot: GraphSnapshot,
  path: string,
  options?: VisibilityOptions,
): readonly GraphNode[] {
  const target = path.replace(/^\.\//u, '').replace(/\\/gu, '/');
  return listNodes(snapshot, options).filter((node) =>
    (node.paths ?? []).some((declared) => {
      const normalized = declared.replace(/^\.\//u, '').replace(/\\/gu, '/');
      return target === normalized || target.startsWith(`${normalized.replace(/\/$/u, '')}/`);
    }),
  );
}

/** 名称/职责搜索。搜索必须能命中折叠分组内的实体，因此不做可见性以外的过滤。 */
export function searchNodes(
  snapshot: GraphSnapshot,
  query: string,
  options?: VisibilityOptions,
): readonly GraphNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  return listNodes(snapshot, options).filter((node) => {
    const haystack = [node.label, node.responsibility ?? '', ...(node.paths ?? [])]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export interface Neighborhood {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/**
 * 取节点的 N 层邻域，用于「聚焦此模块」。
 *
 * 聚焦只渲染目标的一到两层邻域（TECHNICAL_ARCHITECTURE.md §10.2），
 * 因此 depth 超过 2 没有产品意义，这里不做上限限制但调用方应遵循该约定。
 */
export function getNeighborhood(
  snapshot: GraphSnapshot,
  nodeId: Identifier,
  depth: number,
  options?: VisibilityOptions,
): Neighborhood {
  const root = snapshot.nodes.get(nodeId);
  if (root === undefined || !isVisible(root, options)) {
    return { nodes: [], edges: [] };
  }
  const visibleEdges = listEdges(snapshot, options);
  const included = new Set<Identifier>([nodeId]);
  const edges = new Map<Identifier, GraphEdge>();

  let frontier: readonly Identifier[] = [nodeId];
  for (let level = 0; level < Math.max(0, depth); level += 1) {
    const next: Identifier[] = [];
    for (const edge of visibleEdges) {
      const touchesFrontier = frontier.includes(edge.from) || frontier.includes(edge.to);
      if (!touchesFrontier) {
        continue;
      }
      edges.set(edge.id, edge);
      for (const endpoint of [edge.from, edge.to]) {
        if (!included.has(endpoint) && snapshot.nodes.has(endpoint)) {
          included.add(endpoint);
          next.push(endpoint);
        }
      }
    }
    if (next.length === 0) {
      break;
    }
    frontier = next;
  }

  const nodes = [...included]
    .map((id) => snapshot.nodes.get(id))
    .filter((node): node is GraphNode => node !== undefined && isVisible(node, options));
  return { nodes, edges: [...edges.values()] };
}

/** 直接下级节点，用于分层展开。 */
export function listChildren(
  snapshot: GraphSnapshot,
  parentId: Identifier,
  options?: VisibilityOptions,
): readonly GraphNode[] {
  return listNodes(snapshot, options).filter((node) => node.parentId === parentId);
}

/** 一级节点：没有父节点的可见实体，构成概览视图的默认视口内容。 */
export function listRootNodes(
  snapshot: GraphSnapshot,
  options?: VisibilityOptions,
): readonly GraphNode[] {
  return listNodes(snapshot, options).filter(
    (node) => node.parentId === undefined || !snapshot.nodes.has(node.parentId),
  );
}
