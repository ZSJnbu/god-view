import { toDirectorySegment } from '@god-view/storage';

const layoutStatePrefix = 'godView.layout';
const agentDataBoundaryPrefix = 'godView.agentDataBoundaryAccepted';

/** 当前工作区在扩展全局存储中的安全目录名。 */
export function workspaceStorageSegment(workspaceId: string): string {
  return toDirectorySegment(workspaceId);
}

/** 布局必须同时按 workspace 与 branch 隔离，不能让多根工作区的 main 互相覆盖。 */
export function layoutStateKey(workspaceId: string, branchKey: string): string {
  return `${layoutStatePrefix}:${workspaceId}:${branchKey}`;
}

export function isWorkspaceLayoutKey(key: string, workspaceId: string): boolean {
  return key.startsWith(`${layoutStatePrefix}:${workspaceId}:`);
}

/** 接入确认按工作区记录；版本后缀允许数据边界变化时重新征求同意。 */
export function agentDataBoundaryKey(workspaceId: string): string {
  return `${agentDataBoundaryPrefix}:v1:${workspaceId}`;
}
