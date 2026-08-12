import { describe, expect, it } from 'vitest';
import { currentProtocolVersion } from '@god-view/protocol';
import { gatewayCapabilities } from './capabilities.js';

/**
 * 能力声明的诚实性测试。
 *
 * UI 直接展示这些字段，因此夸大任何一项都会让用户以为 God View 能做到
 * 它做不到的事（CODING_STANDARDS.md §14）。
 */
describe('gatewayCapabilities', () => {
  it('声明协议版本与 MCP 支持', () => {
    expect(gatewayCapabilities.protocolVersion).toBe(currentProtocolVersion);
    expect(gatewayCapabilities.supportsMcp).toBe(true);
  });

  it('不谎称可被 God View 主动调用', () => {
    // Gateway 是「Agent 调用 God View」的通道，反向调用不存在。
    expect(gatewayCapabilities.canBeInvoked).toBe(false);
  });

  it('权限模式为 monitored，不冒充运行时强制', () => {
    expect(gatewayCapabilities.explainPermissionMode).toBe('monitored');
    expect(gatewayCapabilities.supportsScopeEnforcement).toBe(false);
  });

  it('无法确认宿主数据去向时按可能上云处理', () => {
    expect(gatewayCapabilities.maySendCodeToCloud).toBe(true);
  });

  it('不谎称能取消或流式追踪外部 Agent 任务', () => {
    expect(gatewayCapabilities.supportsCancellation).toBe(false);
    expect(gatewayCapabilities.supportsStreaming).toBe(false);
  });
});
