import { describe, expect, it, vi } from 'vitest';
import type { ExtensionEvent } from '@god-view/webview-bridge';
import { createMessenger, type MessengerDeps } from './messaging.js';
import { capabilities, makeDocument, makeNode } from './model/fixtures.test-utils.js';

function harness(onInvalid?: (reason: string) => void) {
  const sent: unknown[] = [];
  const listeners = new Set<(event: { data: unknown }) => void>();
  const deps: MessengerDeps = {
    host: {
      postMessage(message) {
        sent.push(message);
      },
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    ...(onInvalid === undefined ? {} : { onInvalid }),
  };
  return {
    sent,
    messenger: createMessenger(deps),
    emit: (data: unknown) => {
      for (const listener of [...listeners]) {
        listener({ data });
      }
    },
    listenerCount: () => listeners.size,
  };
}

const snapshot: ExtensionEvent = {
  type: 'map/snapshot',
  document: makeDocument([makeNode('a')]),
  capabilities,
  factsRevision: 1,
  drift: [],
};

describe('createMessenger', () => {
  it('把命令原样交给宿主', () => {
    const { messenger, sent } = harness();
    messenger.send({ type: 'ready' });

    expect(sent).toEqual([{ type: 'ready' }]);
  });

  it('只把校验通过的事件交给上层', () => {
    const onInvalid = vi.fn();
    const { messenger, emit } = harness(onInvalid);
    const received: ExtensionEvent[] = [];
    messenger.subscribe((event) => received.push(event));

    emit(snapshot);
    emit({ type: '伪造的事件' });

    expect(received).toEqual([snapshot]);
    expect(onInvalid).toHaveBeenCalledOnce();
  });

  it('没有 onInvalid 时静默丢弃非法消息', () => {
    const { messenger, emit } = harness();
    const received: ExtensionEvent[] = [];
    messenger.subscribe((event) => received.push(event));

    expect(() => {
      emit(null);
    }).not.toThrow();
    expect(received).toEqual([]);
  });

  it('取消订阅后不再收到消息', () => {
    const { messenger, emit, listenerCount } = harness();
    const received: ExtensionEvent[] = [];
    const unsubscribe = messenger.subscribe((event) => received.push(event));

    unsubscribe();
    emit(snapshot);

    expect(received).toEqual([]);
    expect(listenerCount()).toBe(0);
  });
});
