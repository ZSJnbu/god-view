import { join } from 'node:path';
import type { GraphSnapshot } from '@god-view/graph-core';
import type { AgentConversationView } from '@god-view/webview-bridge';
import { readTextFile, writeFileAtomic } from '@god-view/storage';

const memoryDirectory = '.godview';
const memoryDocumentName = 'GODVIEW.md';
const conversationStateName = 'agent-conversation.json';
const maximumRememberedMessages = 80;

export class ProjectMemory {
  readonly #root: string;
  #writeChain: Promise<void> = Promise.resolve();
  #context = '';

  constructor(root: string) {
    this.#root = root;
  }

  get context(): string {
    return this.#context;
  }

  async load(): Promise<AgentConversationView | undefined> {
    this.#context = (await readTextFile(this.#documentPath())) ?? '';
    const raw = await readTextFile(this.#conversationPath());
    if (raw === undefined) return undefined;
    try {
      return parseStoredConversation(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  persist(conversation: AgentConversationView, snapshot: GraphSnapshot): void {
    const { activeRunId: _activeRunId, ...rest } = conversation;
    const stableConversation: AgentConversationView = {
      ...rest,
      state: 'idle',
      messages: conversation.messages
        .filter((message) => !message.id.startsWith('live-'))
        .slice(-maximumRememberedMessages),
    };
    const markdown = serializeProjectMemory(stableConversation, snapshot);
    this.#context = markdown;
    this.#writeChain = this.#writeChain.then(async () => {
      await writeFileAtomic(this.#conversationPath(), JSON.stringify(stableConversation));
      await writeFileAtomic(this.#documentPath(), markdown);
    });
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }

  #documentPath(): string {
    return join(this.#root, memoryDirectory, memoryDocumentName);
  }

  #conversationPath(): string {
    return join(this.#root, memoryDirectory, conversationStateName);
  }
}

export function serializeProjectMemory(
  conversation: AgentConversationView,
  snapshot: GraphSnapshot,
): string {
  const nodes = [...snapshot.nodes.values()];
  const completedChanges = [...snapshot.completedChanges.values()].slice(-20).reverse();
  const transcript = conversation.messages.slice(-30);
  return `${[
    '# GODVIEW — 项目记忆',
    '',
    '> 由 God View 自动维护。它记录地图与内部 Agent 会话的可恢复上下文；不要把它当作源码真相。',
    '',
    '## 当前地图',
    '',
    `- 分支：${snapshot.branchKey}`,
    `- 地图版本：r${String(snapshot.revision)}`,
    `- 节点：${String(snapshot.nodes.size)}`,
    `- 关系：${String(snapshot.edges.size)}`,
    '',
    ...nodes
      .slice(0, 30)
      .map((node) => `- ${node.label}（${node.id}）：${node.responsibility ?? '未记录职责'}`),
    ...(nodes.length > 30 ? [`- 另有 ${String(nodes.length - 30)} 个节点，请读取权威地图。`] : []),
    '',
    '## 最近变更',
    '',
    ...(completedChanges.length === 0
      ? ['- 暂无已完成且可审查的代码变更。']
      : completedChanges.map(
          (change) =>
            `- ${change.completedAt} · ${change.status} · ${change.changeSetId} · 文件 ${String(change.actualFiles.length)} 个 · 地图实体 ${String((change.touchedNodeIds?.length ?? 0) + (change.touchedEdgeIds?.length ?? 0))} 个`,
        )),
    '',
    '## 最近 Agent 对话',
    '',
    ...(transcript.length === 0
      ? ['- 暂无对话。']
      : transcript.map(
          (message) =>
            `### ${message.role === 'user' ? '用户' : message.role === 'agent' ? 'Agent' : '运行活动'} · ${message.createdAt}\n\n${message.body}`,
        )),
    '',
  ].join('\n')}\n`;
}

function parseStoredConversation(value: unknown): AgentConversationView | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['threadId'] !== 'string' || !Array.isArray(record['messages']))
    return undefined;
  const messages = record['messages'].filter(isStoredMessage).slice(-maximumRememberedMessages);
  const agent = record['agent'];
  return {
    threadId: record['threadId'],
    state: 'idle',
    messages,
    ...(agent === 'codex' || agent === 'claude-code' ? { agent } : {}),
  };
}

function isStoredMessage(value: unknown): value is AgentConversationView['messages'][number] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    ['user', 'agent', 'activity'].includes(String(record['role'])) &&
    typeof record['body'] === 'string' &&
    typeof record['createdAt'] === 'string'
  );
}
