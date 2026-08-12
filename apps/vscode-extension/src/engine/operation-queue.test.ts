import { describe, expect, it, vi } from 'vitest';
import { OperationQueue } from './operation-queue.js';

/** 受控 Promise，用来精确编排并发时序。 */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve = (): void => {
    // 占位：Promise 构造器里同步赋值。
  };
  let reject = (_e: Error): void => {
    // 占位：Promise 构造器里同步赋值。
  };
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 让已排队的微任务跑完，再观察执行到哪一步。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('串行化', () => {
  it('后一个操作要等前一个结束才开始', async () => {
    const queue = new OperationQueue({ onError: vi.fn() });
    const first = deferred();
    const order: string[] = [];

    const a = queue.run('a', async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = queue.run('b', () => {
      order.push('b:start');
      return Promise.resolve();
    });

    // a 已经开始并卡在 first 上；b 必须还没动。
    await flushMicrotasks();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('按入队顺序执行', async () => {
    const queue = new OperationQueue({ onError: vi.fn() });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        queue.run(`op-${String(n)}`, async () => {
          await Promise.resolve();
          order.push(n);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe('失败不毒化队列', () => {
  it('一次拒绝之后，后续操作照常执行', async () => {
    const onError = vi.fn();
    const queue = new OperationQueue({ onError });
    const ran: string[] = [];

    await queue.run('boom', () => Promise.reject(new Error('炸了')));
    await queue.run('after', async () => {
      await Promise.resolve();
      ran.push('after');
    });

    // 这条断言就是缺陷本身：用 tail.then(task) 实现时，'after' 永远不会执行。
    expect(ran).toEqual(['after']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('连续失败也不会让队列停摆', async () => {
    const onError = vi.fn();
    const queue = new OperationQueue({ onError });
    let survived = false;

    await queue.run('boom-1', () => Promise.reject(new Error('一')));
    await queue.run('boom-2', () => Promise.reject(new Error('二')));
    await queue.run('ok', () => {
      survived = true;
      return Promise.resolve();
    });

    expect(survived).toBe(true);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('run 本身不 reject，调用方 void 掉也不会产生未处理拒绝', async () => {
    const queue = new OperationQueue({ onError: vi.fn() });

    await expect(
      queue.run('boom', () => Promise.reject(new Error('炸了'))),
    ).resolves.toBeUndefined();
  });

  it('把操作名和原始错误交给 onError', async () => {
    const onError = vi.fn();
    const queue = new OperationQueue({ onError });
    const failure = new Error('磁盘满了');

    await queue.run('facts.refresh', () => Promise.reject(failure));

    expect(onError).toHaveBeenCalledWith('facts.refresh', failure);
  });

  it('同步抛出的任务同样被捕获', async () => {
    const onError = vi.fn();
    const queue = new OperationQueue({ onError });

    await queue.run('sync-throw', () => {
      throw new Error('同步炸');
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('drain', () => {
  it('等待排队中的操作全部结束', async () => {
    const queue = new OperationQueue({ onError: vi.fn() });
    const gate = deferred();
    let done = false;

    void queue.run('slow', async () => {
      await gate.promise;
      done = true;
    });

    gate.resolve();
    await queue.drain();

    expect(done).toBe(true);
  });
});
