/**
 * `@god-view/storage` 的唯一公开入口。
 *
 * 回答一个问题：图状态如何持久化、恢复和隔离损坏数据。
 */
export type {
  Clock,
  EventLogPort,
  LogRecord,
  QuarantinedRecord,
  ReadLogResult,
  SnapshotPort,
  StoredSnapshot,
} from './ports.js';

export { resolveBranchStorage, toDirectorySegment } from './paths.js';
export type { BranchStorageLayout } from './paths.js';

export { appendLine, appendLineDurable, readTextFile, writeFileAtomic } from './atomic-file.js';

export { FileEventLog } from './file-event-log.js';
export { FileSnapshotStore } from './file-snapshot-store.js';
export { MemoryEventLog, MemorySnapshotStore } from './memory-stores.js';

export { GraphRepository } from './repository.js';
export type { GraphRepositoryOptions, RestoreReport, RetentionReport } from './repository.js';
