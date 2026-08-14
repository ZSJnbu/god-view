import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configureAgentHook,
  hookCommand,
  inspectAgentHookConfiguration,
  type AgentHookConfigurationOptions,
} from './agent-hook-configuration.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function options(agent: 'codex' | 'claude-code'): Promise<AgentHookConfigurationOptions> {
  const root = await mkdtemp(join(tmpdir(), 'god-view-hooks-'));
  roots.push(root);
  return {
    agent,
    runtimeExecutable: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    gatewayEntry: '/runtime/god-view.mjs',
    workspaceRoot: root,
    platform: 'darwin',
  };
}

describe('Agent hook configuration', () => {
  it.each(['codex', 'claude-code'] as const)('合并 %s hook 并可重复复验', async (agent) => {
    const input = await options(agent);
    const directory = join(input.workspaceRoot, agent === 'codex' ? '.codex' : '.claude');
    const file = join(directory, agent === 'codex' ? 'hooks.json' : 'settings.local.json');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(directory, { recursive: true }));
    await writeFile(
      file,
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } }),
      'utf8',
    );

    await expect(inspectAgentHookConfiguration(input)).resolves.toBe('missing');
    await configureAgentHook(input);
    await expect(inspectAgentHookConfiguration(input)).resolves.toBe('current');
    const configured = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(configured).toMatchObject({ hooks: { PreToolUse: [{ matcher: 'Bash' }] } });
    expect(JSON.stringify(configured)).toContain('UserPromptSubmit');
  });

  it('命令通过 Electron Node 模式调用稳定 Gateway 路径', async () => {
    const input = await options('codex');
    expect(hookCommand(input)).toContain('env ELECTRON_RUN_AS_NODE=1');
    expect(hookCommand(input)).toContain("'/runtime/god-view.mjs' 'hook'");
    expect(hookCommand(input)).toContain("'--adapter' 'codex'");
  });
});
