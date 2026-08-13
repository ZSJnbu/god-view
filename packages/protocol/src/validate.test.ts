import { describe, expect, it } from 'vitest';
import { createProtocolValidator, reservedEventTypes } from './validate.js';
import { errorCodes } from './error-codes.js';
import { currentProtocolVersion } from './version.js';
import type { AgentNodeDeclaration } from './generated/protocol-types.js';

const validator = createProtocolValidator();

function envelope(type: string, payload: unknown): Record<string, unknown> {
  return {
    version: currentProtocolVersion,
    workspaceId: 'ws-1',
    branchKey: 'main',
    sessionId: 'session-1',
    eventId: 'event-1',
    timestamp: '2026-08-07T10:00:00.000Z',
    type,
    payload,
  };
}

const minimalNode: AgentNodeDeclaration = {
  id: 'module.orders',
  type: 'module',
  label: '订单模块',
};

const minimalStory = {
  id: 'story.intro',
  type: 'project_intro' as const,
  title: '认识项目',
  steps: [
    { order: 0, focusNodeIds: ['entry'], caption: '从入口开始' },
    { order: 1, focusNodeIds: ['core'], caption: '进入核心模块' },
    { order: 2, focusNodeIds: ['storage'], caption: '最后写入存储' },
  ],
};

const minimalAnnotation = {
  id: 'annotation.orders',
  type: 'explain' as const,
  status: 'sent' as const,
  target: { nodeIds: ['module.orders'], mapRevision: 3 },
  messages: [
    {
      id: 'message.question',
      author: 'user' as const,
      body: '这个模块为什么依赖支付？',
      createdAt: '2026-08-07T10:00:00.000Z',
    },
  ],
  createdAt: '2026-08-07T10:00:00.000Z',
};

function firstErrorCode(result: ReturnType<typeof validator.validateEvent>): string | undefined {
  return result.ok ? undefined : result.error[0]?.code;
}

