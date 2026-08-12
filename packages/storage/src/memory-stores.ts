import { hashSnapshot } from '@god-view/graph-core';
import {
  createProtocolValidator,
  type GodViewEvent,
  type ProtocolValidator,
} from '@god-view/protocol';
import type {
  EventLogPort,
  LogRecord,
  QuarantinedRecord,
  ReadLogResult,
  SnapshotPort,
  StoredSnapshot,
} from './ports.js';

/** 内存事件日志：测试使用，避免真实文件系统带来的不稳定与清理成本。 */
export class MemoryEventLog implements EventLogPort {
  readonly #lines: string[] = [];
  readonly #validator: ProtocolValidator;

  constructor(validator: ProtocolValidator = createProtocolValidator()) {
    this.#validator = validator;
  }

  /** 直接注入原始行，用于构造半写、损坏或非法事件场景。 */
  injectRawLine(line: string): void {
    this.#lines.push(line);
  }

  read(afterSeq: number): Promise<ReadLogResult> {
    const records: LogRecord[] = [];
    const quarantined: QuarantinedRecord[] = [];
    for (const [index, line] of this.#lines.entries()) {
      const seq = index + 1;
      if (seq <= afterSeq) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        quarantined.push({ seq, reason: 'JSON 解析失败' });
        continue;
      }
      const validated = this.#validator.validateEvent(parsed);
      if (validated.ok) {
        records.push({ seq, event: validated.value });
      } else {
        quarantined.push({ seq, reason: validated.error[0]?.message ?? '不符合协议 Schema' });
      }
    }
    return Promise.resolve({ records, quarantined });
  }

  append(event: GodViewEvent): Promise<void> {
    this.#lines.push(JSON.stringify(event));
    return Promise.resolve();
  }

  compact(records: readonly LogRecord[], lastSeq: number): Promise<void> {
    const retained = new Map(records.map((record) => [record.seq, record.event]));
    this.#lines.length = 0;
    this.#lines.push(
      ...Array.from({ length: lastSeq }, (_, index) => {
        const event = retained.get(index + 1);
        return event === undefined ? '' : JSON.stringify(event);
      }),
    );
    return Promise.resolve();
  }

  count(): Promise<number> {
    return Promise.resolve(this.#lines.length);
  }
}

/** 内存快照存储：测试使用。 */
export class MemorySnapshotStore implements SnapshotPort {
  #stored: StoredSnapshot | undefined;
  /** 记录保存次数，用于验证快照触发策略。 */
  saveCount = 0;

  load(): Promise<StoredSnapshot | undefined> {
    return Promise.resolve(this.#stored);
  }

  save(document: StoredSnapshot['document']): Promise<void> {
    this.saveCount += 1;
    this.#stored = { document, contentHash: hashSnapshot(document) };
    return Promise.resolve();
  }

  /** 模拟快照文件损坏。 */
  corrupt(): void {
    this.#stored = undefined;
  }
}
