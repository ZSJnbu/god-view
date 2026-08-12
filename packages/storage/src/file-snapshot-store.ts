import { hashSnapshot } from '@god-view/graph-core';
import { createProtocolValidator, type ProtocolValidator } from '@god-view/protocol';
import { readTextFile, writeFileAtomic } from './atomic-file.js';
import type { SnapshotPort, StoredSnapshot } from './ports.js';

interface SnapshotEnvelope {
  readonly contentHash: string;
  readonly document: unknown;
}

/**
 * 快照存储。
 *
 * 快照写入使用临时文件 + fsync + 原子 rename；读取时重新计算内容哈希，
 * 不匹配即视为损坏并返回 undefined，由调用方从事件日志完整回放。
 */
export class FileSnapshotStore implements SnapshotPort {
  readonly #filePath: string;
  readonly #validator: ProtocolValidator;

  constructor(filePath: string, validator: ProtocolValidator = createProtocolValidator()) {
    this.#filePath = filePath;
    this.#validator = validator;
  }

  async load(): Promise<StoredSnapshot | undefined> {
    const contents = await readTextFile(this.#filePath);
    if (contents === undefined) {
      return undefined;
    }
    let envelope: SnapshotEnvelope;
    try {
      envelope = JSON.parse(contents) as SnapshotEnvelope;
    } catch {
      return undefined;
    }
    const validated = this.#validator.validateSnapshot(envelope.document);
    if (!validated.ok) {
      return undefined;
    }
    const actualHash = hashSnapshot(validated.value);
    if (actualHash !== envelope.contentHash) {
      return undefined;
    }
    return { document: validated.value, contentHash: actualHash };
  }

  async save(document: StoredSnapshot['document']): Promise<void> {
    const envelope: SnapshotEnvelope = { contentHash: hashSnapshot(document), document };
    await writeFileAtomic(this.#filePath, JSON.stringify(envelope));
  }
}
