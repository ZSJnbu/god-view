import type { AgentConversationView, AgentRunView } from '@god-view/webview-bridge';

export function serializeAgentConversation(input: {
  readonly workspace: string;
  readonly branch: string;
  readonly mapRevision: number;
  readonly exportedAt: string;
  readonly conversation: AgentConversationView;
  readonly run?: AgentRunView;
  readonly rawOutput?: readonly string[];
}): string {
  const lines = [
    '# God View Agent 对话记录',
    '',
    `- 工作区：${input.workspace}`,
    `- 分支：${input.branch}`,
    `- 地图版本：r${String(input.mapRevision)}`,
    `- 导出时间：${input.exportedAt}`,
    `- Agent：${input.conversation.agent ?? input.run?.agent ?? '未记录'}`,
    `- 会话状态：${input.conversation.state}`,
    `- Thread ID：${input.conversation.threadId}`,
    '',
    '## 对话',
    '',
  ];
  for (const message of input.conversation.messages) {
    lines.push(`### ${roleLabel(message.role)} · ${message.createdAt}`, '', message.body, '');
  }
  const rawOutput = input.rawOutput ?? input.run?.output ?? [];
  if (rawOutput.length > 0) {
    lines.push('## 最近一次运行原始输出', '', '```text', ...rawOutput, '```', '');
  }
  return `${lines.join('\n')}\n`;
}

export function agentConversationFileName(exportedAt: string): string {
  return `god-view-agent-conversation-${exportedAt.replaceAll(':', '-').replaceAll('.', '-')}.md`;
}

function roleLabel(role: 'user' | 'agent' | 'activity'): string {
  return role === 'user' ? '用户' : role === 'agent' ? 'Agent' : '运行活动';
}
