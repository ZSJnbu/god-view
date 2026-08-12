import {
  createEmptySnapshot,
  fromSnapshotDocument,
  reduce,
  toSnapshotDocument,
  type DomainError,
  type GraphSnapshot,
  type RejectedEvent,
} from '@god-view/graph-core';
import { err, ok, type GodViewEvent, type Identifier, type Result } from '@god-view/protocol';
import type { Clock, EventLogPort, QuarantinedRecord, SnapshotPort } from './ports.js';

export interface GraphRepositoryOptions {
  readonly workspaceId: Identifier;
  readonly branchKey: Identifier;
  readonly eventLog: EventLogPort;
  readonly snapshotStore: SnapshotPort;
  readonly now: Clock;
  readonly baseGitRevision?: string;
  /** 距上次快照的事件数达到该阈值后写入新快照。 */
  readonly snapshotIntervalEvents?: number;
}

export interface RestoreReport {
  /** 从快照恢复还是从空地图完整回放。 */
  readonly restoredFrom: 'snapshot' | 'empty';
  readonly replayedEvents: number;
  readonly rejected: readonly RejectedEvent[];
  readonly quarantined: readonly QuarantinedRecord[];
}

export interface RetentionReport {
  readonly prunedEvents: number;
  readonly retainedEvents: number;
  readonly redactedAnnotations: number;
}

const defaultSnapshotInterval = 200;

/**
 * 单写者图状态仓库。
 *
 * 所有写入串行化：同一 workspace 的图状态使用单写者模型，避免并发追加
 * 同一个日志文件（CODING_STANDARDS.md §8）。
 */
export class GraphRepository {
  readonly #eventLog: EventLogPort;
  readonly #snapshotStore: SnapshotPort;
  readonly #snapshotInterval: number;
  #snapshot: GraphSnapshot;
  #lastPersistedSeq: number;
  #eventsSinceSnapshot = 0;
  #writeChain: Promise<unknown> = Promise.resolve();

  private constructor(
    options: GraphRepositoryOptions,
    snapshot: GraphSnapshot,
    lastPersistedSeq: number,
  ) {
    this.#eventLog = options.eventLog;
    this.#snapshotStore = options.snapshotStore;
    this.#snapshotInterval = options.snapshotIntervalEvents ?? defaultSnapshotInterval;
    this.#snapshot = snapshot;
    this.#lastPersistedSeq = lastPersistedSeq;
  }

  /**
   * 打开仓库：优先从最近的有效快照恢复，再回放其后的事件。
   *
   * 快照损坏或不属于当前 workspace/branch 时退化为完整回放，而不是拒绝启动。
   */
  static async open(
    options: GraphRepositoryOptions,
  ): Promise<{ repository: GraphRepository; report: RestoreReport }> {
    const stored = await options.snapshotStore.load();
    const usable =
      stored?.document.workspaceId === options.workspaceId &&
      stored.document.branchKey === options.branchKey;

    const initial = usable
      ? fromSnapshotDocument(stored.document)
      : createEmptySnapshot({
          workspaceId: options.workspaceId,
          branchKey: options.branchKey,
          createdAt: options.now(),
          ...(options.baseGitRevision === undefined
            ? {}
            : { baseGitRevision: options.baseGitRevision }),
        });

    const afterSeq = usable ? stored.document.lastEventSeq : 0;
    const { records, quarantined } = await options.eventLog.read(afterSeq);

    let snapshot = initial;
    const rejected: RejectedEvent[] = [];
    let lastSeq = afterSeq;
    for (const record of records) {
      const result = reduce(snapshot, record.event);
      if (result.ok) {
        snapshot = result.value;
      } else {
        rejected.push({ event: record.event, error: result.error });
      }
      lastSeq = record.seq;
    }

    const repository = new GraphRepository(options, snapshot, lastSeq);
    repository.#eventsSinceSnapshot = records.length;
    return {
      repository,
      report: {
        restoredFrom: usable ? 'snapshot' : 'empty',
        replayedEvents: records.length,
        rejected,
        quarantined,
      },
    };
  }

  get snapshot(): GraphSnapshot {
    return this.#snapshot;
  }

