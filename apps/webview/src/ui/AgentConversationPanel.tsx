import { useState } from 'react';
import type { ConfigurableAgent } from '@god-view/webview-bridge';
import type {
  ActiveChange,
  ChangeProposal,
  CompletedChange,
  Identifier,
  WorkspacePath,
} from '@god-view/protocol';
import { ProposalReview } from './AnnotationThreads.js';
import { proposalExecutionState, proposalRemainsActionable } from './proposal-execution.js';

/** God View 只提供原生 Agent 入口和业务变更审批，不再镜像聊天与系统权限。 */
export function AgentConversationPanel(props: {
  readonly agent: ConfigurableAgent | undefined;
  readonly selectedNode: { readonly id: string; readonly label: string } | undefined;
  readonly proposals: readonly ChangeProposal[];
  readonly activeChanges: readonly ActiveChange[];
  readonly completedChanges: readonly CompletedChange[];
  readonly hasGit: boolean;
  readonly onOpenAgent: () => void;
  readonly onSend: (message: string, mode: 'chat' | 'change') => void;
  readonly paneMode: 'docked' | 'floating';
  readonly onTogglePaneMode: () => void;
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
  const send = (): void => {
    const clean = message.trim();
    if (clean === '' || props.agent === undefined) return;
    props.onSend(clean, mode);
    setMessage('');
  };

  return (
    <section className="agent-conversation" aria-label="原生项目 Agent">
      <header className="agent-conversation__header">
        <div>
          <strong>{props.agent === 'claude-code' ? 'Claude Code' : 'Codex'} 原生会话</strong>
          <span>{props.agent === undefined ? '尚未配置' : '对话、权限与恢复由官方终端处理'}</span>
        </div>
        <div className="agent-conversation__header-actions">
          {props.selectedNode !== undefined && (
            <span className="agent-conversation__context">上下文：{props.selectedNode.label}</span>
          )}
          <button className="chip" type="button" onClick={props.onOpenAgent}>
            {props.agent === undefined ? '配置 Agent' : '打开 / 聚焦终端'}
          </button>
          <button className="chip" type="button" onClick={props.onTogglePaneMode}>
            {props.paneMode === 'docked' ? '浮动窗口' : '停靠底部'}
          </button>
        </div>
      </header>

      <div
        className="agent-conversation__messages"
        aria-label="原生 Agent 与画布说明"
        aria-live="polite"
        tabIndex={0}
      >
        <div className="agent-conversation__welcome">
          <strong>God View 不再运行一套独立 Agent。</strong>
          <span>
            下方输入会交给官方 Codex/Claude 终端；系统权限申请也会在那里出现。画布通过 hook
            获取上下文，并由 God View MCP 的结构化事件更新。
          </span>
        </div>
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
              agentReady={props.agent !== undefined}
              onApprove={props.onApproveProposal}
              onStart={props.onStartApprovedChange}
              onReject={props.onRejectProposal}
              onCopyTask={props.onCopyApprovedChangeTask}
            />
          </section>
        )}
      </div>

      {actionableProposal === undefined && (
        <div className="agent-conversation__composer">
          <textarea
            aria-label="发送给原生项目 Agent"
            value={message}
            disabled={props.agent === undefined}
            placeholder={
              props.agent === undefined
                ? '请先配置 Agent'
                : '发送到官方终端；后续对话直接在终端继续…'
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
              作为修改请求（先形成 God View 方案）
            </label>
            <button
              className="empty-map__primary"
              type="button"
              disabled={message.trim() === '' || props.agent === undefined}
              onClick={send}
            >
              发送到终端
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function approvalHeading(kind: ReturnType<typeof proposalExecutionState>['kind'] | undefined) {
  return {
    proposed: '方案已准备好，等待你批准后交给原生 Agent',
    ready: '方案已批准，可以交给原生 Agent 实现',
    expired: '批准已过期，需要重新批准',
    active: '原生 Agent 正在执行 ChangeSet',
    retryable: '上次执行未成功，需要重新决定',
    completed: '方案已经执行完成',
  }[kind ?? 'proposed'];
}

function approvalSubheading(kind: ReturnType<typeof proposalExecutionState>['kind'] | undefined) {
  if (kind === 'retryable') return '已有代码改动和失败记录都会保留';
  if (kind === 'active') return '权限申请在官方终端显示，画布等待 MCP 事件';
  if (kind === 'expired') return 'God View 不会自动续签业务范围授权';
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
