import { RelativePattern, Uri, workspace, type Disposable, type FileSystemWatcher } from 'vscode';
import type { GodViewEvent, ProtocolValidator } from '@god-view/protocol';
import type { Logger } from '../logger.js';

export interface InboxDelivery {
  readonly event: GodViewEvent;
  readonly fileName: string;
}

/**
 * 事件收件箱监听。
 *
 * Gateway 以「临时文件 → fsync → 原子 rename」写入，因此这里读到的文件
 * 总是完整的。处理完成后删除文件，实现「至少一次投递 + 幂等归约」
 * （TECHNICAL_ARCHITECTURE.md §7.2）。
 */
export class InboxWatcher implements Disposable {
  readonly #inboxDir: Uri;
  readonly #validator: ProtocolValidator;
  readonly #logger: Logger;
  readonly #onEvent: (delivery: InboxDelivery) => Promise<void>;
  #watcher: FileSystemWatcher | undefined;
  #poller: ReturnType<typeof setInterval> | undefined;
  /** 处理串行化：单写者模型不允许并发归约同一张地图。 */
  #queue: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly inboxDir: Uri;
    readonly validator: ProtocolValidator;
    readonly logger: Logger;
    readonly onEvent: (delivery: InboxDelivery) => Promise<void>;
  }) {
    this.#inboxDir = options.inboxDir;
    this.#validator = options.validator;
    this.#logger = options.logger;
    this.#onEvent = options.onEvent;
  }

  async start(): Promise<void> {
    await workspace.fs.createDirectory(this.#inboxDir);
    const pattern = new RelativePattern(this.#inboxDir, '*.json');
    const watcher = workspace.createFileSystemWatcher(pattern, false, false, true);
    watcher.onDidCreate((uri) => {
      this.#enqueue(uri);
    });
    watcher.onDidChange((uri) => {
      this.#enqueue(uri);
    });
    this.#watcher = watcher;
    await this.drain();
    // 某些旧版 Extension Host/文件系统后端会漏掉创建事件。周期扫描是可靠性兜底：
    // eventId 幂等与串行队列保证 watcher 和扫描同时命中不会重复归约。
    this.#poller = setInterval(() => {
      void this.drain();
    }, 1000);
  }

  /** 处理启动前已经堆积的事件文件。 */
  async drain(): Promise<void> {
    let entries: [string, unknown][];
    try {
      entries = await workspace.fs.readDirectory(this.#inboxDir);
    } catch {
      return;
    }
    const names = entries
      .map(([name]) => name)
      .filter((name) => name.endsWith('.json'))
      .sort();
    for (const name of names) {
      this.#enqueue(Uri.joinPath(this.#inboxDir, name));
    }
    await this.#queue;
  }

  #enqueue(uri: Uri): void {
    this.#queue = this.#queue
      .then(() => this.#process(uri))
      .catch((error: unknown) => {
        this.#logger.error('inbox.process.failed', { message: String(error) });
      });
  }

  async #process(uri: Uri): Promise<void> {
    let raw: Uint8Array;
    try {
      raw = await workspace.fs.readFile(uri);
    } catch {
      // 文件已被消费或被外部删除，属于正常竞态。
      return;
    }
    const fileName = uri.path.split('/').pop() ?? uri.path;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      this.#logger.warn('inbox.rejected', {
        fileName,
        reason: 'JSON 解析失败',
        bytes: raw.byteLength,
      });
      await this.#discard(uri);
      return;
    }
    const validated = this.#validator.validateEvent(parsed);
    if (!validated.ok) {
      // 只记录错误码与文件名：损坏内容可能包含未脱敏 payload。
      this.#logger.warn('inbox.rejected', {
        fileName,
        code: validated.error[0]?.code,
        message: validated.error[0]?.message,
      });
      await this.#discard(uri);
      return;
    }
    await this.#onEvent({ event: validated.value, fileName });
    await this.#discard(uri);
  }

  async #discard(uri: Uri): Promise<void> {
    try {
      await workspace.fs.delete(uri, { useTrash: false });
    } catch {
      // 删除失败不影响已归约的状态：重复投递会被 eventId 幂等拦截。
    }
  }

  dispose(): void {
    if (this.#poller !== undefined) clearInterval(this.#poller);
    this.#poller = undefined;
    this.#watcher?.dispose();
    this.#watcher = undefined;
  }
}
