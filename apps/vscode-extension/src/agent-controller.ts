import { commands, env, window, type ExtensionContext } from 'vscode';
import type { AgentConfigurationView } from '@god-view/webview-bridge';
import { buildAgentSetup } from './agent-setup.js';
import { describeAdapter, detectAgentAdapters } from './agent-adapters.js';
import {
  configureAgentMcp,
  inspectAgentMcpConfiguration,
  type ConfigurableAgent,
} from './agent-mcp-configuration.js';
import { configureAgentHook, inspectAgentHookConfiguration } from './agent-hook-configuration.js';
import { commandIds } from './constants.js';
import type { Logger } from './logger.js';
import type { RuntimeAssetState } from './runtime-assets.js';
import { MapPanel } from './view/map-panel.js';
import { agentDataBoundaryKey } from './workspace-data.js';
import type { WorkspaceIdentity } from './workspace/workspace-identity.js';

export interface AgentHostSession {
  readonly identity: WorkspaceIdentity;
}

export function selectedAgentKey(workspaceId: string): string {
  return `godView.agent.selected.${workspaceId}`;
}

export async function publishAgentStatus(
  context: ExtensionContext,
  logger: Logger,
  current: AgentHostSession,
  assets: RuntimeAssetState | undefined,
): Promise<void> {
  try {
    const agents = await collectAgentStatus(current, assets);
    const stored = context.workspaceState.get<ConfigurableAgent>(
      selectedAgentKey(current.identity.id),
    );
    const selectedAgent = agents.some(
      (item) => item.agent === stored && item.configuration === 'current',
    )
      ? stored
      : agents.find((item) => item.configuration === 'current')?.agent;
    MapPanel.postToCurrent({
      type: 'agent/status',
      agents,
      ...(selectedAgent === undefined ? {} : { selectedAgent }),
    });
  } catch (error) {
    logger.warn('agentStatus.failed', { errorCode: describeError(error) });
  }
}

export async function copyAgentSetup(
  context: ExtensionContext,
  logger: Logger,
  current: AgentHostSession | undefined,
  assets: RuntimeAssetState | undefined,
): Promise<void> {
  if (assets === undefined) {
    await window.showErrorMessage(
      'God View Gateway 未能安装到运行时目录。请执行「God View: Show Diagnostics」查看原因。',
    );
    return;
  }
  if (
    current === undefined ||
    !(await acceptAgentDataBoundary(context, logger, current.identity.id))
  )
    return;
  await env.clipboard.writeText(
    buildAgentSetup({
      runtimeExecutable: process.execPath,
      gatewayEntry: assets.gatewayEntry,
      workspaceRoot: current.identity.root.fsPath,
      platform: process.platform,
    }),
  );
  logger.info('agentSetup.copied', { workspaceId: current.identity.id });
  await window.showInformationMessage('Codex、Claude Code 与通用 MCP 接入配置已复制。');
}

export async function configureAgent(
  context: ExtensionContext,
  logger: Logger,
  current: AgentHostSession | undefined,
  assets: RuntimeAssetState | undefined,
  requested?: ConfigurableAgent,
): Promise<void> {
  if (assets === undefined) {
    await window.showErrorMessage('God View Gateway 尚未就绪，请先查看诊断。');
    return;
  }
  if (current === undefined) return;
  const agent = requested ?? (await pickConfigurableAgent());
  if (agent === undefined || !(await acceptAgentDataBoundary(context, logger, current.identity.id)))
    return;
  const options = {
    agent,
    runtimeExecutable: process.execPath,
    gatewayEntry: assets.gatewayEntry,
    workspaceRoot: current.identity.root.fsPath,
  } as const;
  const status = await inspectAgentIntegration(options);
  if (status.state === 'current') {
    await markConfigured(context, logger, current, assets, agent, false);
    return;
  }
  const displayName = agent === 'codex' ? 'Codex' : 'Claude Code';
  const action = await window.showWarningMessage(
    [
      `${displayName} 尚未完整接入当前工作区的 God View。`,
      status.state === 'conflict'
        ? '已存在同名但指向其他 runtime/workspace 的配置，将先移除再替换。'
        : '将写入 Agent 自己的 MCP 与上下文 hook 配置；不会读取登录态或密钥。',
      `工作区：${current.identity.root.fsPath}`,
      '现有 Agent 会话不会热加载新工具，配置成功后必须退出并在这个目录重开。',
    ].join('\n'),
    { modal: true },
    status.state === 'conflict' ? '替换并验证' : '配置并验证',
  );
  if (action === undefined) return;
  try {
    const mcp = await inspectAgentMcpConfiguration(options);
    if (mcp.state !== 'current') await configureAgentMcp(options, mcp.state === 'conflict');
    await configureAgentHook(options);
    logger.info('agentMcp.configured', {
      workspaceId: current.identity.id,
      agent,
      replaced: status.state === 'conflict',
    });
    await markConfigured(context, logger, current, assets, agent, true);
  } catch (error) {
    logger.error('agentMcp.configure.failed', {
      workspaceId: current.identity.id,
      agent,
      errorCode: describeError(error),
    });
    await publishAgentStatus(context, logger, current, assets);
    const fallback = await window.showErrorMessage(
      `${displayName} MCP 或上下文 hook 配置/复验失败。可以复制手动命令，并在终端执行后重开 Agent 会话。`,
      '复制手动命令',
      '查看诊断',
    );
    if (fallback === '复制手动命令') await copyAgentSetup(context, logger, current, assets);
    else if (fallback === '查看诊断') await commands.executeCommand(commandIds.showDiagnostics);
  }
}

