import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ToolResult } from '@god-view/protocol';
import { GatewaySession } from './gateway-session.js';
import { createMcpServer } from './mcp-server.js';

/**
 * MCP 协议表面的契约测试。
 *
 * 走真实的 Client ↔ Server 往返（内存传输），因此覆盖工具清单、入参 Schema
 * 暴露方式与错误映射，而不是只测内部函数。
 */

let workspaceRoot: string;
let client: Client;

const now = (): string => '2026-08-07T10:00:00.000Z';

async function connect(): Promise<Client> {
  const session = new GatewaySession({
    workspaceRoot,
    workspaceId: 'ws-test',
    branchKey: 'main',
    now,
    adapterId: 'claude-code',
  });
  const server = createMcpServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: 'test-agent', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), connected.connect(clientTransport)]);
  return connected;
}

/** 工具返回值是 JSON 文本，Agent 需要能直接解析出 accepted/errors。 */
function parseResult(content: unknown): ToolResult {
  const first = (content as { type: string; text: string }[])[0];
  expect(first?.type).toBe('text');
  return JSON.parse(first?.text ?? '{}') as ToolResult;
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'god-view-mcp-'));
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('工具清单', () => {
  it('公开全部十二个地图、解释与审批工具', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'answer_annotation',
      'begin_change',
      'complete_change',
      'get_map',
      'propose_change',
      'remove_edge',
      'remove_node',
      'request_write_access',
      'start_approved_change',
      'upsert_edge',
      'upsert_node',
      'upsert_story',
    ]);
  });

  it('入参 Schema 来自协议真源，而不是手写副本', async () => {
    const { tools } = await client.listTools();
    const upsertNode = tools.find((tool) => tool.name === 'upsert_node');

    // 写工具的入参由 SessionScopedInput 与各自载荷组合而成，因此属性在 allOf 分支里。
    expect(upsertNode?.inputSchema.type).toBe('object');
    const branches = (upsertNode?.inputSchema['allOf'] ?? []) as {
      properties?: Record<string, unknown>;
    }[];
    const properties = branches.flatMap((branch) => Object.keys(branch.properties ?? {}));
    expect(properties).toContain('sessionId');
    expect(properties).toContain('idempotencyKey');
    expect(properties).toContain('node');
  });

  it('每个工具都有描述，说明它是否写地图', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.description ?? '').not.toBe('');
    }
  });
});

describe('工具调用', () => {
  it('get_map 在地图尚未发布时返回空图而不是报错', async () => {
    const response = await client.callTool({ name: 'get_map', arguments: {} });
    const result = parseResult(response.content);

    expect(response.isError).toBe(false);
    expect(result).toMatchObject({ nodes: [], edges: [] });
  });

  it('未知工具返回错误而不是静默成功', async () => {
    const response = await client.callTool({ name: 'not_a_tool', arguments: {} });

    expect(response.isError).toBe(true);
    expect((response.content as { text: string }[])[0]?.text).toContain('not_a_tool');
  });

  it('入参不合法时返回 accepted=false 并标记为错误', async () => {
    const response = await client.callTool({
      name: 'begin_change',
      arguments: { sessionId: 'session-1' },
    });
    const result = parseResult(response.content);

    // 校验失败必须以错误呈现，否则 Agent 会把拒绝当成成功继续声明。
    expect(response.isError).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('合法的 begin_change 被接受', async () => {
    const response = await client.callTool({
      name: 'begin_change',
      arguments: {
        sessionId: 'session-1',
        idempotencyKey: 'key-1',
        changeSetId: 'cs-1',
        intent: '初始化项目地图',
      },
    });
    const result = parseResult(response.content);

    expect(response.isError).toBe(false);
    expect(result.accepted).toBe(true);
  });

  it('answer_annotation 暴露结构化解释入口且不要求 ChangeSet', async () => {
    const response = await client.callTool({
      name: 'answer_annotation',
      arguments: {
        sessionId: 'session-1',
        idempotencyKey: 'answer-1',
        annotationId: 'annotation.orders',
        summary: '订单通过支付授权确认资金状态。',
      },
    });
    const result = parseResult(response.content);
    expect(response.isError).toBe(false);
    expect(result.accepted).toBe(true);
  });
});
