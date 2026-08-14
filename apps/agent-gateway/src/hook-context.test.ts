import { describe, expect, it } from 'vitest';
import { buildHookOutput } from './hook-context.js';

describe('buildHookOutput', () => {
  it('为 UserPromptSubmit 注入轻量地图摘要和原生权限边界', () => {
    const output = buildHookOutput(
      { hook_event_name: 'UserPromptSubmit' },
      {
        revision: 12,
        branchKey: 'feature/native-agent',
        nodes: [{ id: 'node.a' }, { id: 'node.b' }],
        edges: [{ id: 'edge.a-b' }],
        activeChanges: [{ changeSetId: 'change.active' }],
        changeProposals: [{ id: 'proposal.ready' }],
      },
    );

    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    });
    const context = (output['hookSpecificOutput'] as { additionalContext: string })
      .additionalContext;
    expect(context).toContain('当前地图：r12 · 分支 feature/native-agent · 2 个节点 · 1 条关系。');
    expect(context).toContain('进行中的 ChangeSet：change.active');
    expect(context).toContain('待处理方案：proposal.ready');
    expect(context).toContain('God View 不替代原生权限审批');
  });

  it('忽略不支持注入上下文的 hook 事件', () => {
    expect(buildHookOutput({ hook_event_name: 'PostToolUse' }, {})).toEqual({});
  });
});
