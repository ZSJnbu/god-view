import { describe, expect, it } from 'vitest';
import { buildAgentSetup } from './agent-setup.js';

describe('buildAgentSetup', () => {
  it('生成 Codex、Claude 和通用 stdio 配置，并使用 VS Code runtime', () => {
    const setup = buildAgentSetup({
      runtimeExecutable: '/Applications/Visual Studio Code.app/Code Helper',
      gatewayEntry: '/Users/me/.vscode/extensions/god view/dist/gateway/god-view.mjs',
      workspaceRoot: '/Users/me/Work/project one',
      platform: 'darwin',
    });
    expect(setup).toContain('codex mcp add --env ELECTRON_RUN_AS_NODE=1 god-view --');
    expect(setup).toContain('--adapter codex');
    expect(setup).toContain("'/Applications/Visual Studio Code.app/Code Helper'");
    expect(setup).toContain('claude mcp add --scope local god-view -e ELECTRON_RUN_AS_NODE=1 --');
    expect(setup).toContain('--adapter claude-code');
    expect(setup).toContain('"ELECTRON_RUN_AS_NODE": "1"');
    expect(setup).toContain("'/Users/me/Work/project one'");
    expect(setup).toContain('"generic-mcp"');
    expect(setup).toContain('monitored');
  });

  it('POSIX 单引号路径不会逃出参数', () => {
    const setup = buildAgentSetup({
      runtimeExecutable: '/tmp/code',
      gatewayEntry: "/tmp/user's/gateway.mjs",
      workspaceRoot: '/tmp/work',
      platform: 'linux',
    });
    expect(setup).toContain("'/tmp/user'\\''s/gateway.mjs'");
  });

  it('Windows 路径使用 PowerShell 单引号', () => {
    const setup = buildAgentSetup({
      runtimeExecutable: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      gatewayEntry: 'C:\\Users\\Me\\god view\\god-view.mjs',
      workspaceRoot: 'C:\\work\\project',
      platform: 'win32',
    });
    expect(setup).toContain("'C:\\Program Files\\Microsoft VS Code\\Code.exe'");
    expect(setup).toContain('C:\\work\\project');
  });
});
