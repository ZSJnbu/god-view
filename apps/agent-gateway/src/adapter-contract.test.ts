import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { GodViewEvent, ToolResult } from '@god-view/protocol';
import { agentAdapterProfiles, type AdapterName } from './adapters.js';
import { GatewaySession } from './gateway-session.js';
import { createMcpServer } from './mcp-server.js';
import { resolveWorkspaceRuntime } from './runtime-layout.js';

const workspaces: string[] = [];
const now = '2026-08-12T04:00:00.000Z';

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function connect(adapter: AdapterName): Promise<{ client: Client; root: string }> {
  const root = await mkdtemp(join(tmpdir(), `god-view-${adapter}-`));
  workspaces.push(root);
  const session = new GatewaySession({
    workspaceRoot: root,
    workspaceId: 'ws-contract',
    branchKey: 'main',
    now: () => now,
    adapterId: agentAdapterProfiles[adapter].actorAdapterId,
  });
  const server = createMcpServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: adapter, version: 'test' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, root };
}

async function call(
  client: Client,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const response = await client.callTool({ name, arguments: input });
  const first = (response.content as { type: string; text: string }[])[0];
  const result = JSON.parse(first?.text ?? '{}') as ToolResult;
  expect(response.isError, `${name}: ${first?.text ?? '无返回'}`).toBe(false);
  expect(result.accepted, `${name}: ${first?.text ?? '无返回'}`).not.toBe(false);
  return result;
}

async function publishApprovedMap(root: string): Promise<void> {
  const layout = resolveWorkspaceRuntime(root);
  await mkdir(layout.root, { recursive: true });
  await writeFile(
    layout.mapFile,
    JSON.stringify({
      schemaVersion: '1.3',
      workspaceId: 'ws-contract',
      branchKey: 'main',
      revision: 8,
      lastEventSeq: 8,
      baseGitRevision: 'head-1',
      createdAt: now,
      nodes: [],
      edges: [],
      changeProposals: [
        {
          id: 'proposal.approved',
          annotationId: 'annotation.orders',
          requestId: 'request.orders',
          status: 'approved',
          summary: '修正订单校验',
          plannedFiles: ['src/orders.ts'],
          structuralChanges: ['更新订单模块'],
          risks: ['兼容性'],
          validationPlan: ['运行测试'],
          branchKey: 'main',
          baseMapRevision: 7,
          baseGitRevision: 'head-1',
          createdAt: now,
          approval: {
            token: 'approval-contract',
            approvedScope: ['src/orders.ts'],
            permissionMode: 'monitored',
            approvedAt: now,
            expiresAt: '2026-08-12T04:15:00.000Z',
            branchKey: 'main',
            mapRevision: 7,
            gitRevision: 'head-1',
            preexistingChanges: [],
          },
        },
      ],
      appliedEventIds: [],
    }),
    'utf8',
  );
}

async function inboxEvents(root: string): Promise<GodViewEvent[]> {
  const inbox = resolveWorkspaceRuntime(root).inboxDir;
  const names = (await readdir(inbox)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(
    names.map(
      async (name) => JSON.parse(await readFile(join(inbox, name), 'utf8')) as GodViewEvent,
    ),
  );
}

describe.each(['codex', 'claude-code'] as const)('%s Adapter 完整 MCP 能力契约', (adapter) => {
  it('支持初始化、增量建图、解释、方案、批准后启动与完成，并保留来源身份', async () => {
    const { client, root } = await connect(adapter);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'get_map',
          'begin_change',
          'upsert_node',
          'answer_annotation',
          'request_write_access',
          'propose_change',
          'start_approved_change',
          'request_scope_expansion',
          'complete_change',
        ]),
      );
      await call(client, 'get_map', {});
      await call(client, 'begin_change', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'initialize',
        intent: '初始化项目地图',
      });
      await call(client, 'upsert_node', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'node',
        node: { id: 'orders', type: 'module', label: '订单', paths: ['src/orders.ts'] },
      });
      await call(client, 'answer_annotation', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'answer',
        annotationId: 'annotation.orders',
        summary: '订单模块负责校验。',
      });
      await call(client, 'request_write_access', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'request',
        annotationId: 'annotation.orders',
        reason: '需要修正校验',
        expectedScope: ['src/orders.ts'],
      });
      await call(client, 'propose_change', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'proposal',
        annotationId: 'annotation.orders',
        requestId: 'request.orders',
        summary: '修正订单校验',
        plannedFiles: ['src/orders.ts'],
        structuralChanges: ['更新订单模块'],
        risks: ['兼容性'],
        validationPlan: ['运行测试'],
        baseMapRevision: 7,
        baseGitRevision: 'head-1',
      });
      await publishApprovedMap(root);
      const started = await call(client, 'start_approved_change', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'start',
        proposalId: 'proposal.approved',
        approvalToken: 'approval-contract',
      });
      expect(started.eventId).toBeDefined();
      const expansion = await call(client, 'request_scope_expansion', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'expand-tests',
        changeSetId: `${started.eventId ?? 'missing'}.change`,
        baseMapRevision: 8,
        requestedFiles: ['src/orders.test.ts'],
        reason: '需要补充回归测试',
      });
      expect(expansion.scopeExpansionRequest).toMatchObject({
        requestedFiles: ['src/orders.test.ts'],
        status: 'pending',
      });
      await call(client, 'complete_change', {
        sessionId: `${adapter}.session`,
        idempotencyKey: 'complete',
        changeSetId: `${started.eventId ?? 'missing'}.change`,
        status: 'completed',
        actualFiles: ['src/orders.ts'],
      });

      const events = await inboxEvents(root);
      expect(events.map((event) => event.type)).toEqual([
        'change_start',
        'node_upsert',
        'annotation_answer',
        'write_access_requested',
        'change_proposal',
        'change_start',
        'scope_expansion_requested',
        'change_complete',
      ]);
      expect(events.every((event) => event.actor?.adapterId === adapter)).toBe(true);
    } finally {
      await client.close();
    }
  });
});
