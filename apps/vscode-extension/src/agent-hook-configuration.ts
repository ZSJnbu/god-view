import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readTextFile, writeFileAtomic } from '@god-view/storage';
import type { ConfigurableAgent } from './agent-mcp-configuration.js';

export interface AgentHookConfigurationOptions {
  readonly agent: ConfigurableAgent;
  readonly runtimeExecutable: string;
  readonly gatewayEntry: string;
  readonly workspaceRoot: string;
  readonly platform?: NodeJS.Platform;
}

export type AgentHookConfigurationState = 'missing' | 'current' | 'conflict' | 'error';

export async function inspectAgentHookConfiguration(
  options: AgentHookConfigurationOptions,
): Promise<AgentHookConfigurationState> {
  const path = configurationPath(options);
  const contents = await readTextFile(path);
  if (contents === undefined) return 'missing';
  const root = parseObject(contents);
  if (root === undefined) return 'error';
  const hooks = asObject(root['hooks']);
  const submitHooks = hooks?.['UserPromptSubmit'];
  if (!Array.isArray(submitHooks)) return 'missing';
  const expected = hookCommand(options);
  const godView = submitHooks.filter(isGodViewHook);
  if (godView.length === 0) return 'missing';
  return godView.some((entry) => hookCommands(entry).includes(expected)) ? 'current' : 'conflict';
}

/** 合并 God View hook，保留用户已有的其他 Codex/Claude hooks。 */
export async function configureAgentHook(options: AgentHookConfigurationOptions): Promise<void> {
  const path = configurationPath(options);
  const contents = await readTextFile(path);
  const root = contents === undefined ? {} : parseObject(contents);
  if (root === undefined) {
    throw new Error(`无法解析 Agent hook 配置：${path}`);
  }
  const hooks = asObject(root['hooks']) ?? {};
  const rawSubmitHooks = hooks['UserPromptSubmit'];
  const existing: unknown[] = Array.isArray(rawSubmitHooks) ? (rawSubmitHooks as unknown[]) : [];
  hooks['UserPromptSubmit'] = [
    ...existing.filter((entry) => !isGodViewHook(entry)),
    {
      hooks: [
        {
          type: 'command',
          command: hookCommand(options),
          timeout: 5,
          statusMessage: 'God View 正在注入画布上下文',
        },
      ],
    },
  ];
  root['hooks'] = hooks;
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(root, null, 2)}\n`);
}

export function configurationPath(options: AgentHookConfigurationOptions): string {
  return options.agent === 'codex'
    ? join(options.workspaceRoot, '.codex', 'hooks.json')
    : join(options.workspaceRoot, '.claude', 'settings.local.json');
}

export function hookCommand(options: AgentHookConfigurationOptions): string {
  const args = [
    options.runtimeExecutable,
    options.gatewayEntry,
    'hook',
    '--workspace',
    options.workspaceRoot,
    '--adapter',
    options.agent,
  ];
  return (options.platform ?? process.platform) === 'win32'
    ? `set "ELECTRON_RUN_AS_NODE=1" && ${args.map(quoteWindows).join(' ')}`
    : `env ELECTRON_RUN_AS_NODE=1 ${args.map(quotePosix).join(' ')}`;
}

function parseObject(contents: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(contents) as unknown);
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isGodViewHook(value: unknown): boolean {
  return hookCommands(value).some(
    (command) => command.includes('god-view.mjs') && command.includes('--adapter'),
  );
}

function hookCommands(value: unknown): string[] {
  const hooks = asObject(value)?.['hooks'];
  if (!Array.isArray(hooks)) return [];
  return hooks
    .map((hook) => asObject(hook)?.['command'])
    .filter((command): command is string => typeof command === 'string');
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
