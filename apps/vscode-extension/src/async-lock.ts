/**
 * 保留调用方返回值与异常的轻量异步互斥锁。
 *
 * 与 MapService 的 OperationQueue 不同，这里的调用方需要观察初始化失败；锁只负责
 * 保证失败后仍会释放，不能吞掉异常。扩展激活与 WebviewPanelSerializer 可能同时请求
 * 会话，必须让第二个请求等第一个完成后复用同一实例。
 */
export class AsyncLock {
  #tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release = (): void => {
      // Promise 构造器会同步替换这个占位函数。
    };
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
