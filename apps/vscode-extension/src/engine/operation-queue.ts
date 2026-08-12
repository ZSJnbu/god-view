export interface OperationQueueOptions {
  /** 单次操作失败的回调。队列本身不重试，也不中断。 */
  readonly onError: (operation: string, error: unknown) => void;
}

/**
 * 串行操作队列。
 *
 * 地图服务里的分支切换、事件归约与事实刷新必须互斥：并发时刷新可能捕获切换前的
 * Repository，等切换完成后再把旧分支的快照写回读模型。
 *
 * 关键性质是**失败不会毒化队列**。用 `tail = tail.then(task)` 实现的链，只要某次
 * 任务抛错，`tail` 就变成 rejected；此后所有 `.then(...)` 的成功回调都被跳过，队列
 * 静默停摆，而调用方（文件监听、Git 监听）通常用 `void` 丢弃了返回值，连报错都看不到。
 * 因此这里的内部 Promise 只会 resolve，异常在 run 内部捕获后交给 onError。
 */
export class OperationQueue {
  readonly #onError: OperationQueueOptions['onError'];
  /** 只 resolve、永不 reject。 */
  #tail: Promise<void> = Promise.resolve();

  constructor(options: OperationQueueOptions) {
    this.#onError = options.onError;
  }

  /**
   * 排队执行。返回的 Promise 在**本次**任务结束后兑现，且不会 reject。
   *
   * 失败被吞掉是有意的：调用方多半是没有错误处理上下文的事件监听器，把异常抛给
   * 它们只会变成未处理的 rejection。需要知道结果的调用方应通过 onError 观察。
   */
  async run(operation: string, task: () => Promise<void>): Promise<void> {
    const previous = this.#tail;
    let release = (): void => {
      // 占位实现：真正的 resolve 在下面的 Promise 构造器里同步赋进来。
    };
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await task();
    } catch (error) {
      this.#onError(operation, error);
    } finally {
      release();
    }
  }

  /** 等待当前排队的所有操作结束，用于停用前刷写。 */
  async drain(): Promise<void> {
    await this.#tail;
  }
}
