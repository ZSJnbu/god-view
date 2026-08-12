import {
  currentProtocolVersion,
  type AdapterCapabilities,
  type Identifier,
} from '@god-view/protocol';

export const adapterNames = ['codex', 'claude-code', 'generic-mcp'] as const;
export type AdapterName = (typeof adapterNames)[number];

export interface AgentAdapterProfile {
  readonly name: AdapterName;
  readonly actorAdapterId: Identifier;
  readonly capabilities: AdapterCapabilities;
}

function profile(
  name: AdapterName,
  displayName: string,
  actorAdapterId: Identifier,
): AgentAdapterProfile {
  return {
    name,
    actorAdapterId,
    capabilities: {
      adapterId: `god-view.${name}`,
      displayName,
      protocolVersion: currentProtocolVersion,
      canBeInvoked: false,
      supportsMcp: true,
      explainPermissionMode: 'monitored',
      supportsScopeEnforcement: false,
      supportsCancellation: false,
      supportsStreaming: false,
      maySendCodeToCloud: true,
      costEstimateAvailable: false,
    },
  };
}

/**
 * 正式 Adapter 只声明 MCP 宿主实际提供的能力。
 *
 * God View 不读取 Agent 密钥，也不能从一个外部 MCP server 反向启动或沙箱化宿主
 * Agent；因此 Codex 和 Claude Code 当前都是引导调用、monitored 权限模式。
 */
export const agentAdapterProfiles: Readonly<Record<AdapterName, AgentAdapterProfile>> = {
  codex: profile('codex', 'Codex CLI', 'codex'),
  'claude-code': profile('claude-code', 'Claude Code', 'claude-code'),
  'generic-mcp': profile('generic-mcp', '通用 MCP 客户端', 'generic-mcp'),
};

export function resolveAdapterProfile(value: string | undefined): AgentAdapterProfile | undefined {
  return adapterNames.includes(value as AdapterName)
    ? agentAdapterProfiles[value as AdapterName]
    : undefined;
}
