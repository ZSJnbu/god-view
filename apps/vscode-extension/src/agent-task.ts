import type { CoverageReport, DriftFinding } from '@god-view/protocol';

export interface AgentTaskContext {
  readonly revision: number;
  readonly nodeCount: number;
  readonly coverage: CoverageReport | undefined;
  readonly drift: readonly DriftFinding[];
}

/**
 * 生成可交给已连接 Agent 的任务。
 *
 * 空地图与已有地图是两条不同旅程：前者要求先探索和建立全覆盖基线，后者要求在稳定
 * ID 上增量维护。混用同一段模糊提示会诱导 Agent 在空图上“补充”，或在已有图上重复
 * 建模块。
 */
export function buildAgentTask(context: AgentTaskContext): string {
  return context.nodeCount === 0 ? buildInitializationTask(context) : buildMaintenanceTask(context);
}

function buildInitializationTask(context: AgentTaskContext): string {
  const coverage = context.coverage;
  const unclassified = coverage?.unclassifiedPaths ?? [];
  const total = (coverage?.classified ?? 0) + (coverage?.unclassified ?? 0);
  return [
    '请使用 God View MCP 工具为当前工作区建立第一版项目地图。',
    '',
    '连接前置检查：本会话必须已经列出 get_map、begin_change、upsert_node、upsert_edge、complete_change。',
    '如果任一工具不存在，立即停止，不要改文件、不要扫描仓库、不要直接写 .godview；请用户先在 VS Code 执行「God View: Configure Agent MCP」，退出当前 Agent 会话并在本目录重开。',
    '工具齐全后先调用 get_map，确认 workspace、branch 和当前 revision；不要修改用户代码。',
    `插件清单中共有 ${String(total)} 个第一方文件，${String(coverage?.excluded ?? 0)} 个文件已按规则排除。`,
    '',
    '建图要求：',
    '1. 先判断仓库形态、入口、主要业务/技术区域和数据去向，再开始声明。',
    '2. 一般项目用 5–9 个一级模块；小项目可以更少，复杂项目用 group 聚合，不能静默省略区域。',
    '3. 每个模块必须带真实 paths 或 locations 证据；不确定内容写入 uncertainties，不要猜测。',
    '4. 第三方依赖、构建产物、缓存和 vendor 不得进入项目图。',
    '5. 使用 begin_change 开始，逐项 upsert_node / upsert_edge，最后 complete_change。',
    '6. 每次工具返回 rejected 时先修正再继续，不要把失败调用当成已写入。',
    '7. 结束前再次 get_map；所有第一方文件必须归入模块/分组，或明确保留为未分类。',
    '',
    ...limitedPaths(unclassified),
  ].join('\n');
}

function buildMaintenanceTask(context: AgentTaskContext): string {
  const coverage = context.coverage;
  const unclassified = coverage?.unclassifiedPaths ?? [];
  return [
    '请使用 God View MCP 工具维护当前项目地图：',
    '',
    '连接前置检查：若本会话没有 get_map 等 God View MCP 工具，立即停止；请用户先执行「God View: Configure Agent MCP」并重开 Agent 会话。',
    `- 当前地图版本：r${String(context.revision)}`,
    `- 未分类的第一方文件：${String(coverage?.unclassified ?? 0)} 个`,
    `- 待处理漂移：${String(context.drift.length)} 项`,
    '',
    ...limitedPaths(unclassified),
    ...context.drift.slice(0, 50).map((finding) => `漂移(${finding.kind})：${finding.detail}`),
    '',
    '开始前先调用 get_map，在稳定 ID 上增量更新；删除、移动或重构时同步旧节点。',
    '只声明能被代码证实的关系；不确定内容写入 uncertainties，不要猜测。',
  ].join('\n');
}

function limitedPaths(paths: readonly string[]): string[] {
  const visible = paths.slice(0, 50).map((path) => `未分类：${path}`);
  const remaining = paths.length - visible.length;
  return remaining > 0
    ? [...visible, `另有 ${String(remaining)} 个未分类文件，请通过 get_map 获取完整清单。`]
    : visible;
}
