import { toDirectorySegment } from '@god-view/storage';

// 布局算法/语义改变时递增，避免旧自动布局坐标在升级后永久覆盖新算法。
const layoutStatePrefix = 'godView.layout:v3';
const agentDataBoundaryPrefix = 'godView.agentDataBoundaryAccepted';
const agentPaneHeightPrefix = 'godView.agentPaneHeight:v1';
const agentPaneViewPrefix = 'godView.agentPaneView:v1';

/** 当前工作区在扩展全局存储中的安全目录名。 */
export function workspaceStorageSegment(workspaceId: string): string {
  return toDirectorySegment(workspaceId);
}

/** 布局必须同时按 workspace 与 branch 隔离，不能让多根工作区的 main 互相覆盖。 */
export function layoutStateKey(workspaceId: string, branchKey: string): string {
  return `${layoutStatePrefix}:${workspaceId}:${branchKey}`;
}

export function isWorkspaceLayoutKey(key: string, workspaceId: string): boolean {
  return (
    key.startsWith(`${layoutStatePrefix}:${workspaceId}:`) ||
    key.startsWith(`godView.layout:v2:${workspaceId}:`) ||
    key.startsWith(`godView.layout:${workspaceId}:`)
  );
}

/** Agent 输出视窗高度按工作区保存；分支切换不应让用户的界面偏好跳变。 */
export function agentPaneHeightKey(workspaceId: string): string {
  return `${agentPaneHeightPrefix}:${workspaceId}`;
}

export function agentPaneViewKey(workspaceId: string): string {
  return `${agentPaneViewPrefix}:${workspaceId}`;
}

/** 接入确认按工作区记录；版本后缀允许数据边界变化时重新征求同意。 */
export function agentDataBoundaryKey(workspaceId: string): string {
  return `${agentDataBoundaryPrefix}:v1:${workspaceId}`;
}