  /**
   * 归约并持久化一个事件。
   *
   * 先归约再落盘：被领域规则拒绝的事件不进入规范日志，否则每次启动回放都会
   * 重新产生同一条错误。
   */
  append(event: GodViewEvent): Promise<Result<GraphSnapshot, DomainError>> {
    const queued = this.#writeChain.then(() => this.#appendSerialized(event));
    // 写链只用于串行化，不允许单次失败破坏后续写入。
    this.#writeChain = queued.catch(() => undefined);
    return queued;
  }

  async #appendSerialized(event: GodViewEvent): Promise<Result<GraphSnapshot, DomainError>> {
    const result = reduce(this.#snapshot, event);
    if (!result.ok) {
      return err(result.error);
    }
    // 幂等事件不重复写入日志。
    if (result.value !== this.#snapshot) {
      await this.#eventLog.append(event);
      this.#snapshot = result.value;
      this.#lastPersistedSeq += 1;
      this.#eventsSinceSnapshot += 1;
      if (this.#eventsSinceSnapshot >= this.#snapshotInterval) {
        await this.#writeSnapshot();
      }
    }
    return ok(this.#snapshot);
  }

  /** 主动写入快照，例如扩展停用前刷写状态。 */
  async flush(): Promise<void> {
    await this.#writeChain;
    if (this.#eventsSinceSnapshot > 0) {
      await this.#writeSnapshot();
    }
  }

  /**
   * 把当前状态固化为不含过期对话正文的基线，并只保留 cutoff 之后的原始事件。
   *
   * 快照先写、日志后换：中途失败时旧日志仍可用，下次可以安全重试。过期行变为空行，
   * 仍保留原 seq 水位；这样压缩前后的快照都不会与后续追加产生序号错位。
   */
  compact(cutoff: string): Promise<RetentionReport> {
    const queued = this.#writeChain.then(() => this.#compactSerialized(cutoff));
    this.#writeChain = queued.catch(() => undefined);
    return queued;
  }

  async #compactSerialized(cutoff: string): Promise<RetentionReport> {
    const cutoffTime = Date.parse(cutoff);
    if (!Number.isFinite(cutoffTime)) throw new Error('retention cutoff 必须是有效时间');
    const { records } = await this.#eventLog.read(0);
    const retained = records.filter((record) => Date.parse(record.event.timestamp) >= cutoffTime);
    const redacted = redactExpiredAnnotationMessages(this.#snapshot, cutoffTime);
    await this.#snapshotStore.save(
      toSnapshotDocument({ ...redacted.snapshot, lastEventSeq: this.#lastPersistedSeq }),
    );
    await this.#eventLog.compact(retained, this.#lastPersistedSeq);
    this.#snapshot = { ...redacted.snapshot, lastEventSeq: this.#lastPersistedSeq };
    this.#eventsSinceSnapshot = 0;
    return {
      prunedEvents: records.length - retained.length,
      retainedEvents: retained.length,
      redactedAnnotations: redacted.redactedAnnotations,
    };
  }

  async #writeSnapshot(): Promise<void> {
    const document = toSnapshotDocument({
      ...this.#snapshot,
      lastEventSeq: this.#lastPersistedSeq,
    });
    await this.#snapshotStore.save(document);
    this.#eventsSinceSnapshot = 0;
  }
}

function redactExpiredAnnotationMessages(
  snapshot: GraphSnapshot,
  cutoffTime: number,
): { snapshot: GraphSnapshot; redactedAnnotations: number } {
  const annotations = new Map(snapshot.annotations);
  let redactedAnnotations = 0;
  for (const [id, annotation] of annotations) {
    if (
      annotation.status !== 'resolved' ||
      annotation.pinned === true ||
      annotation.resolvedAt === undefined ||
      Date.parse(annotation.resolvedAt) >= cutoffTime
    )
      continue;
    const first = annotation.messages[0];
    if (first === undefined) continue;
    annotations.set(id, {
      ...annotation,
      messages: [
        {
          id: first.id,
          author: 'system',
          body: '对话正文已按本地保留策略清理',
          createdAt: annotation.resolvedAt,
        },
      ],
    });
    redactedAnnotations += 1;
  }
  return {
    snapshot: redactedAnnotations === 0 ? snapshot : { ...snapshot, annotations },
    redactedAnnotations,
  };
}
