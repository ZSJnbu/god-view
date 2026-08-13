#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { currentProtocolVersion, isProtocolVersionSupported } from '@god-view/protocol';
import { GatewaySession } from '../gateway-session.js';
import { runStdioServer } from '../mcp-server.js';
import { resolveWorkspaceRuntime } from '../runtime-layout.js';
import { readSessionDescriptor } from '../session-descriptor.js';
import {
  adapterNames,
  agentAdapterProfiles,
  resolveAdapterProfile,
  type AgentAdapterProfile,
} from '../adapters.js';

/**
 * God View CLI。
 *
 * 两条路径：
 * - `serve`：作为 MCP stdio server 供支持 MCP 的 Agent 调用；
 * - `emit`：兜底路径，把一个 JSON/JSONL 事件文件投递到收件箱，
 *   供无法被插件主动调用的工作流使用（PRD §7.1.2）。
 */

const usage = `用法：
  god-view serve [--workspace <dir>] [--adapter <codex|claude-code|generic-mcp>]
                                               以 MCP stdio server 运行
  god-view emit <file.json|file.jsonl> [--workspace <dir>]
                                               投递事件文件到 God View 收件箱

说明：
  --workspace 默认为当前目录。God View 扩展必须已在该工作区打开过一次，
  以便生成 .godview/session.json；否则无法确定事件归属哪张地图。`;

function readOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseEventLines(contents: string): unknown[] {
  const trimmed = contents.trim();
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return trimmed
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

async function createSession(
  workspaceRoot: string,
  adapter: AgentAdapterProfile,
): Promise<GatewaySession> {
  const layout = resolveWorkspaceRuntime(workspaceRoot);
  const descriptor = await readSessionDescriptor(layout.sessionFile);
  if (descriptor === undefined) {
    fail(
      `找不到 ${layout.sessionFile}。\n请先在 VS Code 中对该工作区执行「God View: Open Project Map」，扩展会写入会话描述。`,
    );
  }
  if (!isProtocolVersionSupported(descriptor.protocolVersion)) {
    fail(
      `工作区会话协议 ${descriptor.protocolVersion} 与 Gateway ${currentProtocolVersion} 不兼容。\n请在 VS Code 中执行「God View: Copy Agent Setup」并重启 MCP 连接。`,
    );
  }
  return new GatewaySession({
    workspaceRoot,
    workspaceId: descriptor.workspaceId,
    branchKey: descriptor.branchKey,
    // eslint-disable-next-line no-restricted-syntax -- CLI 组合根：系统时间进入应用的唯一入口
    now: () => new Date().toISOString(),
    adapterId: adapter.actorAdapterId,
    acknowledgementTimeoutMs: 15_000,
  });
}

async function runEmit(argv: readonly string[], workspaceRoot: string): Promise<void> {
  const file = argv[1];
  if (file === undefined || file.startsWith('--')) {
    fail(usage);
  }
  const session = await createSession(workspaceRoot, agentAdapterProfiles['generic-mcp']);
  const contents = await readFile(resolve(file), 'utf8');
  const events = parseEventLines(contents);

  let accepted = 0;
  for (const event of events) {
    const result = await session.submitRawEvent(event);
    if (result.accepted) {
      accepted += 1;
    } else {
      process.stderr.write(
        `事件被拒绝：${result.errors.map((error) => `${error.code} ${error.message}`).join('; ')}\n`,
      );
    }
  }
  process.stdout.write(`已投递 ${String(accepted)}/${String(events.length)} 条事件\n`);
  if (accepted !== events.length) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const workspaceRoot = resolve(readOption(argv, '--workspace') ?? process.cwd());
  const adapterName = readOption(argv, '--adapter') ?? 'generic-mcp';
  const adapter = resolveAdapterProfile(adapterName);
  if (adapter === undefined) {
    fail(`未知 Adapter：${adapterName}。可选值：${adapterNames.join(', ')}`);
  }

  switch (command) {
    case 'serve':
      await runStdioServer(await createSession(workspaceRoot, adapter));
      return;
    case 'emit':
      await runEmit(argv, workspaceRoot);
      return;
    default:
      process.stdout.write(`${usage}\n`);
      process.exit(command === undefined || command === '--help' ? 0 : 1);
  }
}

await main();
