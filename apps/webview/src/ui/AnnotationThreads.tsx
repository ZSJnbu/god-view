import { useState } from 'react';
import type {
  AnnotationThread,
  ChangeProposal,
  Identifier,
  WorkspacePath,
  WriteAccessRequest,
} from '@god-view/protocol';
import { annotationTypeLabel } from './annotation-presentation.js';
import { ProposalList } from './ProposalList.js';

export interface AnnotationThreadsProps {
  readonly annotations: readonly AnnotationThread[];
  readonly requests: readonly WriteAccessRequest[];
  readonly proposals: readonly ChangeProposal[];
  readonly hasGit: boolean;
  readonly onOpenSource: (path: string, startLine?: number) => void;
  readonly onResolve: (annotationId: Identifier) => void;
  readonly onStartAnswer: (annotationId: Identifier) => void;
  readonly answeringAnnotationId: Identifier | undefined;
  readonly failedAnnotationId: Identifier | undefined;
  readonly onCopyTask: (annotationId: Identifier) => void;
  readonly onApproveProposal: (
    proposalId: Identifier,
    approvedScope: readonly WorkspacePath[],
  ) => void;
  readonly onStartApprovedChange: (proposalId: Identifier) => void;
  readonly onRejectProposal: (proposalId: Identifier) => void;
  readonly onCopyApprovedChangeTask: (proposalId: Identifier) => void;
  readonly editingProposalId: Identifier | undefined;
  readonly failedProposalId: Identifier | undefined;
}

/** 标注、Agent 回答和受控修改方案组成的原位对话线程。 */
export function AnnotationThreads(props: AnnotationThreadsProps): React.JSX.Element {
  const { annotations } = props;
  if (annotations.length === 0) return <></>;
  return (
    <section className="annotation-threads" aria-labelledby="annotation-threads-heading">
      <h3 id="annotation-threads-heading">标注线程（{annotations.length}）</h3>
      {annotations.map((annotation) => (
        <AnnotationThreadCard key={annotation.id} annotation={annotation} {...props} />
      ))}
    </section>
  );
}

function AnnotationThreadCard({
  annotation,
  requests,
  proposals,
  hasGit,
  onOpenSource,
  onResolve,
  onStartAnswer,
  answeringAnnotationId,
  failedAnnotationId,
  onCopyTask,
  onApproveProposal,
  onStartApprovedChange,
  onRejectProposal,
  onCopyApprovedChangeTask,
  editingProposalId,
  failedProposalId,
}: Omit<AnnotationThreadsProps, 'annotations'> & {
  readonly annotation: AnnotationThread;
}): React.JSX.Element {
  const question = annotation.messages.find((message) => message.author === 'user');
  const answers = annotation.messages.filter((message) => message.author === 'agent');
  return (
    <article className="annotation-thread" data-status={annotation.status}>
      <header>
        <strong>{annotationTypeLabel[annotation.type]}</strong>
        <span>{annotation.status}</span>
      </header>
      {question !== undefined && <p>{question.body}</p>}
      {answers.map((answer) => (
        <section key={answer.id} className="annotation-answer">
          <strong>Agent 回答</strong>
          <p>{answer.body}</p>
          {(answer.detail !== undefined || (answer.evidence?.length ?? 0) > 0) && (
            <details>
              <summary>详情与证据</summary>
              {answer.detail !== undefined && <p>{answer.detail}</p>}
              {(answer.evidence ?? []).map((evidence, index) => (
                <div key={`${answer.id}:${String(index)}`} className="annotation-evidence">
                  <span>{evidence.kind}</span>
                  {evidence.location !== undefined && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenSource(evidence.location?.path ?? '', evidence.location?.startLine);
                      }}
                    >
                      {evidence.location.path}
                      {evidence.location.startLine === undefined
                        ? ''
                        : `:${String(evidence.location.startLine)}`}
                    </button>
                  )}
                  {evidence.detail !== undefined && <span>{evidence.detail}</span>}
                </div>
              ))}
            </details>
          )}
          {answer.uncertain === true && (
            <p className="annotation-warning">Agent 标记此回答存在不确定性。</p>
          )}
        </section>
      ))}
      <div className="annotation-thread__actions">
        {annotation.status === 'sent' && (
          <>
            <button
              type="button"
              className="chip chip--active"
              disabled={answeringAnnotationId !== undefined}
              onClick={() => {
                onStartAnswer(annotation.id);
              }}
            >
              {answeringAnnotationId === annotation.id ? 'AI 正在回答…' : '让 AI 回答'}
            </button>
            {failedAnnotationId === annotation.id && (
              <button
                type="button"
                className="chip"
                title="内部 AI 未能完成；复制任务到外部 Agent 继续"
                onClick={() => {
                  onCopyTask(annotation.id);
                }}
              >
                复制手动任务（兜底）
              </button>
            )}
          </>
        )}
        {!['resolved', 'cancelled'].includes(annotation.status) && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              onResolve(annotation.id);
            }}
          >
            标记已解决
          </button>
        )}
      </div>
      {requests
        .filter((request) => request.annotationId === annotation.id)
        .map((request) => (
          <WriteRequest key={request.id} request={request} />
        ))}
      {proposals
        .filter((proposal) => proposal.annotationId === annotation.id)
        .map((proposal) => (
          <ProposalReview
            key={proposal.id}
            proposal={proposal}
            hasGit={hasGit}
            onApprove={onApproveProposal}
            onStart={onStartApprovedChange}
            onReject={onRejectProposal}
            onCopyTask={onCopyApprovedChangeTask}
            editing={editingProposalId === proposal.id}
            failed={failedProposalId === proposal.id}
          />
        ))}
    </article>
  );
}

