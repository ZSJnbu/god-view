import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const serverName = 'god-view';

export type ConfigurableAgent = 'codex' | 'claude-code';

export interface AgentMcpConfigurationOptions {
  readonly agent: ConfigurableAgent;
  readonly runtimeExecutable: string;
  readonly gatewayEntry: string;
  readonly workspaceRoot: string;
}

export interface AgentMcpConfigurationStatus {
  readonly state: 'missing' | 'current' | 'conflict';
  readonly detail?: string;
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
) => Promise<string>;

/** 查询配置而不读取登录态或密钥；Claude 的 local scope 由 cwd 决定。 */
export async function inspectAgentMcpConfiguration(
  options: AgentMcpConfigurationOptions,
  runner: CommandRunner = runCommand,
): Promise<AgentMcpConfigurationStatus> {
  try {
    const output = await runner(
      executable(options.agent),
      getArgs(options.agent),
      options.workspaceRoot,
    );
    return configurationMatches(output, options)
      ? { state: 'current' }
      : { state: 'conflict', detail: output.slice(0, 1_000) };
  } catch {
    return { state: 'missing' };
  }
}

/** 用户确认后写入 Agent 自己的 MCP 配置，并立即用官方 get 命令复验。 */
export async function configureAgentMcp(
  options: AgentMcpConfigurationOptions,
  replaceExisting: boolean,
  runner: CommandRunner = runCommand,
): Promise<void> {
  if (replaceExisting) {
    await runner(executable(options.agent), removeArgs(options.agent), options.workspaceRoot);
  }
  await runner(executable(options.agent), addArgs(options), options.workspaceRoot);
  const verified = await inspectAgentMcpConfiguration(options, runner);
  if (verified.state !== 'current') {
    throw new Error('Agent 接受了配置命令，但复验结果与当前工作区不一致');
  }
}

function executable(agent: ConfigurableAgent): string {
  return agent === 'codex' ? 'codex' : 'claude';
}

function getArgs(agent: ConfigurableAgent): readonly string[] {
  return ['mcp', 'get', serverName, ...(agent === 'codex' ? ['--json'] : [])];
}

function removeArgs(agent: ConfigurableAgent): readonly string[] {
  return agent === 'codex'
    ? ['mcp', 'remove', serverName]
    : ['mcp', 'remove', '--scope', 'local', serverName];
}

function addArgs(options: AgentMcpConfigurationOptions): readonly string[] {
  const server = [
    options.runtimeExecutable,
    options.gatewayEntry,
    'serve',
    '--workspace',
    options.workspaceRoot,
    '--adapter',
    options.agent,
  ];
  return options.agent === 'codex'
    ? ['mcp', 'add', '--env', 'ELECTRON_RUN_AS_NODE=1', serverName, '--', ...server]
    : [
        'mcp',
        'add',
        '--scope',
        'local',
        serverName,
        '-e',
        'ELECTRON_RUN_AS_NODE=1',
        '--',
        ...server,
      ];
}

function configurationMatches(output: string, options: AgentMcpConfigurationOptions): boolean {
  // Claude 的 `mcp get` 在子进程无法启动时仍可能以 exit code 0 返回；只看命令字段
  // 会把 “Failed to connect” 冒充成复验成功。Codex 当前只提供配置级 get JSON。
  if (options.agent === 'claude-code' && /Failed to connect|Status:\s*[✘✗]/u.test(output)) {
    return false;
  }
  return [
    options.runtimeExecutable,
    options.gatewayEntry,
    options.workspaceRoot,
    `--adapter`,
    options.agent,
  ].every((part) => output.includes(part));
}

async function runCommand(
  executableName: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const { stdout, stderr } = await runFile(executableName, [...args], {
    cwd,
    timeout: 15_000,
    windowsHide: true,
  });
  return stdout.trim() === '' ? stderr : stdout;
}
