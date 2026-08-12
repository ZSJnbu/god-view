import { describe, expect, it } from 'vitest';
import {
  configureAgentMcp,
  inspectAgentMcpConfiguration,
  type AgentMcpConfigurationOptions,
  type CommandRunner,
} from './agent-mcp-configuration.js';

const options: AgentMcpConfigurationOptions = {
  agent: 'claude-code',
  runtimeExecutable: '/Applications/Code Helper',
  gatewayEntry: '/runtime/god-view.mjs',
  workspaceRoot: '/work/project',
};

function configuredOutput(input = options): string {
  return [
    input.runtimeExecutable,
    input.gatewayEntry,
    '--workspace',
    input.workspaceRoot,
    '--adapter',
    input.agent,
  ].join(' ');
}

describe('Agent MCP 显式配置', () => {
  it('不存在时返回 missing，不把 CLI 错误冒充已接入', async () => {
    const runner: CommandRunner = () => Promise.reject(new Error('not found'));
    await expect(inspectAgentMcpConfiguration(options, runner)).resolves.toEqual({
      state: 'missing',
    });
  });

  it('只有 runtime、workspace 和 adapter 全部匹配才算当前配置', async () => {
    const current: CommandRunner = () => Promise.resolve(configuredOutput());
    const stale: CommandRunner = () =>
      Promise.resolve(configuredOutput({ ...options, workspaceRoot: '/old' }));
    await expect(inspectAgentMcpConfiguration(options, current)).resolves.toEqual({
      state: 'current',
    });
    await expect(inspectAgentMcpConfiguration(options, stale)).resolves.toMatchObject({
      state: 'conflict',
    });
  });

  it('Claude get 即使以成功退出也不能把连接失败冒充成已复验', async () => {
    const runner: CommandRunner = () =>
      Promise.resolve(`Status: ✘ Failed to connect\nCommand: ${configuredOutput()}`);
    await expect(inspectAgentMcpConfiguration(options, runner)).resolves.toMatchObject({
      state: 'conflict',
    });
  });

  it('Claude local 配置使用当前 workspace，并在添加后 get 复验', async () => {
    const calls: { executable: string; args: readonly string[]; cwd: string }[] = [];
    const runner: CommandRunner = (executable, args, cwd) => {
      calls.push({ executable, args, cwd });
      return Promise.resolve(args[1] === 'get' ? configuredOutput() : 'ok');
    };
    await configureAgentMcp(options, false, runner);
    expect(calls[0]).toEqual({
      executable: 'claude',
      cwd: '/work/project',
      args: [
        'mcp',
        'add',
        '--scope',
        'local',
        'god-view',
        '-e',
        'ELECTRON_RUN_AS_NODE=1',
        '--',
        '/Applications/Code Helper',
        '/runtime/god-view.mjs',
        'serve',
        '--workspace',
        '/work/project',
        '--adapter',
        'claude-code',
      ],
    });
    expect(calls[1]?.args.slice(0, 3)).toEqual(['mcp', 'get', 'god-view']);
  });

  it('替换冲突配置时先 remove，Codex 使用自己的 adapter 身份', async () => {
    const codex = { ...options, agent: 'codex' as const };
    const calls: string[][] = [];
    const runner: CommandRunner = (_executable, args) => {
      calls.push([...args]);
      return Promise.resolve(args[1] === 'get' ? configuredOutput(codex) : 'ok');
    };
    await configureAgentMcp(codex, true, runner);
    expect(calls[0]).toEqual(['mcp', 'remove', 'god-view']);
    expect(calls[1]).toEqual(
      expect.arrayContaining(['--env', 'ELECTRON_RUN_AS_NODE=1', '--adapter', 'codex']),
    );
  });
});
