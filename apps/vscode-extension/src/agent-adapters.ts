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
    canBeInvoked: false,
    supportsMcp: true,
    explainPermissionMode: 'monitored',
    supportsScopeEnforcement: false,
    supportsCancellation: false,
    supportsStreaming: false,
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
    '接入：MCP 引导调用（插件不能主动启动）',
    '写入权限：monitored（检测越界，不是运行时强制）',
    '取消/流式：当前不支持托管任务取消或流式状态',
    '数据边界：Agent 可能把代码发送到云端，请遵循其数据政策',
  ].join('\n');
}
