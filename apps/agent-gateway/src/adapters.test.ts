import { describe, expect, it } from 'vitest';
import { createProtocolValidator, currentProtocolVersion } from '@god-view/protocol';
import { agentAdapterProfiles, resolveAdapterProfile } from './adapters.js';

describe.each(['codex', 'claude-code'] as const)('%s 正式 Adapter 能力契约', (name) => {
  const profile = agentAdapterProfiles[name];

  it('通过协议 Schema，并如实声明 MCP 引导调用与监控权限', () => {
    const validated = createProtocolValidator().validateAdapterCapabilities(profile.capabilities);
    expect(validated.ok).toBe(true);
    expect(profile.capabilities).toMatchObject({
      protocolVersion: currentProtocolVersion,
      canBeInvoked: false,
      supportsMcp: true,
      explainPermissionMode: 'monitored',
      supportsScopeEnforcement: false,
      supportsCancellation: false,
      supportsStreaming: false,
      maySendCodeToCloud: true,
    });
  });

  it('事件身份与 Adapter 一一绑定', () => {
    expect(resolveAdapterProfile(name)).toEqual(profile);
    expect(profile.actorAdapterId).toBe(name);
  });
});

it('未知 Adapter 不会静默降级为通用身份', () => {
  expect(resolveAdapterProfile('unknown')).toBeUndefined();
});