export async function showAgentAdapters(logger: Logger): Promise<void> {
  const statuses = await detectAgentAdapters();
  logger.info('adapters.detected', {
    codex: statuses.find((item) => item.id === 'codex')?.installed,
    claudeCode: statuses.find((item) => item.id === 'claude-code')?.installed,
  });
  const picked = await window.showQuickPick(
    statuses.map((status) => ({
      label: `${status.installed ? '$(check)' : '$(circle-slash)'} ${status.displayName}`,
      description: status.installed ? (status.version ?? '已检测到') : '未检测到可执行文件',
      detail: describeAdapter(status),
      status,
    })),
    {
      title: 'God View Agent Adapters（只读检测）',
      placeHolder: '选择一个 Adapter 查看接入能力；不会修改配置',
    },
  );
  if (picked !== undefined)
    await window.showInformationMessage(describeAdapter(picked.status), { modal: true });
}

async function collectAgentStatus(
  current: AgentHostSession,
  assets: RuntimeAssetState | undefined,
): Promise<readonly AgentConfigurationView[]> {
  return Promise.all(
    (await detectAgentAdapters()).map(async (adapter): Promise<AgentConfigurationView> => {
      const base = {
        agent: adapter.id,
        displayName: adapter.displayName,
        installed: adapter.installed,
        ...(adapter.version === undefined ? {} : { version: adapter.version }),
        workspaceRoot: current.identity.root.fsPath,
      } as const;
      if (!adapter.installed)
        return { ...base, configuration: 'missing', detail: '未检测到 CLI，请先安装并加入 PATH。' };
      if (assets === undefined)
        return { ...base, configuration: 'error', detail: 'Gateway 运行时尚未就绪，请查看诊断。' };
      const status = await inspectAgentIntegration({
        agent: adapter.id,
        runtimeExecutable: process.execPath,
        gatewayEntry: assets.gatewayEntry,
        workspaceRoot: current.identity.root.fsPath,
      });
      return status.state === 'current'
        ? {
            ...base,
            configuration: 'current',
            detail: '原生会话、MCP 与每轮上下文 hook 已配置并复验。',
          }
        : {
            ...base,
            configuration: status.state,
            detail:
              status.state === 'conflict'
                ? '已有同名配置，但不属于当前工作区。'
                : '尚未完整配置当前工作区的 MCP 与上下文 hook。',
          };
    }),
  );
}

async function inspectAgentIntegration(options: {
  readonly agent: ConfigurableAgent;
  readonly runtimeExecutable: string;
  readonly gatewayEntry: string;
  readonly workspaceRoot: string;
}): Promise<{ readonly state: 'missing' | 'current' | 'conflict' | 'error' }> {
  const [mcp, hook] = await Promise.all([
    inspectAgentMcpConfiguration(options),
    inspectAgentHookConfiguration(options),
  ]);
  if (mcp.state === 'current' && hook === 'current') return { state: 'current' };
  if (hook === 'error') return { state: 'error' };
  if (mcp.state === 'conflict' || hook === 'conflict') return { state: 'conflict' };
  return { state: 'missing' };
}

async function markConfigured(
  context: ExtensionContext,
  logger: Logger,
  current: AgentHostSession,
  assets: RuntimeAssetState,
  agent: ConfigurableAgent,
  newlyConfigured: boolean,
): Promise<void> {
  await context.workspaceState.update(selectedAgentKey(current.identity.id), agent);
  await publishAgentStatus(context, logger, current, assets);
  const name = agent === 'codex' ? 'Codex' : 'Claude Code';
  await window.showInformationMessage(
    `${name} 的 MCP 与上下文 hook ${newlyConfigured ? '已配置并通过复验' : '已与当前工作区一致'}。请退出当前 ${name} 会话，在这个工作区目录重新启动，然后先让 Agent 调用 get_map；旧会话不会获得新配置。`,
    { modal: true },
  );
}

export async function acceptAgentDataBoundary(
  context: ExtensionContext,
  logger: Logger,
  workspaceId: string,
): Promise<boolean> {
  const key = agentDataBoundaryKey(workspaceId);
  if (context.workspaceState.get<boolean>(key) === true) return true;
  const accepted = await window.showWarningMessage(
    [
      'Codex、Claude Code 或其他 MCP Agent 可能把其读取的工作区代码发送到云端。',
      '数据保留、费用和训练政策由所选 Agent 决定，God View 无法预估；God View 不读取或保存 Agent 密钥。',
      '自动首次建图会限制源码写入；你在其他窗口或终端自行启动的 Agent 仍是 monitored 模式，插件只能观察 Git Diff，不能阻止其越界写入。',
    ].join('\n'),
    { modal: true },
    '理解并继续',
  );
  if (accepted !== '理解并继续') {
    logger.info('agentSetup.cancelled', { workspaceId, reason: 'data-boundary-not-accepted' });
    return false;
  }
  await context.workspaceState.update(key, true);
  return true;
}

async function pickConfigurableAgent(): Promise<ConfigurableAgent | undefined> {
  const statuses = await detectAgentAdapters();
  const picked = await window.showQuickPick(
    statuses.map((status) => ({
      label: status.displayName,
      description: status.installed ? (status.version ?? '已安装') : '未检测到 CLI',
      agent: status.id,
    })),
    { title: '选择要接入当前工作区的 Agent' },
  );
  if (picked?.description === '未检测到 CLI') {
    await window.showErrorMessage(`${picked.label} CLI 未安装或不在 PATH 中。`);
    return undefined;
  }
  return picked?.agent;
}

function describeError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
  )
    return error.name;
  return typeof error;
}
