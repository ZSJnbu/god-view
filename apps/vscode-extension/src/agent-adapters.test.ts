import { describe, expect, it } from 'vitest';
import { describeAdapter, detectAgentAdapters } from './agent-adapters.js';

describe('Agent Adapter 检测', () => {
  it('用同一契约检测 Codex 与 Claude，不读取配置或密钥', async () => {
    const called: string[] = [];
    const statuses = await detectAgentAdapters((executable) => {
      called.push(executable);
      return executable === 'codex'
        ? Promise.resolve('codex-cli 1.2.3\n')
        : Promise.resolve('claude 4.5.0\n');
    });
    expect(called.sort()).toEqual(['claude', 'codex']);
    expect(statuses.map((status) => status.installed)).toEqual([true, true]);
    expect(statuses.map((status) => status.version)).toEqual(['codex-cli 1.2.3', 'claude 4.5.0']);
    for (const status of statuses) {
      expect(status.capabilities).toMatchObject({
        canBeInvoked: false,
        supportsMcp: true,
        explainPermissionMode: 'monitored',
        supportsScopeEnforcement: false,
        supportsCancellation: false,
        supportsStreaming: false,
        maySendCodeToCloud: true,
      });
    }
  });

  it('单个 CLI 不存在时保留另一个结果并给出诚实说明', async () => {
    const statuses = await detectAgentAdapters((executable) =>
      executable === 'codex' ? Promise.reject(new Error('ENOENT')) : Promise.resolve('claude 4'),
    );
    expect(statuses[0]?.installed).toBe(false);
    expect(statuses[1]?.installed).toBe(true);
    expect(describeAdapter(statuses[0]!)).toContain('未检测到');
    expect(describeAdapter(statuses[1]!)).toContain('monitored');
    expect(describeAdapter(statuses[1]!)).toContain('可能把代码发送到云端');
  });
});
