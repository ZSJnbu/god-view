import { parseExtensionEvent } from '@god-view/webview-bridge';
import type { ExtensionEvent, WebviewCommand } from '@god-view/webview-bridge';

/** VS Code 注入的宿主 API。Webview 只能通过它与扩展通信。 */
export interface VsCodeHost {
  postMessage(message: unknown): void;
}

export interface Messenger {
  send(command: WebviewCommand): void;
  /** 返回取消订阅函数。 */
  subscribe(listener: (event: ExtensionEvent) => void): () => void;
}

export interface MessengerDeps {
  readonly host: VsCodeHost;
  readonly addEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void;
  readonly removeEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void;
  readonly onInvalid?: (reason: string) => void;
}

/**
 * 扩展 ↔ Webview 的消息通道。
 *
 * 入站消息一律经过 `parseExtensionEvent` 校验后才交给上层：Webview 同样是信任边界，
 * 不能假设收到的 `postMessage` 一定来自我们自己的扩展（TECHNICAL_ARCHITECTURE.md §9.3）。
 */
export function createMessenger(deps: MessengerDeps): Messenger {
  return {
    send(command) {
      deps.host.postMessage(command);
    },
    subscribe(listener) {
      const handler = (event: { data: unknown }): void => {
        const parsed = parseExtensionEvent(event.data);
        if (parsed.ok) {
          listener(parsed.value);
          return;
        }
        deps.onInvalid?.(parsed.error.code);
      };
      deps.addEventListener('message', handler);
      return () => {
        deps.removeEventListener('message', handler);
      };
    },
  };
}
