import { computeLayout, type LayoutRequest, type LayoutResult } from './layout.js';

/** Worker 的最小接口。抽出来是为了能在测试里注入假实现，不依赖浏览器环境。 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate(): void;
}

interface LayoutResponse {
  readonly id: number;
  readonly positions: LayoutResult['positions'];
}

/**
 * 布局计算客户端。
 *
 * 布局放在 Worker 里跑，避免大图重排阻塞 Webview 主线程（§9.2/§10.2）。
 * Worker 创建失败时同步降级，功能不消失，只是可能掉帧。
 */
export class LayoutClient {
  readonly #worker: WorkerLike | undefined;
  readonly #pending = new Map<number, (result: LayoutResult) => void>();
  #nextId = 1;

  constructor(spawn: () => WorkerLike) {
    this.#worker = createWorker(spawn);
    this.#worker?.addEventListener('message', (event) => {
      this.#resolve(event.data);
    });
  }

  async compute(request: LayoutRequest): Promise<LayoutResult> {
    const worker = this.#worker;
    if (worker === undefined) {
      return computeLayout(request);
    }
    const id = this.#nextId++;
    return new Promise<LayoutResult>((resolve) => {
      this.#pending.set(id, resolve);
      worker.postMessage({ id, request });
    });
  }

  async computeTopological(request: LayoutRequest): Promise<LayoutResult> {
    return this.compute({ ...request, pinned: {}, mode: 'topological' });
  }

  dispose(): void {
    this.#pending.clear();
    this.#worker?.terminate();
  }

  #resolve(data: unknown): void {
    if (!isLayoutResponse(data)) {
      return;
    }
    const resolve = this.#pending.get(data.id);
    if (resolve === undefined) {
      return;
    }
    this.#pending.delete(data.id);
    resolve({ positions: data.positions });
  }
}

function createWorker(spawn: () => WorkerLike): WorkerLike | undefined {
  try {
    return spawn();
  } catch {
    return undefined;
  }
}

function isLayoutResponse(data: unknown): data is LayoutResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as { id?: unknown; positions?: unknown };
  return typeof candidate.id === 'number' && typeof candidate.positions === 'object';
}
