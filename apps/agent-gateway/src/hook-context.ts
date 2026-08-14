interface HookInput {
  readonly hook_event_name?: unknown;
  readonly hookEventName?: unknown;
}

interface MapSummary {
  readonly revision: number;
  readonly branch: string;
  readonly nodes: number;
  readonly edges: number;
  readonly activeChanges: readonly string[];
  readonly proposals: readonly string[];
}

/**
 * 为 Codex/Claude 的 UserPromptSubmit hook 生成轻量上下文。
 *
 * 完整地图仍由 get_map 提供；hook 只注入足够的导航信息和交互边界，避免每轮
 * 重复发送整份地图，也避免 God View 变成另一套 Agent 会话协议。
 */
export function buildHookOutput(input: unknown, mapDocument: unknown): Record<string, unknown> {
  const eventName = hookEventName(input);
  if (eventName !== 'UserPromptSubmit') return {};
  const summary = summarizeMap(mapDocument);
  const additionalContext = [
    '[God View 画布上下文]',
    `当前地图：r${String(summary.revision)} · 分支 ${summary.branch} · ${String(summary.nodes)} 个节点 · ${String(summary.edges)} 条关系。`,
    summary.activeChanges.length === 0
      ? '当前没有进行中的 God View ChangeSet。'
      : `进行中的 ChangeSet：${summary.activeChanges.join(', ')}。`,
    summary.proposals.length === 0
      ? '当前没有等待处理的 God View 修改方案。'
      : `待处理方案：${summary.proposals.join(', ')}。`,
    '需要地图细节时先调用 God View MCP 的 get_map；画布变更必须通过 God View MCP 写入。',
    '文件、网络和命令权限仍由当前 Codex/Claude 原生会话处理；God View 不替代原生权限审批。',
  ].join('\n');
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  };
}

function hookEventName(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const record = input as HookInput;
  const value = record.hook_event_name ?? record.hookEventName;
  return typeof value === 'string' ? value : undefined;
}

function summarizeMap(value: unknown): MapSummary {
  const record = asRecord(value);
  const document = asRecord(record?.['document']) ?? record;
  const revision = nonNegativeInteger(document?.['revision']) ?? 0;
  const branch = stringValue(document?.['branchKey']) ?? 'unknown';
  const nodes = arraySize(document?.['nodes']);
  const edges = arraySize(document?.['edges']);
  const activeChanges = recordIds(document?.['activeChanges'], 'changeSetId');
  const proposals = recordIds(document?.['changeProposals']);
  return { revision, branch, nodes, edges, activeChanges, proposals };
}

function recordIds(value: unknown, key = 'id'): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(asRecord(item)?.[key]))
    .filter((item): item is string => item !== undefined)
    .slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function arraySize(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
