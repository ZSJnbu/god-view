import { describe, expect, it } from 'vitest';
import {
  agentConversationFileName,
  serializeAgentConversation,
} from './agent-conversation-export.js';

describe('Agent conversation export', () => {
  it('exports diagnostic context, transcript and latest raw run output', () => {
    const text = serializeAgentConversation({
      workspace: '/repo',
      branch: 'main',
      mapRevision: 42,
      exportedAt: '2026-08-13T08:00:00.000Z',
      conversation: {
        threadId: 'thread-1',
        agent: 'codex',
        state: 'failed',
        messages: [
          { id: 'm1', role: 'user', body: '为什么失败？', createdAt: '2026-08-13T07:59:00Z' },
          { id: 'm2', role: 'agent', body: 'MCP rejected', createdAt: '2026-08-13T07:59:05Z' },
        ],
      },
      run: {
        runId: 'run-1',
        agent: 'codex',
        state: 'failed',
        output: ['精炼后的错误'],
        restartRequired: false,
        purpose: 'project_chat',
      },
      rawOutput: ['raw error'],
    });
    expect(text).toContain('地图版本：r42');
    expect(text).toContain('为什么失败？');
    expect(text).toContain('MCP rejected');
    expect(text).toContain('raw error');
    expect(text).not.toContain('精炼后的错误');
  });

  it('creates a filesystem-safe markdown name', () => {
    expect(agentConversationFileName('2026-08-13T08:00:00.000Z')).toBe(
      'god-view-agent-conversation-2026-08-13T08-00-00-000Z.md',
    );
  });
});
