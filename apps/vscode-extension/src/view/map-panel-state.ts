import type { Identifier } from '@god-view/protocol';

/** VS Code 在窗口重载时交还给 WebviewPanelSerializer 的最小状态。 */
export interface MapPanelState {
  readonly workspaceId: Identifier;
}

/**
 * Webview 持久化状态属于不可信输入，恢复前只读取明确支持的字段。
 *
 * 旧版本没有保存状态时返回 undefined，由组合根按当前工作区重新选择；伪造或过期的
 * workspaceId 不得让面板绑定到另一个根。
 */
export function parseMapPanelState(input: unknown): MapPanelState | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const workspaceId = (input as Record<string, unknown>)['workspaceId'];
  return typeof workspaceId === 'string' && workspaceId !== '' ? { workspaceId } : undefined;
}
