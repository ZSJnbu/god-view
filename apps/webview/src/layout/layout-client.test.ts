import { describe, expect, it } from 'vitest';
import { LayoutClient, type WorkerLike } from './layout-client.js';
import { computeLayout } from './layout.js';

/** 立即在同一 tick 内回复的假 Worker。 */
function fakeWorker(): WorkerLike & { readonly terminated: () => boolean } {
  let listener: ((event: { data: unknown }) => void) | undefined;
  let terminated = false;
  return {
    postMessage(message) {
      const { id, request } = message as {
        id: number;
        request: Parameters<typeof computeLayout>[0];
      };
      listener?.({ data: { id, positions: computeLayout(request).positions } });
    },
    addEventListener(_type, next) {
      listener = next;
    },
    terminate() {
      terminated = true;
    },
    terminated: () => terminated,
  };
}

const request = {
  nodes: [{ id: 'a', label: 'a', column: 'core' as const, weight: 2 }],
  edges: [],
  pinned: {},
};

describe('LayoutClient', () => {
  it('把请求交给 Worker 并按 id 匹配回复', async () => {
    const client = new LayoutClient(fakeWorker);

    await expect(client.compute(request)).resolves.toEqual(computeLayout(request));
  });

  it('Worker 创建失败时同步降级，功能不消失', async () => {
    const client = new LayoutClient(() => {
      throw new Error('CSP 拦截');
    });

    await expect(client.compute(request)).resolves.toEqual(computeLayout(request));
  });

  it('忽略结构不合法的回复', async () => {
    let listener: ((event: { data: unknown }) => void) | undefined;
    const client = new LayoutClient(() => ({
      postMessage(message) {
        const { id } = message as { id: number };
        listener?.({ data: 'garbage' });
        listener?.({ data: { id: id + 100, positions: {} } });
        listener?.({ data: { id, positions: { a: { x: 1, y: 2 } } } });
      },
      addEventListener(_type, next) {
        listener = next;
      },
      terminate() {
        /* 测试无需实现 */
      },
    }));

    await expect(client.compute(request)).resolves.toEqual({ positions: { a: { x: 1, y: 2 } } });
  });

  it('dispose 终止 Worker', () => {
    const worker = fakeWorker();
    const client = new LayoutClient(() => worker);
    client.dispose();

    expect(worker.terminated()).toBe(true);
  });
});
