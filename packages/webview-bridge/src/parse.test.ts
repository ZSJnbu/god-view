import { describe, expect, it } from 'vitest';
import { errorCodes } from '@god-view/protocol';
import { parseExtensionEvent, parseWebviewCommand } from './parse.js';

describe('Webview 命令解析', () => {
  it.each([['ready'], ['requestSnapshot'], ['generateAgentTask'], ['copyAgentSetup']])(
    '接受无参数命令 %s',
    (type) => {
      const result = parseWebviewCommand({ type });
      expect(result.ok).toBe(true);
    },
  );

  it('接受带行号的 openSource', () => {
    const result = parseWebviewCommand({
      type: 'openSource',
      path: 'src/orders/index.ts',
      startLine: 12,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'openSource') {
      expect(result.value.startLine).toBe(12);
    }
  });

  it('openSource 可以不带行号', () => {
    const result = parseWebviewCommand({ type: 'openSource', path: 'src/a.ts' });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'openSource') {
      expect(result.value.startLine).toBeUndefined();
    }
  });

  it.each([
    [{ type: 'openSource' }, '/path'],
    [{ type: 'openSource', path: '' }, '/path'],
    [{ type: 'openSource', path: 123 }, '/path'],
    [{ type: 'openSource', path: 'a.ts', startLine: 0 }, '/startLine'],
    [{ type: 'openSource', path: 'a.ts', startLine: 'first' }, '/startLine'],
  ])('拒绝非法的 openSource：%j', (input, path) => {
    const result = parseWebviewCommand(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe(path);
    }
  });

  it('接受合法布局并保留坐标', () => {
    const result = parseWebviewCommand({
      type: 'saveLayout',
      positions: { 'module.orders': { x: 10, y: -20.5 } },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'saveLayout') {
      expect(result.value.positions['module.orders']).toEqual({ x: 10, y: -20.5 });
    }
  });

  it('只接受安全范围内的 Agent 输出视窗高度', () => {
    expect(parseWebviewCommand({ type: 'saveAgentPaneHeight', height: 320 })).toEqual({
      ok: true,
      value: { type: 'saveAgentPaneHeight', height: 320 },
    });
    expect(parseWebviewCommand({ type: 'saveAgentPaneHeight', height: 80 }).ok).toBe(false);
    expect(parseWebviewCommand({ type: 'saveAgentPaneHeight', height: Number.NaN }).ok).toBe(false);
  });

  it('接受对话导出与安全的浮窗偏好', () => {
    expect(parseWebviewCommand({ type: 'exportAgentConversation' }).ok).toBe(true);
    expect(
      parseWebviewCommand({
        type: 'saveAgentPaneView',
        view: { mode: 'floating', floatingBounds: { x: 20, y: 30, width: 640, height: 420 } },
      }),
    ).toMatchObject({ ok: true, value: { type: 'saveAgentPaneView' } });
    expect(
      parseWebviewCommand({
        type: 'saveAgentPaneView',
        view: { mode: 'floating', floatingBounds: { x: 0, y: 0, width: 200, height: 100 } },
      }).ok,
    ).toBe(false);
  });

  it('接受受限的标注创建、解决和复制任务命令', () => {
    const create = parseWebviewCommand({
      type: 'createAnnotation',
      annotationType: 'explain',
      body: '为什么依赖支付？',
      nodeIds: ['module.orders'],
      excludedPaths: ['src/legacy.ts'],
    });
    expect(create.ok).toBe(true);
    expect(
      parseWebviewCommand({ type: 'resolveAnnotation', annotationId: 'annotation.orders' }).ok,
    ).toBe(true);
    expect(
      parseWebviewCommand({ type: 'copyAnnotationTask', annotationId: 'annotation.orders' }).ok,
    ).toBe(true);
  });

  it('接受方案批准、拒绝和复制任务命令', () => {
    expect(
      parseWebviewCommand({
        type: 'approveProposal',
        proposalId: 'proposal.orders',
        approvedScope: ['src/orders.ts'],
        autoStartAgent: 'codex',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        type: 'approveProposal',
        proposalId: 'proposal.orders',
        approvedScope: ['src/orders.ts'],
        autoStartAgent: 'codex',
      },
    });
    expect(
      parseWebviewCommand({ type: 'rejectProposal', proposalId: 'proposal.orders' }),
    ).toMatchObject({ ok: true, value: { type: 'rejectProposal' } });
    expect(
      parseWebviewCommand({ type: 'copyApprovedChangeTask', proposalId: 'proposal.orders' }),
    ).toMatchObject({ ok: true, value: { type: 'copyApprovedChangeTask' } });
    expect(
      parseWebviewCommand({
        type: 'startApprovedChange',
        proposalId: 'proposal.orders',
        agent: 'claude-code',
      }),
    ).toMatchObject({ ok: true, value: { type: 'startApprovedChange' } });
  });

  it.each([
    { type: 'approveProposal', approvedScope: ['src/orders.ts'] },
    { type: 'approveProposal', proposalId: '', approvedScope: ['src/orders.ts'] },
    { type: 'approveProposal', proposalId: 'p', approvedScope: [] },
    { type: 'approveProposal', proposalId: 'p', approvedScope: [1] },
    { type: 'rejectProposal' },
  ])('拒绝非法方案命令：%j', (input) => {
    expect(parseWebviewCommand(input).ok).toBe(false);
  });

  it('接受打开 Diff 与两种用户验收命令', () => {
    expect(parseWebviewCommand({ type: 'openDiff', path: 'src/orders.ts' })).toMatchObject({
      ok: true,
      value: { type: 'openDiff', path: 'src/orders.ts' },
    });
    expect(
      parseWebviewCommand({ type: 'interruptChange', changeSetId: 'change.orders' }),
    ).toMatchObject({
      ok: true,
      value: { type: 'interruptChange', changeSetId: 'change.orders' },
    });
    expect(
      parseWebviewCommand({
        type: 'reviewChange',
        changeSetId: 'change.orders',
        status: 'accepted',
      }),
    ).toMatchObject({ ok: true, value: { status: 'accepted' } });
    expect(
      parseWebviewCommand({
        type: 'reviewChange',
        changeSetId: 'change.orders',
        status: 'accepted_with_issues',
        note: '仍有警告',
      }),
    ).toMatchObject({ ok: true, value: { status: 'accepted_with_issues', note: '仍有警告' } });
  });

  it('只接受受支持的显式 Agent 配置命令', () => {
    expect(parseWebviewCommand({ type: 'configureAgent', agent: 'claude-code' })).toEqual({
      ok: true,
      value: { type: 'configureAgent', agent: 'claude-code' },
    });
    expect(parseWebviewCommand({ type: 'configureAgent', agent: 'unknown' }).ok).toBe(false);
  });

  it('接受 Agent 刷新、启动、回答与取消命令', () => {
    expect(parseWebviewCommand({ type: 'refreshAgentStatus' }).ok).toBe(true);
    expect(parseWebviewCommand({ type: 'startInitialization', agent: 'codex' }).ok).toBe(true);
    expect(parseWebviewCommand({ type: 'startReinitialization', agent: 'claude-code' }).ok).toBe(
      true,
    );
    expect(
      parseWebviewCommand({ type: 'startMapCompletion', agent: 'codex', target: 'files' }).ok,
    ).toBe(true);
    expect(
      parseWebviewCommand({
        type: 'startAnnotationAnswer',
        annotationId: 'annotation.orders',
        agent: 'codex',
      }).ok,
    ).toBe(true);
    expect(
      parseWebviewCommand({ type: 'startMapCompletion', agent: 'codex', target: 'unknown' }).ok,
    ).toBe(false);
    expect(
      parseWebviewCommand({ type: 'answerAgentQuestion', runId: 'run-1', answer: 'recommended' })
        .ok,
    ).toBe(true);
    expect(
      parseWebviewCommand({
        type: 'decideScopeExpansion',
        runId: 'run-1',
        requestId: 'scope-1',
        changeSetId: 'change-1',
        decision: 'approved',
      }),
    ).toMatchObject({
      ok: true,
      value: { type: 'decideScopeExpansion', decision: 'approved' },
    });
    expect(
      parseWebviewCommand({
        type: 'decideScopeExpansion',
        runId: 'run-1',
        requestId: 'scope-1',
        changeSetId: 'change-1',
        decision: 'later',
      }).ok,
    ).toBe(false);
    expect(parseWebviewCommand({ type: 'cancelAgentRun', runId: 'run-1' }).ok).toBe(true);
    expect(parseWebviewCommand({ type: 'startInitialization', agent: 'other' }).ok).toBe(false);
    expect(parseWebviewCommand({ type: 'startReinitialization', agent: 'other' }).ok).toBe(false);
    expect(parseWebviewCommand({ type: 'answerAgentQuestion', runId: '', answer: 'x' }).ok).toBe(
      false,
    );
  });

  it('接受常驻项目对话，并区分只读聊天与受控修改请求', () => {
    expect(
      parseWebviewCommand({
        type: 'sendAgentMessage',
        agent: 'codex',
        message: '解释订单数据流',
        mode: 'chat',
      }),
    ).toMatchObject({ ok: true, value: { type: 'sendAgentMessage', mode: 'chat' } });
    expect(
      parseWebviewCommand({
        type: 'sendAgentMessage',
        agent: 'claude-code',
        message: '增加重试',
        mode: 'change',
        nodeIds: ['module.orders'],
      }),
    ).toMatchObject({ ok: true, value: { mode: 'change', nodeIds: ['module.orders'] } });
    expect(
      parseWebviewCommand({
        type: 'sendAgentMessage',
        agent: 'codex',
        message: '',
        mode: 'chat',
      }).ok,
    ).toBe(false);
  });

  it.each([
    { type: 'openDiff' },
    { type: 'openDiff', path: '' },
    { type: 'interruptChange' },
    { type: 'interruptChange', changeSetId: '' },
    { type: 'reviewChange', status: 'accepted' },
    { type: 'reviewChange', changeSetId: '', status: 'accepted' },
    { type: 'reviewChange', changeSetId: 'c', status: 'completed' },
    { type: 'reviewChange', changeSetId: 'c', status: 'accepted', note: 1 },
    { type: 'reviewChange', changeSetId: 'c', status: 'accepted', note: 'x'.repeat(501) },
  ])('拒绝非法 Diff/验收命令：%j', (input) => {
    expect(parseWebviewCommand(input).ok).toBe(false);
  });

  it.each([
    { type: 'createAnnotation', annotationType: 'write', body: 'x', nodeIds: ['a'] },
    { type: 'createAnnotation', annotationType: 'explain', body: '', nodeIds: ['a'] },
    { type: 'createAnnotation', annotationType: 'explain', body: 'x', nodeIds: [] },
    {
      type: 'createAnnotation',
      annotationType: 'explain',
      body: 'x',
      nodeIds: ['a'],
      excludedPaths: [1],
    },
    { type: 'resolveAnnotation' },
    { type: 'copyAnnotationTask', annotationId: '' },
  ])('拒绝非法标注命令：%j', (input) => {
    expect(parseWebviewCommand(input).ok).toBe(false);
  });

  it.each([
    [{ type: 'saveLayout' }],
    [{ type: 'saveLayout', positions: [] }],
    [{ type: 'saveLayout', positions: { a: { x: 1 } } }],
    [{ type: 'saveLayout', positions: { a: { x: Number.NaN, y: 1 } } }],
    [{ type: 'saveLayout', positions: { a: 'somewhere' } }],
  ])('拒绝非法布局：%j', (input) => {
    expect(parseWebviewCommand(input).ok).toBe(false);
  });

  it('拒绝未知命令而不是宽松忽略', () => {
    const result = parseWebviewCommand({ type: 'executeChange' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.SCHEMA_VIOLATION);
      expect(result.error.path).toBe('/type');
    }
  });

  it.each([[null], [undefined], ['ready'], [42], [[]]])('拒绝非对象消息：%s', (input) => {
    expect(parseWebviewCommand(input).ok).toBe(false);
  });
});

describe('扩展事件解析', () => {
  it('接受快照事件', () => {
    const result = parseExtensionEvent({
      type: 'map/snapshot',
      document: { nodes: [], edges: [] },
      capabilities: {
        hasGit: true,
        canExecuteChanges: false,
        reducedMotion: false,
        branchKey: 'main',
      },
      factsRevision: 1,
      drift: [],
    });
    expect(result.ok).toBe(true);
  });

  it('拒绝缺少 document 的快照事件', () => {
    expect(parseExtensionEvent({ type: 'map/snapshot' }).ok).toBe(false);
  });

  it('接受增量补丁', () => {
    const result = parseExtensionEvent({
      type: 'map/patch',
      revision: 3,
      factsRevision: 3,
      patch: { upsertedNodes: [], upsertedEdges: [], removedNodeIds: [], removedEdgeIds: [] },
      drift: [],
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    [{ type: 'map/patch', patch: {} }],
    [{ type: 'map/patch', revision: 1 }],
    // 缺 factsRevision 时无法给事实排序，必须拒绝而不是当成 0。
    [{ type: 'map/patch', revision: 1, patch: {} }],
  ])('拒绝不完整的补丁：%j', (input) => {
    expect(parseExtensionEvent(input).ok).toBe(false);
  });

  it('接受只更新事实的消息', () => {
    const result = parseExtensionEvent({
      type: 'map/facts',
      factsRevision: 4,
      drift: [],
      coverage: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    [{ type: 'map/facts', drift: [] }],
    [{ type: 'map/facts', factsRevision: 1 }],
    [{ type: 'map/facts', factsRevision: 'x', drift: [] }],
  ])('拒绝不完整的事实消息：%j', (input) => {
    expect(parseExtensionEvent(input).ok).toBe(false);
  });

  it('拒绝缺少 factsRevision 的快照', () => {
    expect(parseExtensionEvent({ type: 'map/snapshot', document: {}, drift: [] }).ok).toBe(false);
  });

  it('接受状态与错误事件', () => {
    expect(parseExtensionEvent({ type: 'status', state: 'receiving' }).ok).toBe(true);
    expect(parseExtensionEvent({ type: 'error', code: 'E', message: 'm' }).ok).toBe(true);
  });

  it.each([[{ type: 'status' }], [{ type: 'error', code: 'E' }], [{ type: 'unknown' }], [null]])(
    '拒绝非法事件：%j',
    (input) => {
      expect(parseExtensionEvent(input).ok).toBe(false);
    },
  );
});
