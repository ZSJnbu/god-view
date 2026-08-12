/**
 * `@god-view/webview-bridge` 的唯一公开入口。
 *
 * 回答一个问题：**扩展与 Webview 之间允许交换哪些消息，如何在边界解析它们。**
 */
export type {
  ExtensionEvent,
  ExtensionEventType,
  MapPatch,
  SyncState,
  ViewCapabilities,
  WebviewCommand,
  WebviewCommandType,
} from './messages.js';

export { parseExtensionEvent, parseWebviewCommand } from './parse.js';
