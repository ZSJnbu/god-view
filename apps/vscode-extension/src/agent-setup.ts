export interface AgentSetupOptions {
  readonly runtimeExecutable: string;
  readonly gatewayEntry: string;
  readonly workspaceRoot: string;
  readonly platform: NodeJS.Platform;
}

/**
 * 生成工作区专属的 MCP 接入说明。
 *
 * 只复制命令，不静默修改 Codex/Claude 的全局配置。使用 VS Code 自带的 Electron
 * runtime + ELECTRON_RUN_AS_NODE，用户无需另装 Node；Gateway 与扩展版本也保持一致。
 */
export function buildAgentSetup(options: AgentSetupOptions): string {
  const serverCommand = [
    options.runtimeExecutable,
    options.gatewayEntry,
    'serve',
    '--workspace',
    options.workspaceRoot,
  ];
  const codex = [
    'codex',
    'mcp',
    'add',
    '--env',
    'ELECTRON_RUN_AS_NODE=1',
    'god-view',
    '--',
    ...serverCommand,
    '--adapter',
    'codex',
  ];
  const claude = [
    'claude',
    'mcp',
    'add',
    '--scope',
    'local',
    'god-view',
    '-e',
    'ELECTRON_RUN_AS_NODE=1',
    '--',
    ...serverCommand,
    '--adapter',
    'claude-code',
  ];
  const quote = options.platform === 'win32' ? quotePowerShell : quotePosix;
  const hookArgs = [
    options.runtimeExecutable,
    options.gatewayEntry,
    'hook',
    '--workspace',
    options.workspaceRoot,
  ];
  const hookCommand = (agent: 'codex' | 'claude-code'): string => {
    const command = [...hookArgs, '--adapter', agent].map(quote).join(' ');
    return options.platform === 'win32'
      ? `set "ELECTRON_RUN_AS_NODE=1" && ${command}`
      : `env ELECTRON_RUN_AS_NODE=1 ${command}`;
  };
  const hookEntry = (agent: 'codex' | 'claude-code') => ({
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand(agent),
              timeout: 5,
              statusMessage: 'God View 正在注入画布上下文',
            },
          ],
        },
      ],
    },
  });
  return [
    '# God View 原生 Agent 接入（当前工作区）',
    '',
    '先在 VS Code 中打开一次 God View 地图，确保 .godview/session.json 已生成。',
    '以下命令只新增当前 Agent 的 MCP 配置，不会把密钥交给 God View。请选择你使用的 Agent 执行一条：',
    '',
    '## Codex CLI',
    codex.map(quote).join(' '),
    '',
    '## Claude Code',
    claude.map(quote).join(' '),
    '',
    '## 每轮画布上下文 hook',
    '推荐直接使用 God View 的“配置 Agent”按钮自动合并，避免覆盖已有 hooks。手动配置时，把下列 hooks 字段合并到对应文件：',
    '',
    '### Codex：.codex/hooks.json',
    JSON.stringify(hookEntry('codex'), null, 2),
    '',
    '### Claude Code：.claude/settings.local.json',
    JSON.stringify(hookEntry('claude-code'), null, 2),
    '',
    '## 其他 MCP 客户端（stdio）',
    JSON.stringify(
      {
        command: options.runtimeExecutable,
        args: [
          options.gatewayEntry,
          'serve',
          '--workspace',
          options.workspaceRoot,
          '--adapter',
          'generic-mcp',
        ],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
      null,
      2,
    ),
    '',
    '两套正式 Adapter 使用同一组工具契约，并把事件来源分别记录为 codex / claude-code。',
    '当前均为引导调用与 monitored 权限：God View 能检测越界 Diff，但不能强制沙箱化外部 Agent 进程。',
    '配置完成后退出当前 Agent 会话，在这个工作区目录重开；Codex 首次加载项目 hook 时还会要求你原生确认信任。随后让 Agent 先调用 get_map 自检。',
  ].join('\n');
}

function quotePosix(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function quotePowerShell(value: string): string {
  return /^[A-Za-z0-9_./:=+\\-]+$/u.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
}
