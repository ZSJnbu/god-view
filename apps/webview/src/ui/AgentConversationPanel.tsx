import { useEffect, useRef, useState } from 'react';
import type {
  AgentConversationView,
  AgentRunView,
  ConfigurableAgent,
} from '@god-view/webview-bridge';
import type {
  ActiveChange,
  ChangeProposal,
  CompletedChange,
  Identifier,
  WorkspacePath,
} from '@god-view/protocol';
import { AgentRunPanel } from './AgentRunPanel.js';
import { ProposalReview } from './AnnotationThreads.js';
import { proposalExecutionState, proposalRemainsActionable } from './proposal-execution.js';

// eslint-disable-next-line complexity -- one conversation surface intentionally exposes all live Agent states.
export function AgentConversationPanel(props: {
  readonly conversation: AgentConversationView | undefined;
  readonly run: AgentRunView | undefined;
  readonly agent: ConfigurableAgent | undefined;
  readonly selectedNode: { readonly id: string; readonly label: string } | undefined;
  readonly proposals: readonly ChangeProposal[];
  readonly activeChanges: readonly ActiveChange[];
  readonly completedChanges: readonly CompletedChange[];
  readonly hasGit: boolean;
  readonly onSend: (message: string, mode: 'chat' | 'change') => void;
  readonly onAnswer: (runId: string, answer: string) => void;
  readonly onScopeExpansionDecision: (
    runId: string,
    requestId: string,
    changeSetId: string,
    decision: 'approved' | 'rejected',
  ) => void;
  readonly onCancel: (runId: string) => void;
  readonly paneMode: 'docked' | 'floating';
  readonly onTogglePaneMode: () => void;
  readonly onExport: () => void;
  readonly onApproveProposal: (
    proposalId: Identifier,
    approvedScope: readonly WorkspacePath[],
  ) => void;
  readonly onStartApprovedChange: (proposalId: Identifier) => void;
  readonly onRejectProposal: (proposalId: Identifier) => void;
  readonly onCopyApprovedChangeTask: (proposalId: Identifier) => void;
}): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'chat' | 'change'>('chat');
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const active = isConversationActive(props.conversation);
  const messages = props.conversation?.messages ?? [];
  const hasQuestion = props.run?.question !== undefined && props.run.state === 'awaiting_input';
  const showTask = props.run !== undefined && props.run.purpose !== 'project_chat';
  const actionableProposal = latestActionableProposal(props.proposals, props.completedChanges);
  const actionableState =
    actionableProposal === undefined
      ? undefined
      : proposalExecutionState(
          actionableProposal,
          props.activeChanges,
          props.completedChanges,
          Date.now(),
        );
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
            onScopeExpansionDecision={props.onScopeExpansionDecision}
            onCancel={props.onCancel}
            compact
          />
        )}
        {showTask && !hasQuestion && (
          <AgentRunPanel
            run={props.run}
            onAnswer={props.onAnswer}
            onScopeExpansionDecision={props.onScopeExpansionDecision}
            onCancel={props.onCancel}
            compact
          />
        )}
        {actionableProposal !== undefined && (
          <section className="agent-conversation__approval" aria-label="等待批准并实现">
            <header>
              <strong>{approvalHeading(actionableState?.kind)}</strong>
              <span>{approvalSubheading(actionableState?.kind)}</span>
            </header>
            <ProposalReview
              proposal={actionableProposal}
              activeChanges={props.activeChanges}
              completedChanges={props.completedChanges}
              hasGit={props.hasGit}
              onApprove={props.onApproveProposal}
              onStart={props.onStartApprovedChange}
              onReject={props.onRejectProposal}
              onCopyTask={props.onCopyApprovedChangeTask}
              editing={
                props.run?.purpose === 'approved_change' &&
                props.run.proposalId === actionableProposal.id &&
                ['starting', 'running', 'awaiting_input'].includes(props.run.state)
              }
              failed={
                props.run?.purpose === 'approved_change' &&
                props.run.proposalId === actionableProposal.id &&
                props.run.state === 'failed'
              }
            />
          </section>
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
        {mode === 'change' && (
          <small>
            Agent 会先提交方案；未批准前不会修改任何文件。
            {props.selectedNode === undefined
              ? ' 当前未选模块，将使用项目顶层模块作为修改上下文。'
              : ` 当前限定在 ${props.selectedNode.label}。`}
          </small>
        )}
      </div>
    </section>
  );
}

function approvalHeading(kind: ReturnType<typeof proposalExecutionState>['kind'] | undefined) {
  return {
    proposed: '方案已准备好，等待你批准后实现',
    ready: '方案已批准，可以启动内部编辑 Agent',
    expired: '批准已过期，需要你重新批准',
    active: '方案正在执行',
    retryable: '上次执行未成功，需要你决定是否重试',
    completed: '方案已经执行完成',
  }[kind ?? 'proposed'];
}

function approvalSubheading(kind: ReturnType<typeof proposalExecutionState>['kind'] | undefined) {
  if (kind === 'retryable') return '已有代码改动和失败记录都会保留，不会静默当作成功';
  if (kind === 'active') return '正在等待 Agent 写入并同步权威地图';
  if (kind === 'expired') return '插件不会自动续签写权限';
  return kind === 'proposed' ? 'Agent 还没有修改代码' : '执行状态以 ChangeSet 记录为准';
}

function latestActionableProposal(
  proposals: readonly ChangeProposal[],
  completedChanges: readonly CompletedChange[],
): ChangeProposal | undefined {
  return [...proposals]
    .filter((proposal) => proposalRemainsActionable(proposal, completedChanges))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
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
