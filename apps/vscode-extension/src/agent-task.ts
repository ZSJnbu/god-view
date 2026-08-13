import type { CoverageReport, DriftFinding } from '@god-view/protocol';

export interface AgentTaskContext {
  readonly revision: number;
  readonly nodeCount: number;
  readonly coverage: CoverageReport | undefined;
  readonly drift: readonly DriftFinding[];
}

export type AgentTaskMode = 'automatic' | 'reinitialize' | 'complete_groups' | 'complete_files';

/**
 * 生成可交给已连接 Agent 的任务。
 *
 * 空地图与已有地图是两条不同旅程：前者要求先探索和建立全覆盖基线，后者要求在稳定
 * ID 上增量维护。混用同一段模糊提示会诱导 Agent 在空图上“补充”，或在已有图上重复
 * 建模块。
 */
export function buildAgentTask(
  context: AgentTaskContext,
  mode: AgentTaskMode = 'automatic',
): string {
  if (mode === 'reinitialize') return buildReinitializationTask(context);
  if (mode === 'complete_groups') return buildCompletionTask(context, 'groups');
  if (mode === 'complete_files') return buildCompletionTask(context, 'files');
  return context.nodeCount === 0 ? buildInitializationTask(context) : buildMaintenanceTask(context);
}

function buildCompletionTask(context: AgentTaskContext, target: 'groups' | 'files'): string {
  const isGroups = target === 'groups';
  return [
    `请使用 God View MCP 增量补全当前地图的${isGroups ? '分组层级' : '关键文件关系'}。`,
    '',
    '这是用户主动要求的局部补全，不是重新初始化：保留现有模块、关系、稳定 ID 和人工布局；不得修改用户源码，也不得直接写 .godview。',
    `当前基线：地图 r${String(context.revision)}，${String(context.nodeCount)} 个节点。`,
    '',
    '补全要求：',
    '1. 先调用 get_map(includeCoverage: true)，核对 workspace、branch、revision、现有结构与 activeChanges；若已有进行中的 ChangeSet，立即停止，不得并发写入。',
    isGroups
      ? '2. 只读分析现有一级模块的业务/技术归属；用少量有意义的 group 作为父级，并通过 parentId 归组。不要为了显示按钮创建空分组或无证据分组。'
      : '2. 只读分析各模块的关键入口、公共边界与跨模块调用；在所属模块下补充 file 节点及 parentId，并只声明可由 import/调用证实的关键文件关系。不要把全部文件平铺到画布。',
    '3. 每个新增节点必须带真实 paths 或 locations 证据；不确定内容写入 uncertainties，不要猜测。',
    '4. 不得删除或改写无关节点/关系；第三方依赖、构建产物、缓存和 vendor 不得进入地图。',
    '5. 只调用一次 begin_change，并只使用其返回的 changeSetId 完成 upsert；任何 rejected 都必须修正。',
    `6. complete_change 后再次 get_map，确认新增${isGroups ? '分组及模块 parentId' : '文件节点及关键关系'}已可见、activeChanges 为空，并报告最终 revision 和新增数量。`,
  ].join('\n');
}

function buildReinitializationTask(context: AgentTaskContext): string {
  const coverage = context.coverage;
  const total = (coverage?.classified ?? 0) + (coverage?.unclassified ?? 0);
  return [
    '请使用 God View MCP 根据当前仓库状态重新初始化并完整重绘项目地图。',
    '',
    '这是用户主动确认的全图重绘，不是普通增量维护；不得修改用户源码，也不得直接写 .godview。',
    '连接前置检查：本会话必须已经列出 get_map、begin_change、upsert_node、upsert_edge、remove_node、remove_edge、complete_change。任一工具缺失就立即停止，请用户重新配置 MCP 并重开 Agent 会话。',
    `重绘基线：地图 r${String(context.revision)}，现有 ${String(context.nodeCount)} 个节点，清单共 ${String(total)} 个第一方文件。`,
    '',
    '重绘要求：',
    '1. 先调用 get_map(includeCoverage: true)，核对 workspace、branch、revision、现有节点/关系和 activeChanges；若已有进行中的 ChangeSet，不得启动第二个任务。',
    '2. 重新只读分析当前仓库形态、入口、主要业务/技术区域和数据去向，再设计目标地图；不要默认旧地图仍然正确。',
    '3. 职责仍一致的模块和关系必须保留稳定 ID；职责已变化的内容更新，新增区域补充，已过时关系先 remove_edge、已过时节点再 remove_node。不要先清空整张地图。',
    '4. 一般项目使用 5–9 个一级模块；复杂项目使用 group 聚合。每个模块都必须带真实 paths 或 locations 证据，不确定内容写入 uncertainties。',
    '5. 第三方依赖、构建产物、缓存和 vendor 不得进入项目图；所有第一方文件必须归入模块/分组，或明确保留为未分类。',
    '6. 只使用一次 begin_change，并只使用其返回的 changeSetId 完成全部 upsert/remove；任何 rejected 都必须修正，不能视作成功。',
    '7. complete_change 后再次 get_map，确认新节点/关系已可见、旧实体已正确移除、activeChanges 为空，并报告最终 revision、节点数、关系数和未分类数。',
    '',
    ...limitedPaths(coverage?.unclassifiedPaths ?? []),
  ].join('\n');
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
    '若 get_map 返回 activeChanges，说明已有未结束任务：不得重复 begin_change 或猜 ID；先向用户展示 changeSetId、开始时间和职责，确认后才能用该 ID complete_change(interrupted)，再重新读取地图并继续。',
    `插件清单中共有 ${String(total)} 个第一方文件，${String(coverage?.excluded ?? 0)} 个文件已按规则排除。`,
    '',
    '建图要求：',
    '1. 先判断仓库形态、入口、主要业务/技术区域和数据去向，再开始声明。',
    '2. 一般项目用 5–9 个一级模块；小项目可以更少，复杂项目用 group 聚合，不能静默省略区域。',
    '3. 每个模块必须带真实 paths 或 locations 证据；不确定内容写入 uncertainties，不要猜测。',
    '4. 第三方依赖、构建产物、缓存和 vendor 不得进入项目图。',
    '5. 使用 begin_change 开始；必须使用其返回的 changeSetId 逐项 upsert_node / upsert_edge，最后 complete_change。不要自行猜测或生成 changeSetId；若返回值缺失该字段，立即停止并报告 Gateway 协议错误。',
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
