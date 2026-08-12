import { join } from 'node:path';

/**
 * God View 在工作区内的运行时目录布局。
 *
 * 事件收件箱与已发布读模型都放在 `.godview/` 下，并默认不进入 Git
 * （TECHNICAL_ARCHITECTURE.md §7.2、§8.2）。
 */
export const runtimeDirectoryName = '.godview';

export interface WorkspaceRuntimeLayout {
  readonly root: string;
  /** Gateway 写入、扩展消费的事件收件箱。 */
  readonly inboxDir: string;
  /** 扩展发布的只读地图读模型，供 Gateway 的 get_map 使用。 */
  readonly mapFile: string;
  /** 扩展写给 Agent 的连接信息（workspaceId、branchKey、协议版本）。 */
  readonly sessionFile: string;
}

export function resolveWorkspaceRuntime(workspaceRoot: string): WorkspaceRuntimeLayout {
  const root = join(workspaceRoot, runtimeDirectoryName);
  return {
    root,
    inboxDir: join(root, 'inbox'),
    mapFile: join(root, 'map.json'),
    sessionFile: join(root, 'session.json'),
  };
}