describe('事件校验', () => {
  it('接受包含全部必填字段的最小节点声明事件', () => {
    const result = validator.validateEvent(envelope('node_upsert', { node: minimalNode }));
    expect(result.ok).toBe(true);
  });

  it('接受携带证据、位置和布局建议的完整节点声明', () => {
    const result = validator.validateEvent(
      envelope('node_upsert', {
        node: {
          ...minimalNode,
          responsibility: '处理下单、改单与取消',
          parentId: 'group.business',
          paths: ['src/orders/index.ts'],
          locations: [{ path: 'src/orders/index.ts', startLine: 1, endLine: 40 }],
          evidence: [{ kind: 'file_exists', location: { path: 'src/orders/index.ts' } }],
          uncertainties: ['是否包含退款流程尚未确认'],
          visualHint: { group: '业务', importance: 'primary', preferredPosition: 'core' },
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['session_start', { adapterId: 'claude-code' }],
    ['change_start', { changeSetId: 'cs-1', intent: '拆分订单与支付' }],
    ['node_remove', { nodeId: 'module.legacy', reason: '目录已删除' }],
    ['edge_upsert', { edge: { id: 'e-1', from: 'a', to: 'b', type: 'depends_on' } }],
    ['edge_remove', { edgeId: 'e-1', reason: '依赖已解除' }],
    ['change_complete', { changeSetId: 'cs-1', status: 'completed' }],
    ['session_end', { status: 'completed' }],
    ['story_upsert', { story: minimalStory }],
    ['annotation_create', { annotation: minimalAnnotation }],
    [
      'annotation_answer',
      {
        annotationId: minimalAnnotation.id,
        message: {
          id: 'message.answer',
          author: 'agent',
          body: '订单在确认阶段需要支付授权。',
          evidence: [{ kind: 'explicit_import', location: { path: 'src/orders.ts' } }],
          createdAt: '2026-08-07T10:01:00.000Z',
        },
      },
    ],
    ['annotation_resolve', { annotationId: minimalAnnotation.id }],
  ])('接受 %s 事件', (type, payload) => {
    expect(validator.validateEvent(envelope(type, payload)).ok).toBe(true);
  });

  it('缺少 type 时返回可定位的字段路径', () => {
    const result = validator.validateEvent({ version: '1.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.path).toBe('/type');
      expect(result.error[0]?.code).toBe(errorCodes.SCHEMA_VIOLATION);
    }
  });

  it('对未知事件类型返回 SCHEMA_VIOLATION 而不是静默忽略', () => {
    const result = validator.validateEvent(envelope('teleport_module', {}));
    expect(firstErrorCode(result)).toBe(errorCodes.SCHEMA_VIOLATION);
  });

  it.each(reservedEventTypes)('对已保留但未实现的 %s 返回 UNSUPPORTED_EVENT_TYPE', (type) => {
    const result = validator.validateEvent(envelope(type, {}));
    expect(firstErrorCode(result)).toBe(errorCodes.UNSUPPORTED_EVENT_TYPE);
  });

  it('拒绝信封上的未知字段，避免 Agent 夹带未定义语义', () => {
    const event = { ...envelope('node_upsert', { node: minimalNode }), internalThoughts: 'secret' };
    expect(validator.validateEvent(event).ok).toBe(false);
  });

  it('拒绝不兼容 major 的事件，而不是只校验版本字符串格式', () => {
    const event = envelope('node_upsert', { node: minimalNode });
    event['version'] = '2.0';
    const result = validator.validateEvent(event);
    expect(firstErrorCode(result)).toBe(errorCodes.UNSUPPORTED_PROTOCOL_VERSION);
    if (!result.ok) {
      expect(result.error[0]?.path).toBe('/version');
    }
  });
});

describe('Agent 不得声明插件拥有的状态', () => {
  it.each(['codeValidation', 'userConfirmation', 'coverage', 'lifecycle', 'source'])(
    '拒绝在节点声明中出现 %s',
    (field) => {
      const result = validator.validateEvent(
        envelope('node_upsert', { node: { ...minimalNode, [field]: { status: 'verified' } } }),
      );
      expect(result.ok).toBe(false);
    },
  );

  it('拒绝在边声明中伪造代码验证状态', () => {
    const result = validator.validateEvent(
      envelope('edge_upsert', {
        edge: {
          id: 'e-1',
          from: 'a',
          to: 'b',
          type: 'depends_on',
          codeValidation: { status: 'verified' },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('路径安全', () => {
  it.each([
    ['../outside/secrets.env', '父目录穿越'],
    ['/etc/passwd', 'POSIX 绝对路径'],
    ['src/../../escape.ts', '中间段穿越'],
    ['\\\\server\\share\\file.ts', 'UNC 路径'],
  ])('拒绝 %s（%s）', (path) => {
    const result = validator.validateEvent(
      envelope('node_upsert', { node: { ...minimalNode, paths: [path] } }),
    );
    expect(result.ok).toBe(false);
  });

  it('接受工作区相对路径', () => {
    const result = validator.validateEvent(
      envelope('node_upsert', { node: { ...minimalNode, paths: ['src/a/b.ts', './c.ts'] } }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('边界值', () => {
  it('拒绝超过 64 字符的一级节点名称', () => {
    const result = validator.validateEvent(
      envelope('node_upsert', { node: { ...minimalNode, label: 'x'.repeat(65) } }),
    );
    expect(result.ok).toBe(false);
  });

  it('接受恰好 64 字符的节点名称', () => {
    const result = validator.validateEvent(
      envelope('node_upsert', { node: { ...minimalNode, label: 'x'.repeat(64) } }),
    );
    expect(result.ok).toBe(true);
  });

  it('拒绝空 label', () => {
    const result = validator.validateEvent(
      envelope('node_upsert', { node: { ...minimalNode, label: '' } }),
    );
    expect(result.ok).toBe(false);
  });

  it('拒绝非 RFC 3339 时间戳', () => {
    const event = envelope('session_end', { status: 'completed' });
    event['timestamp'] = '2026/08/07 10:00';
    expect(validator.validateEvent(event).ok).toBe(false);
  });
});

describe('工具入参校验', () => {
  it('校验扩展返回的领域确认结果及 begin_change 的 changeSetId', () => {
    expect(
      validator.validateToolResult({
        accepted: true,
        mapRevision: 1,
        eventId: 'event-1',
        changeSetId: 'change-1',
        errors: [],
      }).ok,
    ).toBe(true);
    expect(validator.validateToolResult({ accepted: true, mapRevision: -1, errors: [] }).ok).toBe(
      false,
    );
  });

  it('接受合法的 upsert_node 入参', () => {
    const result = validator.validateToolInput('upsert_node', {
      sessionId: 'session-1',
      idempotencyKey: 'key-1',
      node: minimalNode,
    });
    expect(result.ok).toBe(true);
  });

  it('缺少幂等 key 时拒绝写工具调用', () => {
    const result = validator.validateToolInput('upsert_node', {
      sessionId: 'session-1',
      node: minimalNode,
    });
    expect(result.ok).toBe(false);
  });

  it('complete_change 必须携带 changeSetId 与状态', () => {
    expect(
      validator.validateToolInput('complete_change', {
        sessionId: 'session-1',
        idempotencyKey: 'key-2',
        changeSetId: 'cs-1',
        status: 'interrupted',
      }).ok,
    ).toBe(true);
    expect(
      validator.validateToolInput('complete_change', {
        sessionId: 'session-1',
        idempotencyKey: 'key-2',
        status: 'interrupted',
      }).ok,
    ).toBe(false);
  });

  it('get_map 允许空入参', () => {
    expect(validator.validateToolInput('get_map', {}).ok).toBe(true);
  });

  it('upsert_story 只接受声明式步骤并限制步骤数量与文案长度', () => {
    expect(
      validator.validateToolInput('upsert_story', {
        sessionId: 'session-1',
        idempotencyKey: 'story-1',
        story: minimalStory,
      }).ok,
    ).toBe(true);
    expect(
      validator.validateToolInput('upsert_story', {
        sessionId: 'session-1',
        idempotencyKey: 'story-2',
        story: { ...minimalStory, steps: minimalStory.steps.slice(0, 2) },
      }).ok,
    ).toBe(false);
  });

  it('answer_annotation 接受结构化解释并拒绝越界证据路径', () => {
    const valid = {
      sessionId: 'session-1',
      idempotencyKey: 'answer-1',
      annotationId: minimalAnnotation.id,
      summary: '<script>alert(1)</script> 只是普通文本',
      detail: '依赖由显式 import 支持。',
      evidence: [{ kind: 'explicit_import', location: { path: 'src/orders.ts', startLine: 3 } }],
    };
    expect(validator.validateToolInput('answer_annotation', valid).ok).toBe(true);
    expect(
      validator.validateToolInput('answer_annotation', {
        ...valid,
        evidence: [{ kind: 'file_exists', location: { path: '../secret.env' } }],
      }).ok,
    ).toBe(false);
  });

  it('写入请求、修改方案和批准启动使用三个独立工具契约', () => {
    const common = { sessionId: 'session-1', idempotencyKey: 'proposal-1' };
    expect(
      validator.validateToolInput('request_write_access', {
        ...common,
        annotationId: minimalAnnotation.id,
        reason: '需要修正订单流程',
        expectedScope: ['src/orders.ts'],
      }).ok,
    ).toBe(true);
    const proposal = {
      ...common,
      annotationId: minimalAnnotation.id,
      requestId: 'request.orders',
      summary: '修正订单流程',
      plannedFiles: ['src/orders.ts'],
      structuralChanges: ['更新订单模块'],
      risks: ['兼容风险'],
      validationPlan: ['运行测试'],
      baseMapRevision: 3,
      baseGitRevision: 'abc123',
    };
    expect(validator.validateToolInput('propose_change', proposal).ok).toBe(true);
    const { baseMapRevision: _omitted, ...missingBaseline } = proposal;
    expect(validator.validateToolInput('propose_change', missingBaseline).ok).toBe(false);
    expect(
      validator.validateToolInput('propose_change', {
        ...proposal,
        plannedFiles: ['../outside.ts'],
      }).ok,
    ).toBe(false);
    expect(
      validator.validateToolInput('start_approved_change', {
        ...common,
        proposalId: 'proposal.orders',
        approvalToken: 'approval-token',
      }).ok,
    ).toBe(true);
  });

  it('接受完整写入请求、方案、批准和拒绝事件', () => {
    const request = {
      id: 'request.orders',
      annotationId: minimalAnnotation.id,
      status: 'requested',
      reason: '需要修正订单流程',
      expectedScope: ['src/orders.ts'],
      requestedAt: '2026-08-07T10:00:00.000Z',
    };
    expect(validator.validateEvent(envelope('write_access_requested', { request })).ok).toBe(true);
    const proposal = {
      id: 'proposal.orders',
      annotationId: minimalAnnotation.id,
      requestId: request.id,
      status: 'proposed',
      summary: '修正订单流程',
      plannedFiles: ['src/orders.ts'],
      structuralChanges: [],
      risks: [],
      validationPlan: ['运行测试'],
      branchKey: 'main',
      baseMapRevision: 3,
      baseGitRevision: 'abc123',
      createdAt: '2026-08-07T10:00:00.000Z',
    };
    expect(validator.validateEvent(envelope('change_proposal', { proposal })).ok).toBe(true);
    expect(
      validator.validateEvent(
        envelope('change_approved', {
          proposalId: proposal.id,
          approval: {
            token: 'approval-token',
            approvedScope: ['src/orders.ts'],
            permissionMode: 'monitored',
            approvedAt: '2026-08-07T10:00:00.000Z',
            expiresAt: '2026-08-07T10:15:00.000Z',
            branchKey: 'main',
            mapRevision: 3,
            gitRevision: 'abc123',
            preexistingChanges: [],
          },
        }),
      ).ok,
    ).toBe(true);
    expect(
      validator.validateEvent(
        envelope('change_rejected', { proposalId: proposal.id, reason: '风险不可接受' }),
      ).ok,
    ).toBe(true);
  });
});

describe('快照校验', () => {
  const snapshot = {
    schemaVersion: currentProtocolVersion,
    workspaceId: 'ws-1',
    branchKey: 'main',
    revision: 3,
    lastEventSeq: 12,
    createdAt: '2026-08-07T10:00:00.000Z',
    nodes: [],
    edges: [],
    appliedEventIds: [],
  };

  it('接受空地图快照', () => {
    expect(validator.validateSnapshot(snapshot).ok).toBe(true);
  });

  it('拒绝缺少幂等事件清单的快照', () => {
    const { appliedEventIds: _omitted, ...withoutApplied } = snapshot;
    expect(validator.validateSnapshot(withoutApplied).ok).toBe(false);
  });

  it('拒绝负数版本号', () => {
    expect(validator.validateSnapshot({ ...snapshot, revision: -1 }).ok).toBe(false);
  });

  it('拒绝无法迁移的快照 major 版本', () => {
    const result = validator.validateSnapshot({ ...snapshot, schemaVersion: '2.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe(errorCodes.UNSUPPORTED_SNAPSHOT_VERSION);
      expect(result.error[0]?.path).toBe('/schemaVersion');
    }
  });
});

describe('非对象输入', () => {
  it.each([null, undefined, 42, 'event', [], true])('拒绝非对象事件：%s', (input) => {
    const result = validator.validateEvent(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.path).toBe('/type');
    }
  });
});
