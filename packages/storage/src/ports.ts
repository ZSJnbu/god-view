import type { GodViewEvent, GraphSnapshotDocument } from '@god-view/protocol';

/** 日志中的一条记录。seq 由存储层分配，反映规范日志中的顺序。 */
export interface LogRecord {
  readonly seq: number;
  readonly event: GodViewEvent;
}

/** 无法解析或不符合协议的日志行。它们被隔离，但不阻断其余事件。 */
export interface QuarantinedRecord {
  readonly seq: number;
  readonly reason: string;
}

export interface ReadLogResult {
  readonly records: readonly LogRecord[];
  readonly quarantined: readonly QuarantinedRecord[];
}

/**
 * 规范事件日志端口。
 *
 * 只追加，单写者：禁止多个进程并发追加同一个 JSONL 文件
 * （TECHNICAL_ARCHITECTURE.md §7.2）。
 */
export interface EventLogPort {
  /** 读取 seq 大于 afterSeq 的记录。损坏行进入 quarantined，不抛异常。 */
  read(afterSeq: number): Promise<ReadLogResult>;
  append(event: GodViewEvent): Promise<void>;
  /** 原子压缩规范日志；保留原 seq 水位，防止快照与后续追加在崩溃恢复时错位。 */
  compact(records: readonly LogRecord[], lastSeq: number): Promise<void>;
  /** 已写入的记录数，用于快照触发判断。 */
  count(): Promise<number>;
}

export interface StoredSnapshot {
  readonly document: GraphSnapshotDocument;
  readonly contentHash: string;
}

export interface SnapshotPort {
  /** 快照损坏或哈希不匹配时返回 undefined，由调用方从事件日志完整回放。 */
  load(): Promise<StoredSnapshot | undefined>;
  save(document: GraphSnapshotDocument): Promise<void>;
}

/** 时间来源必须显式注入，reducer 与存储都不得内联读取系统时钟。 */
export type Clock = () => string;
