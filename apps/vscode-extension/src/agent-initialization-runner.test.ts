import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunView } from '@god-view/webview-bridge';
import { AgentInitializationRunner, type AgentRunPurpose } from './agent-initialization-runner.js';

function fakeProcess(): {
  readonly child: ReturnType<typeof spawn>;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  close(code: number): void;
} {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    kill: vi.fn(() => true),
  }) as unknown as ReturnType<typeof spawn>;
  return { child, stdout, stderr, close: (code) => emitter.emit('close', code) };
}

describe('AgentInitializationRunner', () => {
  it('重新初始化使用独立任务与运行目的', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const task = vi.fn((purpose: AgentRunPurpose) => `任务：${purpose}`);
    const spawnProcess = vi.fn(() => process.child);
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: spawnProcess as unknown as typeof spawn,
    });

    await expect(runner.start('codex', 'reinitialization')).resolves.toBe('started');
    expect(task).toHaveBeenCalledWith('reinitialization');
    const spawnCall = spawnProcess.mock.calls[0] as unknown as [string, string[]];
    expect(spawnCall[1].some((argument) => argument.includes('任务：reinitialization'))).toBe(true);
    expect(updates.at(-1)).toMatchObject({ purpose: 'reinitialization', state: 'running' });
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","mapRevision":30,"nodes":8,"unclassified":0}' })}\n`,
    );
    process.close(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(updates.at(-1)).toMatchObject({
      purpose: 'reinitialization',
      state: 'completed',
      restartRequired: false,
      detail: '重新初始化已完成并通过最终复核；地图已刷新。',
    });
  });

  it('文件关系补全使用独立运行目的且完成后不要求重启 Agent', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: (purpose) => `任务：${purpose}`,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await expect(runner.start('codex', 'file_completion')).resolves.toBe('started');
    expect(updates.at(-1)).toMatchObject({
      purpose: 'file_completion',
      detail: 'Agent 已启动，正在分析项目…',
    });
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","mapRevision":30,"nodes":14,"unclassified":0}' })}\n`,
    );
    process.close(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(updates.at(-1)).toMatchObject({
      purpose: 'file_completion',
      state: 'completed',
      restartRequired: false,
      detail: '关键文件关系补全已完成并通过最终复核；地图已刷新。',
    });
  });

  it('批准后编辑使用可写沙箱并以权威 ChangeSet 完成为准', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const spawnProcess = vi.fn(() => process.child);
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '地图任务',
      approvedChangeTask: (id) => `执行批准方案 ${id}`,
      approvedChangeCompleted: () => true,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: spawnProcess as unknown as typeof spawn,
    });

    await expect(runner.start('codex', 'approved_change', 'proposal.orders')).resolves.toBe(
      'started',
    );
    const spawnCall = spawnProcess.mock.calls[0] as unknown as [string, string[]];
    expect(spawnCall[1]).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']));
    expect(updates.at(-1)).toMatchObject({
      purpose: 'approved_change',
      proposalId: 'proposal.orders',
      state: 'running',
    });
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","proposalId":"proposal.orders"}' })}\n`,
    );
    process.close(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(updates.at(-1)).toMatchObject({
      purpose: 'approved_change',
      state: 'completed',
      restartRequired: false,
    });
  });

  it('从扩围工具权威返回生成审批卡片，批准后恢复同一个 Codex 会话', async () => {
    const first = fakeProcess();
    const resumed = fakeProcess();
    const updates: AgentRunView[] = [];
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(first.child)
      .mockReturnValueOnce(resumed.child);
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '地图任务',
      approvedChangeTask: () => '执行批准方案',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess,
    });

    await runner.start('codex', 'approved_change', 'proposal.orders');
    first.stdout.write(
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-approved' })}\n`,
    );
    first.stdout.write(
      `${JSON.stringify({
        type: 'item.completed',
        text: JSON.stringify({
          accepted: true,
          mapRevision: 12,
          errors: [],
          scopeExpansionRequest: {
            id: 'scope.orders-tests',
            changeSetId: 'change.orders',
            sessionId: 'agent.session',
            requestedFiles: ['src/orders.test.ts'],
            reason: '需要补充回归测试',
            status: 'pending',
            requestedAt: '2026-08-14T01:00:00.000Z',
          },
        }),
      })}\n`,
    );
    first.close(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(updates.at(-1)).toMatchObject({
      state: 'awaiting_input',
      question: {
        scopeExpansion: {
          requestId: 'scope.orders-tests',
          changeSetId: 'change.orders',
          requestedFiles: ['src/orders.test.ts'],
          reason: '需要补充回归测试',
        },
      },
    });
    const runId = updates.at(-1)?.runId ?? '';
    expect(runner.answer(runId, 'approved')).toBe(false);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(runner.answerScopeExpansion(runId, 'scope.orders-tests', 'approved')).toBe(true);
    const resumeCall = spawnProcess.mock.calls[1] as unknown as [string, string[]];
    expect(resumeCall[1]).toEqual(
      expect.arrayContaining(['exec', 'resume', '--json', 'thread-approved']),
    );
    expect(resumeCall[1].at(-1)).toContain('src/orders.test.ts');
    expect(updates.at(-1)).toMatchObject({ state: 'running', detail: 'Agent 已恢复，继续执行…' });
    runner.dispose();
  });

  it('标注解释使用持久标注任务并在进度中绑定 annotationId', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '地图任务',
      annotationTask: (id) => `解释 ${id} 并调用 answer_annotation`,
      annotationAnswered: () => true,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await expect(runner.start('codex', 'annotation_answer', 'annotation.orders')).resolves.toBe(
      'started',
    );
    expect(updates.at(-1)).toMatchObject({
      purpose: 'annotation_answer',
      annotationId: 'annotation.orders',
      state: 'running',
    });
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: '正在调用 answer_annotation' })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: '正在调用 answer_annotation' })}\n`,
    );
    expect(updates.at(-1)?.output).toEqual(['正在调用 answer_annotation']);
    runner.dispose();
  });

  it('标注写入稍后进入权威地图时保持等待并最终完成', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    let answered = false;
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '地图任务',
      annotationTask: () => '回答标注',
      annotationAnswered: () => answered,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
      verificationRetryMs: 1,
      verificationAttempts: 5,
    });

    await runner.start('codex', 'annotation_answer', 'annotation.orders');
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","annotationId":"annotation.orders"}' })}\n`,
    );
    process.close(0);
    expect(updates.at(-1)).toMatchObject({
      state: 'running',
      detail: 'Agent 已完成写入，正在等待权威地图同步…',
    });
    answered = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    expect(updates.at(-1)).toMatchObject({ state: 'completed' });
  });

  it('标注写入在等待上限后仍未进入权威地图时明确失败', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '地图任务',
      annotationTask: () => '回答标注',
      annotationAnswered: () => false,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
      verificationRetryMs: 1,
      verificationAttempts: 2,
    });

    await runner.start('codex', 'annotation_answer', 'annotation.orders');
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","annotationId":"annotation.orders"}' })}\n`,
    );
    process.close(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    expect(updates.at(-1)).toMatchObject({ state: 'failed' });
    expect(updates.at(-1)?.output).toContain(
      'Agent 报告完成，但等待权威地图同步后仍未找到该标注的回写答案。',
    );
  });

  it('批准后编辑等待权威 Diff 和地图更新收敛', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    let completed = false;
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '地图任务',
      approvedChangeTask: () => '执行批准方案',
      approvedChangeCompleted: () => completed,
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
      verificationRetryMs: 1,
      verificationAttempts: 5,
    });

    await runner.start('codex', 'approved_change', 'proposal.orders');
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","proposalId":"proposal.orders"}' })}\n`,
    );
    process.close(0);
    expect(updates.at(-1)?.detail).toContain('等待权威地图同步');
    completed = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    expect(updates.at(-1)).toMatchObject({ state: 'completed', purpose: 'approved_change' });
  });

  it('把大型地图 JSON 折叠为人类可读进度并保留原始导出数据', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });
    const mapPayload = JSON.stringify({
      mapRevision: 40,
      nodes: [{ id: 'one' }, { id: 'two' }],
      edges: [{ id: 'edge' }],
      coverage: { unclassified: 0, unclassifiedPaths: ['不应出现在界面中的超长路径'] },
    });

    await runner.start('codex');
    process.stdout.write(`${JSON.stringify({ type: 'item.completed', text: mapPayload })}\n`);
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","mapRevision":40,"nodes":2,"unclassified":0}' })}\n`,
    );
    process.close(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(updates.at(-1)?.output).toContain(
      '已读取权威地图：r40 · 2 个节点 · 1 条关系 · 0 个未分类文件。',
    );
    expect(updates.at(-1)?.output.join('\n')).not.toContain('不应出现在界面中的超长路径');
    expect(runner.lastRawOutput.join('\n')).toContain('不应出现在界面中的超长路径');
  });

  it('只有结构化最终 get_map 复核标记才能完成', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await expect(runner.start('codex')).resolves.toBe('started');
    process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n`);
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","mapRevision":4,"nodes":6,"unclassified":0}' })}\n`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    process.close(0);

    expect(updates.at(-1)).toMatchObject({ state: 'completed', restartRequired: true });
    expect(updates.at(-1)?.output).not.toContain(expect.stringContaining('GOD_VIEW_'));
  });

  it('CLI 退出成功但未复核时显示失败，并拒绝并发运行', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await expect(runner.start('claude-code')).resolves.toBe('started');
    await expect(runner.start('codex')).resolves.toBe('active');
    process.close(0);

    expect(updates.at(-1)).toMatchObject({ state: 'failed', restartRequired: false });
    expect(updates.at(-1)?.detail).toContain('没有通过最终 get_map 复核');
  });

  it('Codex 使用只读沙箱启动，不传入已废弃的 approval 参数', async () => {
    const process = fakeProcess();
    const spawnProcess = vi.fn(() => process.child);
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: vi.fn(),
      spawnProcess: spawnProcess as unknown as typeof spawn,
    });

    await runner.start('codex');

    expect(spawnProcess).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--json', '--sandbox', 'read-only', '--cd', '/repo']),
      expect.objectContaining({ cwd: '/repo' }),
    );
    const call = spawnProcess.mock.calls[0] as unknown as [string, string[]];
    expect(call[1]).not.toContain('--ask-for-approval');
    runner.dispose();
  });

  it('Claude 只开放读取与 God View MCP，并显式禁用源码写入工具', async () => {
    const process = fakeProcess();
    const spawnProcess = vi.fn(() => process.child);
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: vi.fn(),
      spawnProcess: spawnProcess as unknown as typeof spawn,
    });

    await runner.start('claude-code');

    expect(spawnProcess).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        'Read,Glob,Grep,mcp__god-view__*',
        '--disallowedTools',
        'Bash,Edit,Write,NotebookEdit',
      ]),
      expect.objectContaining({ cwd: '/repo' }),
    );
    runner.dispose();
  });

  it('拒绝缺少最终地图数字的伪完成标记', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await runner.start('codex');
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed"}' })}\n`,
    );
    process.close(0);

    expect(updates.at(-1)).toMatchObject({ state: 'failed', restartRequired: false });
    expect(updates.at(-1)?.output).toContain(
      'Agent 返回的最终复核结果缺少合法的 revision、节点数或覆盖数字。',
    );
  });

  it('业务失败直接显示 Agent 的最终原因，不误导用户检查登录', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await runner.start('codex');
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"failed","message":"已有进行中的变更 change.old"}' })}\n`,
    );
    process.close(0);

    expect(updates.at(-1)).toMatchObject({
      state: 'failed',
      detail: '已有进行中的变更 change.old',
    });
    expect(updates.at(-1)?.detail).not.toContain('登录');
  });

  it('停止后忽略子进程迟到的 error 事件', async () => {
    const process = fakeProcess();
    const updates: AgentRunView[] = [];
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(true),
      onUpdate: (run) => updates.push(run),
      spawnProcess: vi.fn(() => process.child) as unknown as typeof spawn,
    });

    await runner.start('codex');
    const runId = updates.at(-1)?.runId ?? '';
    expect(runner.cancel(runId)).toBe(true);
    process.child.emit('error', new Error('late error'));

    expect(updates.at(-1)).toMatchObject({ state: 'cancelled', restartRequired: false });
  });

  it('未通过配置复验时不启动进程', async () => {
    const spawnProcess = vi.fn();
    const runner = new AgentInitializationRunner({
      workspaceRoot: '/repo',
      task: () => '建立地图',
      authorize: () => Promise.resolve(false),
      onUpdate: vi.fn(),
      spawnProcess,
    });

    await expect(runner.start('codex')).resolves.toBe('not_ready');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('模型满载且尚未调用工具时，用全新 Codex 会话安全重试一次', async () => {
    vi.useFakeTimers();
    try {
      const first = fakeProcess();
      const second = fakeProcess();
      const updates: AgentRunView[] = [];
      const spawnProcess = vi
        .fn()
        .mockReturnValueOnce(first.child)
        .mockReturnValueOnce(second.child);
      const runner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: (run) => updates.push(run),
        spawnProcess,
      });

      await runner.start('codex');
      first.stderr.write('Selected model is at capacity. Please try a different model.\n');
      first.close(1);

      expect(updates.at(-1)).toMatchObject({
        state: 'starting',
        detail: '模型暂时满载，正在安全重试（仅一次）…',
      });
      await vi.advanceTimersByTimeAsync(250);
      expect(spawnProcess).toHaveBeenCalledTimes(2);
      const secondArgs = spawnProcess.mock.calls[1]?.[1] as string[];
      expect(secondArgs).not.toContain('resume');

      second.stdout.write(
        `${JSON.stringify({ type: 'item.completed', text: 'GOD_VIEW_INITIALIZATION_RESULT:{"status":"completed","mapRevision":5,"nodes":9,"unclassified":0}' })}\n`,
      );
      second.close(0);
      expect(updates.at(-1)).toMatchObject({ state: 'completed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('工具活动之后即使模型满载也不重试，避免遗留并发 ChangeSet', async () => {
    vi.useFakeTimers();
    try {
      const process = fakeProcess();
      const updates: AgentRunView[] = [];
      const spawnProcess = vi.fn(() => process.child);
      const runner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: (run) => updates.push(run),
        spawnProcess: spawnProcess as unknown as typeof spawn,
      });

      await runner.start('codex');
      process.stdout.write(
        `${JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', name: 'god-view.begin_change' } })}\n`,
      );
      process.stderr.write('Selected model is at capacity. Please try a different model.\n');
      process.close(1);
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(updates.at(-1)).toMatchObject({ state: 'failed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('结构化输出之后不因容量提示重试', async () => {
    vi.useFakeTimers();
    try {
      const process = fakeProcess();
      const spawnProcess = vi.fn(() => process.child);
      const runner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: vi.fn(),
        spawnProcess: spawnProcess as unknown as typeof spawn,
      });

      await runner.start('codex');
      process.stdout.write(
        'GOD_VIEW_USER_QUESTION:{"question":"选择范围","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}\n',
      );
      process.stderr.write('Selected model is at capacity. Please try a different model.\n');
      process.close(1);
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('容量重试最多一次，认证错误和普通业务错误不会触发重试', async () => {
    vi.useFakeTimers();
    try {
      const first = fakeProcess();
      const second = fakeProcess();
      const spawnProcess = vi
        .fn()
        .mockReturnValueOnce(first.child)
        .mockReturnValueOnce(second.child);
      const runner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: vi.fn(),
        spawnProcess,
      });

      await runner.start('codex');
      first.stderr.write('Selected model is at capacity.\n');
      first.close(1);
      await vi.advanceTimersByTimeAsync(250);
      second.stderr.write('Selected model is at capacity.\n');
      second.close(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(spawnProcess).toHaveBeenCalledTimes(2);

      const authProcess = fakeProcess();
      const authSpawn = vi.fn(() => authProcess.child);
      const authRunner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: vi.fn(),
        spawnProcess: authSpawn as unknown as typeof spawn,
      });
      await authRunner.start('codex');
      authProcess.stderr.write('Authentication failed. Please log in.\n');
      authProcess.close(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(authSpawn).toHaveBeenCalledTimes(1);

      const mixedProcess = fakeProcess();
      const mixedSpawn = vi.fn(() => mixedProcess.child);
      const mixedRunner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: vi.fn(),
        spawnProcess: mixedSpawn as unknown as typeof spawn,
      });
      await mixedRunner.start('codex');
      mixedProcess.stderr.write(
        'Selected model is at capacity, and authentication failed. Please log in.\n',
      );
      mixedProcess.close(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(mixedSpawn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('用户在容量回退期间停止任务时取消待执行的新会话', async () => {
    vi.useFakeTimers();
    try {
      const process = fakeProcess();
      const updates: AgentRunView[] = [];
      const spawnProcess = vi.fn(() => process.child);
      const runner = new AgentInitializationRunner({
        workspaceRoot: '/repo',
        task: () => '建立地图',
        authorize: () => Promise.resolve(true),
        onUpdate: (run) => updates.push(run),
        spawnProcess: spawnProcess as unknown as typeof spawn,
      });

      await runner.start('codex');
      process.stderr.write('Selected model is at capacity.\n');
      process.close(1);
      const runId = updates.at(-1)?.runId ?? '';
      expect(runner.cancel(runId)).toBe(true);
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(updates.at(-1)).toMatchObject({ state: 'cancelled' });
    } finally {
      vi.useRealTimers();
    }
  });
});
