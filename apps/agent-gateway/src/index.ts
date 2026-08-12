/**
 * `@god-view/agent-gateway` 的公开入口。
 *
 * 回答一个问题：**Agent 如何调用 God View 协议。**
 * Gateway 只做能力发现、调用和协议转换，不包含领域决策。
 */
export { GatewaySession } from './gateway-session.js';
export type { GatewayOptions, GatewayToolName } from './gateway-session.js';

export { gatewayCapabilities } from './capabilities.js';

export { resolveWorkspaceRuntime, runtimeDirectoryName } from './runtime-layout.js';
export type { WorkspaceRuntimeLayout } from './runtime-layout.js';

export { readSessionDescriptor } from './session-descriptor.js';
export type { SessionDescriptor } from './session-descriptor.js';

export { createMcpServer, runStdioServer } from './mcp-server.js';
export * from './adapters.js';
