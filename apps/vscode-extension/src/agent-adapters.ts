import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { currentProtocolVersion, type AdapterCapabilities } from '@god-view/protocol';

const runFile = promisify(execFile);

export interface AgentAdapterStatus {
  readonly id: 'codex' | 'claude-code';
  readonly executable: 'codex' | 'claude';
  readonly displayName: string;
  readonly installed: boolean;
  readonly version?: string;
  readonly capabilities: AdapterCapabilities;
}

export type VersionProbe = (executable: string) => Promise<string>;

const adapters = [
  { id: 'codex', executable: 'codex', displayName: 'Codex CLI' },
  { id: 'claude-code', executable: 'claude', displayName: 'Claude Code' },
] as const;

function capabilities(id: AgentAdapterStatus['id'], displayName: string): AdapterCapabilities {
  return {
    adapterId: `god-view.${id}`,
    displayName,
    protocolVersion: currentProtocolVersion,
    canBeInvoked: true,
    supportsMcp: true,
    explainPermissionMode: 'monitored',
    supportsScopeEnforcement: false,
    supportsCancellation: true,
    supportsStreaming: true,
    maySendCodeToCloud: true,
    costEstimateAvailable: false,
  };
}

/** 只运行公开的 `--version`，不读取 Agent 配置、登录态或密钥。 */
export async function detectAgentAdapters(
  probe: VersionProbe = probeVersion,
): Promise<readonly AgentAdapterStatus[]> {
  return Promise.all(
    adapters.map(async (adapter): Promise<AgentAdapterStatus> => {
      try {
        const version = (await probe(adapter.executable)).trim().split(/\r?\n/u)[0]?.slice(0, 200);
        return {
          ...adapter,
          installed: true,
          ...(version === undefined || version === '' ? {} : { version }),
          capabilities: capabilities(adapter.id, adapter.displayName),
        };
      } catch {
        return {
          ...adapter,
          installed: false,
          capabilities: capabilities(adapter.id, adapter.displayName),
        };
      }
    }),
  );
}

async function probeVersion(executable: string): Promise<string> {
  const { stdout, stderr } = await runFile(executable, ['--version'], {
    timeout: 3000,
    windowsHide: true,
  });
  return stdout.trim() === '' ? stderr : stdout;
}

export function describeAdapter(status: AgentAdapterStatus): string {
  const installed = status.installed
    ? `已检测到${status.version ? ` · ${status.version}` : ''}`
    : '未检测到';
  return [
    `${status.displayName}：${installed}`,
    '接入：可从首次建图面板启动新的受控 CLI 会话，也保留 MCP 手动接入',
    '写入权限：monitored（检测越界，不是运行时强制）',
    '取消/流式：首次建图支持进度输出、结构化选择和停止进程',
    '数据边界：Agent 可能把代码发送到云端，请遵循其数据政策',
  ].join('\n');
}