function WriteRequest({ request }: { readonly request: WriteAccessRequest }): React.JSX.Element {
  return (
    <section className="proposal-card proposal-card--request">
      <h4>Agent 请求进入修改流程</h4>
      <p>{request.reason}</p>
      <p>预期范围：{request.expectedScope.join('、')}</p>
      <small>请求本身没有授予写权限。</small>
    </section>
  );
}

function ProposalReview({
  proposal,
  hasGit,
  onApprove,
  onStart,
  onReject,
  onCopyTask,
  editing,
  failed,
}: {
  readonly proposal: ChangeProposal;
  readonly hasGit: boolean;
  readonly onApprove: AnnotationThreadsProps['onApproveProposal'];
  readonly onStart: AnnotationThreadsProps['onStartApprovedChange'];
  readonly onReject: AnnotationThreadsProps['onRejectProposal'];
  readonly onCopyTask: AnnotationThreadsProps['onCopyApprovedChangeTask'];
  readonly editing: boolean;
  readonly failed: boolean;
}): React.JSX.Element {
  const [scope, setScope] = useState<ReadonlySet<WorkspacePath>>(
    () => new Set(proposal.approval?.approvedScope ?? proposal.plannedFiles),
  );
  const pending = proposal.status === 'proposed';
  return (
    <section className="proposal-card" aria-label={`修改方案：${proposal.summary}`}>
      <header>
        <h4>修改方案</h4>
        <span>{proposalStatusLabel(proposal.status)}</span>
      </header>
      <p>{proposal.summary}</p>
      <fieldset disabled={!pending}>
        <legend>批准文件范围（可缩小，不可扩大）</legend>
        {proposal.plannedFiles.map((path) => (
          <label key={path}>
            <input
              type="checkbox"
              checked={scope.has(path)}
              onChange={(event) => {
                const next = new Set(scope);
                if (event.currentTarget.checked) next.add(path);
                else next.delete(path);
                setScope(next);
              }}
            />
            {path}
          </label>
        ))}
      </fieldset>
      <ProposalList title="结构变化" items={proposal.structuralChanges} />
      <ProposalList title="风险" items={proposal.risks} />
      <ProposalList title="验证计划" items={proposal.validationPlan} />
      {proposal.approval !== undefined && (
        <p className="annotation-warning">
          已批准 {proposal.approval.approvedScope.length} 个文件；令牌到期于{' '}
          {proposal.approval.expiresAt}。当前为 monitored 模式，不能强制阻止外部进程越界写入。
        </p>
      )}
      {pending && !hasGit && <p className="annotation-warning">无 Git 工作区不能批准执行。</p>}
      <div className="annotation-thread__actions">
        {pending && (
          <>
            <button
              type="button"
              className="chip chip--active"
              disabled={!hasGit || scope.size === 0}
              onClick={() => {
                onApprove(proposal.id, [...scope]);
              }}
            >
              明确批准所选范围
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onReject(proposal.id);
              }}
            >
              拒绝方案
            </button>
          </>
        )}
        {proposal.status === 'approved' && (
          <>
            <button
              type="button"
              className="chip chip--active"
              disabled={editing}
              onClick={() => {
                onStart(proposal.id);
              }}
            >
              {editing ? 'Agent 正在编辑并同步视图…' : '启动内部编辑 Agent'}
            </button>
            {failed && (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  onCopyTask(proposal.id);
                }}
              >
                复制已批准任务（兜底）
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function proposalStatusLabel(status: ChangeProposal['status']): string {
  return {
    proposed: '等待批准',
    approved: '已批准',
    rejected: '已拒绝',
    cancelled: '已取消',
    stale: '已过期',
  }[status];
}
