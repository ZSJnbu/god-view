import { useEffect, useRef, useState } from 'react';
import type {
  AgentConversationView,
  AgentRunView,
  ConfigurableAgent,
} from '@god-view/webview-bridge';
import { AgentRunPanel } from './AgentRunPanel.js';

// eslint-disable-next-line complexity -- one conversation surface intentionally exposes all live Agent states.
export function AgentConversationPanel(props: {
  readonly conversation: AgentConversationView | undefined;
  readonly run: AgentRunView | undefined;
  readonly agent: ConfigurableAgent | undefined;
  readonly selectedNode: { readonly id: string; readonly label: string } | undefined;
  readonly onSend: (message: string, mode: 'chat' | 'change') => void;
  readonly onAnswer: (runId: string, answer: string) => void;
  readonly onCancel: (runId: string) => void;
  readonly paneMode: 'docked' | 'floating';
  readonly onTogglePaneMode: () => void;
  readonly onExport: () => void;
}): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'chat' | 'change'>('chat');
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const active = isConversationActive(props.conversation);
  const messages = props.conversation?.messages ?? [];
  const hasQuestion = props.run?.question !== undefined && props.run.state === 'awaiting_input';
  const showTask = props.run !== undefined && props.run.purpose !== 'project_chat';
  useEffect(() => {
    const element = transcriptRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [props.conversation?.messages]);
  const send = (): void => {
    const clean = message.trim();
    if (clean === '' || active || props.agent === undefined) return;
    props.onSend(clean, mode);
    setMessage('');
  };
  return (
    <section className="agent-conversation" aria-label="项目 Agent 对话">
      <header className="agent-conversation__header">
        <div>
          <strong>项目 Agent</strong>
          <span>{statusLabel(props.conversation, props.agent)}</span>
        </div>
        <div className="agent-conversation__header-actions">
          {props.selectedNode !== undefined && (
            <span className="agent-conversation__context">上下文：{props.selectedNode.label}</span>
          )}
          <button
            className="chip"
            type="button"
            onClick={props.onExport}
            disabled={messages.length === 0}
          >
            导出对话
          </button>
          <button className="chip" type="button" onClick={props.onTogglePaneMode}>
            {props.paneMode === 'docked' ? '浮动窗口' : '停靠底部'}
          </button>
        </div>
      </header>
      <div
        className="agent-conversation__messages"
        ref={transcriptRef}
        aria-live="polite"
        aria-label="Agent 对话记录"
        tabIndex={0}
      >
        {messages.length === 0 && (
          <div className="agent-conversation__welcome">
            <strong>直接询问项目，或描述你希望修改的内容。</strong>
            <span>普通对话只读；修改请求会先生成方案和文件范围，批准后才会编辑。</span>
          </div>
        )}
        {messages.map((item) => (
          <article key={item.id} className={`agent-message agent-message--${item.role}`}>
            <small>
              {item.role === 'user' ? '你' : item.role === 'agent' ? 'Agent' : '运行进度'}
            </small>
            <p>{item.body}</p>
          </article>
        ))}
        {hasQuestion && (
          <AgentRunPanel
            run={props.run}
            onAnswer={props.onAnswer}
            onCancel={props.onCancel}
            compact
          />
        )}
        {showTask && !hasQuestion && (
          <AgentRunPanel
            run={props.run}
            onAnswer={props.onAnswer}
            onCancel={props.onCancel}
            compact
          />
        )}
      </div>
      <div className="agent-conversation__composer">
        <textarea
          aria-label="发送给项目 Agent"
          value={message}
          disabled={active || props.agent === undefined}
          placeholder={
            props.agent === undefined ? '请先配置 Agent' : '询问项目，或描述希望修改的内容…'
          }
          onChange={(event) => {
            setMessage(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div>
          <label>
            <input
              type="checkbox"
              checked={mode === 'change'}
              disabled={props.selectedNode === undefined}
              onChange={(event) => {
                setMode(event.target.checked ? 'change' : 'chat');
              }}
            />
            作为修改请求（先审批范围）
          </label>
          <button
            className="empty-map__primary"
            type="button"
            disabled={message.trim() === '' || active || props.agent === undefined}
            onClick={send}
          >
            {active ? 'Agent 正在处理…' : '发送'}
          </button>
        </div>
        {mode === 'change' && <small>Agent 会先提交方案；未批准前不会修改任何文件。</small>}
      </div>
    </section>
  );
}

function isConversationActive(conversation: AgentConversationView | undefined): boolean {
  return (
    conversation !== undefined &&
    ['running', 'editing', 'awaiting_input'].includes(conversation.state)
  );
}

function statusLabel(
  conversation: AgentConversationView | undefined,
  agent: ConfigurableAgent | undefined,
): string {
  if (agent === undefined) return '尚未配置';
  return {
    idle: '空闲 · 可继续对话',
    running: '正在思考',
    awaiting_input: '等待你的回答',
    editing: '正在编辑并同步地图',
    failed: '上一轮失败 · 可以重试',
  }[conversation?.state ?? 'idle'];
}
