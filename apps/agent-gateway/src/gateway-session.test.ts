import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorCodes, type GodViewEvent, type GraphSnapshotDocument } from '@god-view/protocol';
import { GatewaySession } from './gateway-session.js';
import { resolveWorkspaceRuntime } from './runtime-layout.js';
import { readSessionDescriptor } from './session-descriptor.js';

const workspaceId = 'ws-test';
const branchKey = 'main';
const now = (): string => '2026-08-07T10:00:00.000Z';

let workspaceRoot: string;
let session: GatewaySession;

function createSession(): GatewaySession {
  return new GatewaySession({
    workspaceRoot,
    workspaceId,
    branchKey,
    now,
    adapterId: 'claude-code',
  });
}

function createConfirmedSession(): GatewaySession {
  return new GatewaySession({
    workspaceRoot,
    workspaceId,
    branchKey,
    now,
    adapterId: 'claude-code',
    acknowledgementTimeoutMs: 2_000,
  });
}

async function readInbox(): Promise<GodViewEvent[]> {
  const layout = resolveWorkspaceRuntime(workspaceRoot);
  let names: string[];
  try {
    names = await readdir(layout.inboxDir);
  } catch {
    return [];
  }
  const files = names.filter((name) => name.endsWith('.json')).sort();
  const events: GodViewEvent[] = [];
  for (const name of files) {
    const contents = await readFile(join(layout.inboxDir, name), 'utf8');
    events.push(JSON.parse(contents) as GodViewEvent);
  }
  return events;
}

async function waitForInbox(): Promise<GodViewEvent[]> {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    const events = await readInbox();
    if (events.length > 0) return events;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return [];
}

