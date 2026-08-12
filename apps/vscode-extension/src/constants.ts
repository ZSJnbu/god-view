/**
 * 命令 ID、视图 ID 与配置 key 集中定义。
 *
 * 散落在各处的字符串无法与 manifest 保持一致，因此统一在此声明，
 * 由 manifest 一致性测试校验（CODING_STANDARDS.md §11）。
 */
export const commandIds = {
  openProjectMap: 'godView.openProjectMap',
  revealInGodView: 'godView.revealInGodView',
  generateAgentTask: 'godView.generateAgentTask',
  copyAgentSetup: 'godView.copyAgentSetup',
  configureAgent: 'godView.configureAgent',
  showAgentAdapters: 'godView.showAgentAdapters',
  showDiagnostics: 'godView.showDiagnostics',
  clearWorkspaceData: 'godView.clearWorkspaceData',
  exportMapSnapshot: 'godView.exportMapSnapshot',
} as const;

export const viewIds = {
  structure: 'godView.structure',
} as const;

export const configSection = 'godView';

/**
 * 已实现并真正被读取的配置项。
 *
 * 这里只列代码会读的 key。manifest 里出现、但没有任何代码消费的设置属于假开关：
 * 用户改了以为生效，实际什么也没发生。`constants.test.ts` 校验这份清单与
 * `package.json` 的 `contributes.configuration` 双向一致——但那只能证明两边**声明**
 * 一致，证明不了设置真的生效；后者需要针对该设置的行为测试。
 */
export const configKeys = {
  exclude: 'exclude',
} as const;

export const outputChannelName = 'God View';
