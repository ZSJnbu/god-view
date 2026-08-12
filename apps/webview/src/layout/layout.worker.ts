/// <reference lib="webworker" />
import { computeLayout, type LayoutRequest } from './layout.js';

/**
 * 布局 Worker 入口。
 *
 * 这里只做消息搬运，真正的算法在 {@link computeLayout} 里保持纯函数，
 * 因此可以脱离 Worker 直接单测。
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== 'object' || message === null) {
    return;
  }
  const { id, request } = message as { id?: unknown; request?: LayoutRequest };
  if (typeof id !== 'number' || request === undefined) {
    return;
  }
  scope.postMessage({ id, positions: computeLayout(request).positions });
});
