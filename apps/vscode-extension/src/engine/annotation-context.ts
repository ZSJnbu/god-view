import type {
  AnnotationTarget,
  CodeLocation,
  GraphEdge,
  GraphNode,
  Identifier,
  WorkspacePath,
} from '@god-view/protocol';
import type { GraphSnapshot } from '@god-view/graph-core';

export interface AnnotationContext {
  readonly target: AnnotationTarget;
  readonly neighborNodeIds: readonly Identifier[];
  readonly relatedEdgeIds: readonly Identifier[];
}

function uniqueSorted<T extends string>(items: readonly T[]): T[] {
  return [...new Set(items)].sort();
}

function locationsFor(nodes: readonly GraphNode[], excluded: ReadonlySet<string>): CodeLocation[] {
  const explicit = nodes.flatMap((node) => node.locations ?? []);
  const explicitPaths = new Set(explicit.map((location) => location.path));
  const pathOnly: CodeLocation[] = nodes
    .flatMap((node) => node.paths ?? [])
    .filter((path) => !explicitPaths.has(path))
    .map((path) => ({ path }));
  const seen = new Set<string>();
  return [...explicit, ...pathOnly]
    .filter((location) => !excluded.has(location.path))
    .filter((location) => {
      const key = `${location.path}:${String(location.startLine ?? '')}:${String(location.endLine ?? '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * 从权威快照构建最小解释上下文：目标、其一跳邻居、相关边和用户未排除的位置。
 * 不读取源码内容，避免在用户尚未选择 Agent 前把代码隐式带出工作区。
 */
export function buildAnnotationContext(
  snapshot: GraphSnapshot,
  nodeIds: readonly Identifier[],
  excludedPaths: readonly WorkspacePath[] = [],
): AnnotationContext | undefined {
  const ids = uniqueSorted(nodeIds);
  const nodes = ids.map((id) => snapshot.nodes.get(id));
  if (nodes.some((node) => node === undefined)) return undefined;

  const selected = new Set(ids);
  const relatedEdges: GraphEdge[] = [];
  const neighbors: Identifier[] = [];
  for (const edge of snapshot.edges.values()) {
    if (edge.lifecycle.status === 'removed') continue;
    if (selected.has(edge.from) || selected.has(edge.to)) {
      relatedEdges.push(edge);
      if (!selected.has(edge.from)) neighbors.push(edge.from);
      if (!selected.has(edge.to)) neighbors.push(edge.to);
    }
  }
  const target: AnnotationTarget = {
    nodeIds: ids,
    ...(relatedEdges.length === 0
      ? {}
      : { edgeIds: uniqueSorted(relatedEdges.map((edge) => edge.id)) }),
    ...(locationsFor(nodes as GraphNode[], new Set(excludedPaths)).length === 0
      ? {}
      : { codeLocations: locationsFor(nodes as GraphNode[], new Set(excludedPaths)) }),
    mapRevision: snapshot.revision,
    ...(snapshot.baseGitRevision === undefined
      ? {}
      : { baseGitRevision: snapshot.baseGitRevision }),
  };
  return {
    target,
    neighborNodeIds: uniqueSorted(neighbors),
    relatedEdgeIds: uniqueSorted(relatedEdges.map((edge) => edge.id)),
  };
}

export function formatAnnotationTask(
  annotationId: Identifier,
  snapshot: GraphSnapshot,
): string | undefined {
  const thread = snapshot.annotations.get(annotationId);
  if (thread === undefined) return undefined;
  const question = thread.messages.find((message) => message.author === 'user')?.body ?? '';
  const context = buildAnnotationContext(snapshot, thread.target.nodeIds ?? []);
  const nodes = [...(thread.target.nodeIds ?? []), ...(context?.neighborNodeIds ?? [])];
  const nodeText = uniqueSorted(nodes).join(', ');
  const edgeText = context?.relatedEdgeIds.join(', ');
  const locationText = (thread.target.codeLocations ?? []).map((item) => item.path).join(', ');
  return [
    `请解释 God View 标注 ${annotationId}。`,
    `用户问题：${question}`,
    `地图版本：${String(thread.target.mapRevision)}`,
    `目标/一跳节点：${nodeText === '' ? '无' : nodeText}`,
    `相关关系：${edgeText === undefined || edgeText === '' ? '无' : edgeText}`,
    `允许参考的位置：${locationText === '' ? '无' : locationText}`,
    '请先调用 get_map 获取当前地图，然后调用 answer_annotation 回写摘要、详情和结构化证据。',
    '这是只读解释请求，不包含代码写入授权，也不要创建 ChangeSet。',
  ].join('\n');
}
