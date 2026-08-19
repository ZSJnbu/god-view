/**
 * `@god-view/graph-core` 的唯一公开入口。
 *
 * 本包回答一个问题：事件如何改变图状态。它是纯函数包，不依赖 vscode、DOM、
 * Git、文件系统或具体存储实现（TECHNICAL_ARCHITECTURE.md §4.1）。
 */
export { domainError } from './domain-error.js';
export type { DomainError } from './domain-error.js';

export {
  canonicalize,
  createEmptySnapshot,
  fromSnapshotDocument,
  hashSnapshot,
  toSnapshotDocument,
} from './snapshot.js';
export type { CreateSnapshotOptions, GraphSnapshot } from './snapshot.js';

export { reduce } from './reduce.js';

export { replay } from './replay.js';
export type { RejectedEvent, ReplayResult } from './replay.js';

export { buildHistoryTimeline } from './history.js';
export type {
  BuildHistoryTimelineOptions,
  HistoryCommit,
  HistoryCommitFile,
  HistoryFrame,
  HistoryTimeline,
} from './history.js';

export { computeCoverage } from './coverage.js';
export type {
  CoverageResult,
  ExcludedEntry,
  InventoryEntry,
  InventoryKind,
  RepositoryInventory,
} from './coverage.js';

export {
  findNodesByPath,
  getNeighborhood,
  listChildren,
  listEdges,
  listNodes,
  listRootNodes,
  searchNodes,
} from './queries.js';
export type { Neighborhood, VisibilityOptions } from './queries.js';
