import { agentAdapterProfiles } from './adapters.js';

/**
 * Gateway 自身的能力声明。
 *
 * UI 只展示 Adapter 真实声明的能力，不通过 Agent 名称推断
 * （CODING_STANDARDS.md §14）。本 Gateway 是「Agent 主动调用 God View」的通道，
 * 因此 God View 无法主动启动 Agent，也无法强制限制其写入范围。
 */
export const gatewayCapabilities = agentAdapterProfiles['generic-mcp'].capabilities;
