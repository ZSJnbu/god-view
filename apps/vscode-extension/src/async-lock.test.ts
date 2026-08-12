import { describe, expect, it } from 'vitest';
import { AsyncLock } from './async-lock.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    // Promise 构造器会同步替换这个占位函数。
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('AsyncLock', () => {
  it('并发调用按进入顺序执行并保留返回值', async () => {
    const lock = new AsyncLock();
    const gate = deferred();
    const order: string[] = [];

    const first = lock.run(async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      return 1;
    });
    const second = lock.run(() => {
      order.push('second');
      return Promise.resolve(2);
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('任务失败会向调用方抛出，但不会阻塞后续调用', async () => {
    const lock = new AsyncLock();
    await expect(lock.run(() => Promise.reject(new Error('初始化失败')))).rejects.toThrow(
      '初始化失败',
    );
    await expect(lock.run(() => Promise.resolve('recovered'))).resolves.toBe('recovered');
  });
});
