import type { GraphSnapshot } from '@god-view/graph-core';
import type { MapPatch } from '@god-view/webview-bridge';
import type { Identifier } from '@god-view/protocol';

/**
 * 计算两个快照之间的增量。
 *
 * 发送给 Webview 的是增量 patch 而不是完整大图：每个事件都复制整张图会让
 * 大型仓库的渲染成本与内存翻倍（TECHNICAL_ARCHITECTURE.md §9.2）。
 *
 * reducer 对未改动实体保持同一对象引用，因此这里用引用比较即可，
 * 不需要深比较。
 */
export function diffSnapshots(previous: GraphSnapshot, next: GraphSnapshot): MapPatch {
  const upsertedNodes = changedValues(previous.nodes, next.nodes);
  const removedNodeIds = removedKeys(previous.nodes, next.nodes);
  const upsertedEdges = changedValues(previous.edges, next.edges);
  const removedEdgeIds = removedKeys(previous.edges, next.edges);
  const upsertedStories = changedValues(previous.stories, next.stories);
  const upsertedAnnotations = changedValues(previous.annotations, next.annotations);
  const upsertedWriteAccessRequests = changedValues(
    previous.writeAccessRequests,
    next.writeAccessRequests,
  );
  const upsertedChangeProposals = changedValues(previous.changeProposals, next.changeProposals);
  const upsertedActiveChanges = changedValues(previous.activeChanges, next.activeChanges);
  const removedActiveChangeIds = removedKeys(previous.activeChanges, next.activeChanges);
  const upsertedCompletedChanges = changedValues(previous.completedChanges, next.completedChanges);

  return {
    upsertedNodes,
    upsertedEdges,
    removedNodeIds,
    removedEdgeIds,
    upsertedStories,
    upsertedAnnotations,
    upsertedWriteAccessRequests,
    upsertedChangeProposals,
    upsertedActiveChanges,
    removedActiveChangeIds,
    upsertedCompletedChanges,
  };
}

export function isEmptyPatch(patch: MapPatch): boolean {
  const collections: readonly (readonly unknown[] | undefined)[] = [
    patch.upsertedNodes,
    patch.upsertedEdges,
    patch.removedNodeIds,
    patch.removedEdgeIds,
    patch.upsertedStories,
    patch.upsertedAnnotations,
    patch.upsertedWriteAccessRequests,
    patch.upsertedChangeProposals,
    patch.upsertedActiveChanges,
    patch.removedActiveChangeIds,
    patch.upsertedCompletedChanges,
  ];
  return collections.every((items) => items === undefined || items.length === 0);
}

function changedValues<T>(
  previous: ReadonlyMap<Identifier, T>,
  next: ReadonlyMap<Identifier, T>,
): T[] {
  return [...next].filter(([id, value]) => previous.get(id) !== value).map(([, value]) => value);
}

function removedKeys<T>(
  previous: ReadonlyMap<Identifier, T>,
  next: ReadonlyMap<Identifier, T>,
): Identifier[] {
  return [...previous.keys()].filter((id) => !next.has(id));
}