async function acknowledge(eventId: string, result: unknown): Promise<void> {
  const directory = resolveWorkspaceRuntime(workspaceRoot).acknowledgementsDir;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${eventId}.json`), JSON.stringify(result), 'utf8');
}

async function publishMap(document: Partial<GraphSnapshotDocument>): Promise<void> {
  const layout = resolveWorkspaceRuntime(workspaceRoot);
  await mkdir(layout.root, { recursive: true });
  await writeFile(
    layout.mapFile,
    JSON.stringify({
      schemaVersion: '1.0',
      workspaceId,
      branchKey,
      revision: 7,
      lastEventSeq: 12,
      createdAt: '2026-08-07T09:00:00.000Z',
      nodes: [],
      edges: [],
      appliedEventIds: [],
      ...document,
    }),
    'utf8',
  );
}

const validNode = { id: 'module.orders', type: 'module' as const, label: '订单' };
const validStory = {
  id: 'story.intro',
  type: 'project_intro' as const,
  title: '认识项目',
  steps: [
    { order: 0, focusNodeIds: ['entry'], caption: '从入口开始' },
    { order: 1, focusNodeIds: ['core'], caption: '进入核心模块' },
    { order: 2, focusNodeIds: ['storage'], caption: '最后写入存储' },
  ],
};

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'god-view-gateway-'));
  session = createSession();
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('工具入参校验', () => {
  it('缺少幂等 key 时拒绝写工具，并返回可修正的错误', async () => {
    const result = await session.upsertNode({ sessionId: 's-1', node: validNode });
    expect(result.accepted).toBe(false);
    expect(result.errors[0]?.code).toBe(errorCodes.SCHEMA_VIOLATION);
    await expect(readInbox()).resolves.toEqual([]);
  });

  it('拒绝 Agent 伪造代码验证状态', async () => {
    const result = await session.upsertNode({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      node: { ...validNode, codeValidation: { status: 'verified' } },
    });
    expect(result.accepted).toBe(false);
  });

  it('拒绝工作区外路径', async () => {
    const result = await session.upsertNode({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      node: { ...validNode, paths: ['../../etc/passwd'] },
    });
    expect(result.accepted).toBe(false);
  });
});

describe('事件投递', () => {
  it('写入完整事件文件，并填充信封字段', async () => {
    const result = await session.upsertNode({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      node: validNode,
    });

    expect(result.accepted).toBe(true);
    const [event] = await readInbox();
    expect(event?.workspaceId).toBe(workspaceId);
    expect(event?.branchKey).toBe(branchKey);
    expect(event?.type).toBe('node_upsert');
    expect(event?.actor).toEqual({ kind: 'agent', adapterId: 'claude-code' });
    expect(event?.timestamp).toBe(now());
  });

  it('相同幂等 key 产生相同事件 ID，使重试不会创建重复节点', async () => {
    await session.upsertNode({ sessionId: 's-1', idempotencyKey: 'k-1', node: validNode });
    await session.upsertNode({ sessionId: 's-1', idempotencyKey: 'k-1', node: validNode });

    const events = await readInbox();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventId).toBe(events[1]?.eventId);
  });

  it('不同幂等 key 产生不同事件 ID', async () => {
    await session.upsertNode({ sessionId: 's-1', idempotencyKey: 'k-1', node: validNode });
    await session.upsertNode({ sessionId: 's-1', idempotencyKey: 'k-2', node: validNode });

    const events = await readInbox();
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
  });

  it('begin_change 在未指定 changeSetId 时使用事件 ID', async () => {
    const result = await session.beginChange({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      intent: '拆分订单与支付',
    });
    expect(result.accepted).toBe(true);
    expect(result.changeSetId).toBe(result.eventId);

    const [event] = await readInbox();
    expect(event?.type).toBe('change_start');
    if (event?.type === 'change_start') {
      expect(event.payload.changeSetId).toBe(event.eventId);
    }
  });

  it('等待扩展确认后返回实际 revision 与 changeSetId', async () => {
    const confirmed = createConfirmedSession();
    const pending = confirmed.beginChange({
      sessionId: 's-ack',
      idempotencyKey: 'begin',
      intent: '建立首版地图',
    });
    const [event] = await waitForInbox();
    expect(event?.type).toBe('change_start');
    await acknowledge(event?.eventId ?? 'missing', {
      accepted: true,
      mapRevision: 1,
      eventId: event?.eventId,
      errors: [],
    });

    await expect(pending).resolves.toMatchObject({
      accepted: true,
      mapRevision: 1,
      eventId: event?.eventId,
      changeSetId: event?.eventId,
    });
  });

  it('扩展领域层拒绝未知 ChangeSet 时不再向 Agent 假报成功', async () => {
    const confirmed = createConfirmedSession();
    const pending = confirmed.upsertNode({
      sessionId: 's-ack',
      idempotencyKey: 'node',
      changeSetId: 'missing-change',
      node: validNode,
    });
    const [event] = await waitForInbox();
    await acknowledge(event?.eventId ?? 'missing', {
      accepted: false,
      mapRevision: 0,
      eventId: event?.eventId,
      errors: [{ code: errorCodes.UNKNOWN_CHANGE_SET, message: '变更不存在或已结束' }],
    });

    await expect(pending).resolves.toMatchObject({
      accepted: false,
      errors: [{ code: errorCodes.UNKNOWN_CHANGE_SET }],
    });
  });

  it('确认模式重试同一事件时不复用旧回执', async () => {
    const confirmed = createConfirmedSession();
    await acknowledge('s-ack.node', {
      accepted: true,
      mapRevision: 99,
      eventId: 's-ack.node',
      errors: [],
    });
    const pending = confirmed.upsertNode({
      sessionId: 's-ack',
      idempotencyKey: 'node',
      node: validNode,
    });
    const [event] = await waitForInbox();
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    await acknowledge(event?.eventId ?? 'missing', {
      accepted: true,
      mapRevision: 1,
      eventId: event?.eventId,
      errors: [],
    });

    await expect(pending).resolves.toMatchObject({ accepted: true, mapRevision: 1 });
  });

  it('remove_node 与 remove_edge 使用同一入参但产生不同事件', async () => {
    await session.removeNode({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      entityId: 'module.legacy',
      reason: '目录已删除',
    });
    await session.removeEdge({
      sessionId: 's-1',
      idempotencyKey: 'k-2',
      entityId: 'e-1',
      reason: '依赖已解除',
    });

    const events = await readInbox();
    expect(events.map((event) => event.type)).toEqual(['node_remove', 'edge_remove']);
  });

  it('complete_change 如实上报中断状态', async () => {
    await session.completeChange({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      changeSetId: 'cs-1',
      status: 'interrupted',
      actualFiles: ['src/orders/index.ts'],
    });

    const [event] = await readInbox();
    expect(event?.type).toBe('change_complete');
    if (event?.type === 'change_complete') {
      expect(event.payload.status).toBe('interrupted');
      expect(event.payload.actualFiles).toEqual(['src/orders/index.ts']);
    }
  });

  it('关系声明被完整投递', async () => {
    const result = await session.upsertEdge({
      sessionId: 's-1',
      idempotencyKey: 'k-1',
      edge: { id: 'e-1', from: 'a', to: 'b', type: 'depends_on', reason: '订单依赖支付' },
    });
    expect(result.accepted).toBe(true);
    const [event] = await readInbox();
    expect(event?.type).toBe('edge_upsert');
  });

  it('讲解以声明式 story_upsert 事件投递', async () => {
    const result = await session.upsertStory({
      sessionId: 's-1',
      idempotencyKey: 'story-1',
      story: validStory,
    });
    expect(result.accepted).toBe(true);
    const [event] = await readInbox();
    expect(event?.type).toBe('story_upsert');
  });

  it('解释答案以 annotation_answer 投递，权威消息字段由 Gateway 生成', async () => {
    const result = await session.answerAnnotation({
      sessionId: 's-1',
      idempotencyKey: 'answer-1',
      annotationId: 'annotation.orders',
      summary: '订单确认需要支付授权。',
      detail: '调用发生在确认阶段。',
      evidence: [{ kind: 'explicit_import', location: { path: 'src/orders.ts', startLine: 3 } }],
    });
    expect(result.accepted).toBe(true);
    const [event] = await readInbox();
    expect(event?.type).toBe('annotation_answer');
    if (event?.type === 'annotation_answer') {
      expect(event.payload.message).toMatchObject({
        id: 's-1.answer-1.message',
        author: 'agent',
        createdAt: now(),
      });
    }
  });

  it('请求和方案只投递领域事件，不会冒充已批准 ChangeSet', async () => {
    await session.requestWriteAccess({
      sessionId: 's-1',
      idempotencyKey: 'request-1',
      annotationId: 'annotation.orders',
      reason: '需要修改订单流程',
      expectedScope: ['src/orders.ts'],
    });
    await session.proposeChange({
      sessionId: 's-1',
      idempotencyKey: 'proposal-1',
      annotationId: 'annotation.orders',
      requestId: 'request-1',
      summary: '修改订单流程',
      plannedFiles: ['src/orders.ts'],
      structuralChanges: [],
      risks: [],
      validationPlan: ['运行测试'],
      baseMapRevision: 7,
      baseGitRevision: 'head-1',
    });
    expect((await readInbox()).map((event) => event.type)).toEqual([
      'write_access_requested',
      'change_proposal',
    ]);
  });

  it('批准前或令牌过期时不能启动授权 ChangeSet', async () => {
    await publishMap({ revision: 7, changeProposals: [] });
    const missing = await session.startApprovedChange({
      sessionId: 's-1',
      idempotencyKey: 'start-1',
      proposalId: 'proposal.orders',
      approvalToken: 'approval-token',
    });
    expect(missing.accepted).toBe(false);
    await publishMap({
      revision: 8,
      baseGitRevision: 'head-1',
      changeProposals: [
        {
          id: 'proposal.orders',
          annotationId: 'annotation.orders',
          requestId: 'request.orders',
          status: 'approved',
          summary: '修改订单流程',
          plannedFiles: ['src/orders.ts'],
          structuralChanges: [],
          risks: [],
          validationPlan: ['运行测试'],
          branchKey,
          baseMapRevision: 7,
          baseGitRevision: 'head-1',
          createdAt: now(),
          approval: {
            token: 'approval-token',
            approvedScope: ['src/orders.ts'],
            permissionMode: 'monitored',
            approvedAt: '2026-08-07T09:40:00.000Z',
            expiresAt: '2026-08-07T09:55:00.000Z',
            branchKey,
            mapRevision: 7,
            gitRevision: 'head-1',
            preexistingChanges: [],
          },
        },
      ],
    });
    const expired = await session.startApprovedChange({
      sessionId: 's-1',
      idempotencyKey: 'start-2',
      proposalId: 'proposal.orders',
      approvalToken: 'approval-token',
    });
    expect(expired.accepted).toBe(false);
    await expect(readInbox()).resolves.toEqual([]);
  });

  it('只有当前基线上的有效令牌才能产生 change_start', async () => {
    await publishMap({
      revision: 8,
      baseGitRevision: 'head-1',
      changeProposals: [
        {
          id: 'proposal.orders',
          annotationId: 'annotation.orders',
          requestId: 'request.orders',
          status: 'approved',
          summary: '修改订单流程',
          plannedFiles: ['src/orders.ts'],
          structuralChanges: [],
          risks: [],
          validationPlan: ['运行测试'],
          branchKey,
          baseMapRevision: 7,
          baseGitRevision: 'head-1',
          createdAt: now(),
          approval: {
            token: 'approval-token',
            approvedScope: ['src/orders.ts'],
            permissionMode: 'monitored',
            approvedAt: now(),
            expiresAt: '2026-08-07T10:15:00.000Z',
            branchKey,
            mapRevision: 7,
            gitRevision: 'head-1',
            preexistingChanges: [],
          },
        },
      ],
    });
    const result = await session.startApprovedChange({
      sessionId: 's-1',
      idempotencyKey: 'start-valid',
      proposalId: 'proposal.orders',
      approvalToken: 'approval-token',
    });
    expect(result.accepted).toBe(true);
    const [started] = await readInbox();
    expect(started?.type).toBe('change_start');
    if (started?.type === 'change_start') {
      expect(started.baseMapRevision).toBe(7);
      expect(started.payload.plannedFiles).toEqual(['src/orders.ts']);
    }
  });
});

describe('读取地图', () => {
  it('尚未发布读模型时返回空地图而不是报错', async () => {
    const result = await session.getMap({});
    expect(result).toMatchObject({ mapRevision: 0, branchKey, nodes: [], edges: [] });
  });

  it('返回扩展发布的地图版本，使 Agent 能判断基线是否过期', async () => {
    await publishMap({ revision: 7 });
    const result = await session.getMap({});
    expect(result).toMatchObject({ mapRevision: 7 });
  });

  it('读取地图时返回可继续更新的讲解', async () => {
    await publishMap({ stories: [validStory] });
    const result = await session.getMap({});
    expect(result).toMatchObject({ stories: [{ id: 'story.intro' }] });
  });

  it('读取地图时返回待回答与历史标注', async () => {
    await publishMap({
      annotations: [
        {
          id: 'annotation.orders',
          type: 'explain',
          status: 'sent',
          target: { nodeIds: ['orders'], mapRevision: 7 },
          messages: [{ id: 'message.q', author: 'user', body: '为什么？', createdAt: now() }],
          createdAt: now(),
        },
      ],
    });
    const result = await session.getMap({});
    expect(result).toMatchObject({ annotations: [{ id: 'annotation.orders', status: 'sent' }] });
  });

  it('读取地图时返回写入请求和修改方案，避免 Agent 猜测关联 ID', async () => {
    await publishMap({
      writeAccessRequests: [
        {
          id: 'request.orders',
          annotationId: 'annotation.orders',
          status: 'requested',
          reason: '需要修改',
          expectedScope: ['src/orders.ts'],
          requestedAt: now(),
        },
      ],
      changeProposals: [],
    });
    const result = await session.getMap({});
    expect(result).toMatchObject({ writeAccessRequests: [{ id: 'request.orders' }] });
  });

  it('读取地图时返回活动 ChangeSet，使 Agent 能解释占用并请求中断确认', async () => {
    await publishMap({
      activeChanges: [
        {
          changeSetId: 'change.active',
          sessionId: 'session.old',
          intent: '旧的首次建图任务',
          startedAt: now(),
          plannedFiles: [],
          touchedNodeIds: [],
          touchedEdgeIds: [],
        },
      ],
    });

    const result = await session.getMap({});

    expect(result).toMatchObject({
      activeChanges: [{ changeSetId: 'change.active', sessionId: 'session.old' }],
    });
  });

  it('损坏的读模型退化为空地图，不抛出异常', async () => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await mkdir(layout.root, { recursive: true });
    await writeFile(layout.mapFile, '{"half', 'utf8');

    const result = await session.getMap({});
    expect(result).toMatchObject({ mapRevision: 0 });
  });

  it('非法入参返回 ToolResult 而不是地图', async () => {
    const result = await session.getMap({ unknownField: true });
    expect(result).toMatchObject({ accepted: false });
  });

  it('按 nodeIds 过滤返回的节点', async () => {
    await publishMap({
      nodes: [
        {
          id: 'a',
          type: 'module',
          label: 'A',
          source: {
            kind: 'agent_declared',
            actor: { kind: 'agent' },
            declaredAt: '2026-08-07T09:00:00.000Z',
          },
          codeValidation: { status: 'unverified' },
          userConfirmation: { status: 'unconfirmed' },
          lifecycle: { status: 'active' },
          updatedAt: '2026-08-07T09:00:00.000Z',
          revision: 1,
        },
      ],
    });

    const all = await session.getMap({});
    expect(all).toMatchObject({ nodes: [{ id: 'a' }] });

    const filtered = await session.getMap({ nodeIds: ['missing'] });
    expect(filtered).toMatchObject({ nodes: [] });
  });
});

describe('兜底事件文件', () => {
  it('接受合法的原始事件', async () => {
    const result = await session.submitRawEvent({
      version: '1.0',
      workspaceId,
      branchKey,
      sessionId: 's-1',
      eventId: 'e-1',
      timestamp: now(),
      type: 'node_upsert',
      payload: { node: validNode },
    });
    expect(result.accepted).toBe(true);
    const [event] = await readInbox();
    expect(event?.actor).toEqual({ kind: 'agent', adapterId: 'claude-code' });
  });

  it('拒绝属于其它工作区的事件，不静默改写归属', async () => {
    const result = await session.submitRawEvent({
      version: '1.0',
      workspaceId: 'other-ws',
      branchKey,
      sessionId: 's-1',
      eventId: 'e-1',
      timestamp: now(),
      type: 'node_upsert',
      payload: { node: validNode },
    });
    expect(result.accepted).toBe(false);
    expect(result.errors[0]?.code).toBe(errorCodes.WORKSPACE_MISMATCH);
    await expect(readInbox()).resolves.toEqual([]);
  });

  it('拒绝不符合协议的事件', async () => {
    const result = await session.submitRawEvent({ type: 'node_upsert' });
    expect(result.accepted).toBe(false);
  });

  it.each([
    ['user', 'change_reviewed'],
    ['system', 'change_observed'],
  ])('拒绝事件文件冒充 %s 权威身份', async (kind, type) => {
    const result = await session.submitRawEvent({
      version: '1.3',
      workspaceId,
      branchKey,
      sessionId: 'forged',
      eventId: `forged-${kind}`,
      timestamp: now(),
      actor: { kind },
      type,
      payload:
        type === 'change_reviewed'
          ? { changeSetId: 'change', status: 'accepted' }
          : {
              changeSetId: 'change',
              executionStatus: 'in_progress',
              diff: {
                files: [],
                additions: 0,
                deletions: 0,
                computedAt: now(),
                contentHash: 'a'.repeat(64),
              },
            },
    });
    expect(result.accepted).toBe(false);
    expect(result.errors[0]?.code).toBe(errorCodes.UNSUPPORTED);
    await expect(readInbox()).resolves.toEqual([]);
  });
});

describe('会话描述', () => {
  it('缺少 session.json 时返回 undefined，由调用方给出可操作提示', async () => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await expect(readSessionDescriptor(layout.sessionFile)).resolves.toBeUndefined();
  });

  it('读取扩展写入的会话描述', async () => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await mkdir(layout.root, { recursive: true });
    await writeFile(
      layout.sessionFile,
      JSON.stringify({ workspaceId, branchKey, protocolVersion: '1.0' }),
      'utf8',
    );

    await expect(readSessionDescriptor(layout.sessionFile)).resolves.toEqual({
      workspaceId,
      branchKey,
      protocolVersion: '1.0',
    });
  });

  it.each(['{"half', '{"workspaceId":1}', 'null'])('拒绝损坏的会话描述：%s', async (contents) => {
    const layout = resolveWorkspaceRuntime(workspaceRoot);
    await mkdir(layout.root, { recursive: true });
    await writeFile(layout.sessionFile, contents, 'utf8');

    await expect(readSessionDescriptor(layout.sessionFile)).resolves.toBeUndefined();
  });
});
