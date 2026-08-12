import {
  createProtocolValidator,
  type GodViewEvent,
  type ProtocolValidator,
} from '@god-view/protocol';
import { appendLine, appendLineDurable, readTextFile, writeFileAtomic } from './atomic-file.js';
import type { EventLogPort, LogRecord, QuarantinedRecord, ReadLogResult } from './ports.js';

/**
 * 基于 JSONL 的规范事件日志。
 *
 * 每行一个事件，只追加。读取时逐行解析并校验：损坏或不合协议的行进入隔离文件，
 * 其余事件继续可用（PRD §11.2）。
 */
export class FileEventLog implements EventLogPort {
  readonly #logFile: string;
  readonly #quarantineFile: string;
  readonly #validator: ProtocolValidator;

  constructor(
    logFile: string,
    quarantineFile: string,
    validator: ProtocolValidator = createProtocolValidator(),
  ) {
    this.#logFile = logFile;
    this.#quarantineFile = quarantineFile;
    this.#validator = validator;
  }

  async read(afterSeq: number): Promise<ReadLogResult> {
    const contents = await readTextFile(this.#logFile);
    if (contents === undefined) {
      return { records: [], quarantined: [] };
    }
    const records: LogRecord[] = [];
    const quarantined: QuarantinedRecord[] = [];
    const lines = contents.split('\n');

    for (const [index, line] of lines.entries()) {
      const seq = index + 1;
      if (line.trim() === '' || seq <= afterSeq) {
        continue;
      }
      const parsed = this.#parseLine(line, seq);
      if ('reason' in parsed) {
        quarantined.push(parsed);
      } else {
        records.push(parsed);
      }
    }

    if (quarantined.length > 0) {
      await this.#recordQuarantine(quarantined);
    }
    return { records, quarantined };
  }

  async append(event: GodViewEvent): Promise<void> {
    await appendLineDurable(this.#logFile, JSON.stringify(event));
  }

  async compact(records: readonly LogRecord[], lastSeq: number): Promise<void> {
    const retained = new Map(records.map((record) => [record.seq, record.event]));
    const lines = Array.from({ length: lastSeq }, (_, index) => {
      const event = retained.get(index + 1);
      return event === undefined ? '' : JSON.stringify(event);
    });
    const contents = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    await writeFileAtomic(this.#logFile, contents);
  }

  async count(): Promise<number> {
    const contents = await readTextFile(this.#logFile);
    if (contents === undefined) {
      return 0;
    }
    return contents.split('\n').filter((line) => line.trim() !== '').length;
  }

  #parseLine(line: string, seq: number): LogRecord | QuarantinedRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { seq, reason: 'JSON 解析失败' };
    }
    const validated = this.#validator.validateEvent(parsed);
    if (!validated.ok) {
      return { seq, reason: validated.error[0]?.message ?? '不符合协议 Schema' };
    }
    return { seq, event: validated.value };
  }

  async #recordQuarantine(records: readonly QuarantinedRecord[]): Promise<void> {
    for (const record of records) {
      // 只记录序号与原因，不复制原始内容：损坏行可能包含未脱敏的 payload。
      await appendLine(this.#quarantineFile, JSON.stringify(record));
    }
  }
}
