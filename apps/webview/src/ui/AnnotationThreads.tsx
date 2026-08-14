import { useEffect, useState } from 'react';
import type {
  ActiveChange,
  AnnotationThread,
  ChangeProposal,
  CompletedChange,
  Identifier,
  WorkspacePath,
  WriteAccessRequest,
} from '@god-view/protocol';
import { annotationTypeLabel } from './annotation-presentation.js';
import { ProposalList } from './ProposalList.js';
import { proposalExecutionState } from './proposal-execution.js';

export interface AnnotationThreadsProps {
  readonly annotations: readonly AnnotationThread[];
  readonly requests: readonly WriteAccessRequest[];
  readonly proposals: readonly ChangeProposal[];
  readonly activeChanges: readonly ActiveChange[];
  readonly completedChanges: readonly CompletedChange[];
  readonly hasGit: boolean;
  readonly onOpenSource: (path: string, startLine?: number) => void;
  readonly onResolve: (annotationId: Identifier) => void;
  readonly onStartAnswer: (annotationId: Identifier) => void;
  readonly onCopyTask: (annotationId: Identifier) => void;
  readonly onApproveProposal: (
    proposalId: Identifier,
    approvedScope: readonly WorkspacePath[],
  ) => void;
  readonly onStartApprovedChange: (proposalId: Identifier) => void;
  readonly onRejectProposal: (proposalId: Identifier) => void;
  readonly onCopyApprovedChangeTask: (proposalId: Identifier) => void;
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
  activeChanges,
  completedChanges,
  hasGit,
  onOpenSource,
  onResolve,
  onStartAnswer,
  onCopyTask,
  onApproveProposal,
  onStartApprovedChange,
  onRejectProposal,
  onCopyApprovedChangeTask,
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
              onClick={() => {
                onStartAnswer(annotation.id);
              }}
            >
              发送到原生 Agent 回答
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onCopyTask(annotation.id);
              }}
            >
              复制手动任务
            </button>
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
            activeChanges={activeChanges}
            completedChanges={completedChanges}
            hasGit={hasGit}
            onApprove={onApproveProposal}
            onStart={onStartApprovedChange}
            onReject={onRejectProposal}
            onCopyTask={onCopyApprovedChangeTask}
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

// eslint-disable-next-line complexity -- 单一卡片需完整呈现 proposed/active/failed/expired/completed 状态机。
export function ProposalReview({
  proposal,
  activeChanges,
  completedChanges,
  hasGit,
  onApprove,
  onStart,
  onReject,
  onCopyTask,
}: {
  readonly proposal: ChangeProposal;
  readonly activeChanges: readonly ActiveChange[];
  readonly completedChanges: readonly CompletedChange[];
  readonly hasGit: boolean;
  readonly onApprove: AnnotationThreadsProps['onApproveProposal'];
  readonly onStart: AnnotationThreadsProps['onStartApprovedChange'];
  readonly onReject: AnnotationThreadsProps['onRejectProposal'];
  readonly onCopyTask: AnnotationThreadsProps['onCopyApprovedChangeTask'];
}): React.JSX.Element {
  const [scope, setScope] = useState<ReadonlySet<WorkspacePath>>(
    () => new Set(proposal.approval?.approvedScope ?? proposal.plannedFiles),
  );
  const [, refreshExpiry] = useState(0);
  const pending = proposal.status === 'proposed';
  const execution = proposalExecutionState(proposal, activeChanges, completedChanges, Date.now());
  const retryable = execution.kind === 'retryable' || execution.kind === 'expired';
  useEffect(() => {
    setScope(new Set(proposal.approval?.approvedScope ?? proposal.plannedFiles));
  }, [proposal.id, proposal.approval?.token, proposal.plannedFiles]);
  useEffect(() => {
    const expiresAt = proposal.approval?.expiresAt;
    if (expiresAt === undefined) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => {
        refreshExpiry((value) => value + 1);
      },
      Math.min(remaining + 50, 2_147_483_647),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [proposal.approval?.expiresAt]);
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
      {execution.kind === 'active' && (
        <p role="status">ChangeSet {execution.change.changeSetId} 正在执行，不能重复启动。</p>
      )}
      {execution.kind === 'expired' && (
        <p className="annotation-warning" role="alert">
          本次批准令牌已过期。点击“重新批准并开始”会由你明确签发一枚新的 15 分钟令牌。
        </p>
      )}
      {execution.kind === 'retryable' && (
        <div className="annotation-warning" role="alert">
          <strong>
            上次执行{execution.change.status === 'interrupted' ? '已中断' : '失败'}
            ，没有被当作成功。
          </strong>
          {execution.change.note !== undefined && <p>{execution.change.note}</p>}
          <small>重试前必须由你重新批准；插件不会自动续签旧授权。</small>
        </div>
      )}
      {execution.kind === 'completed' && (
        <p className="agent-run__success">
          ✓ 该方案已经执行，状态：{completedStatusLabel(execution.change.status)}。请在下方 Diff
          验收区查看结果，不会再次启动同一方案。
        </p>
      )}
      {pending && !hasGit && (
        <p className="annotation-warning">
          当前项目没有 Git 基线。请先在 VS Code 源代码管理中初始化仓库并创建首次提交， 然后重新打开
          God View；建立基线后才能区分 Agent 修改、检查越界文件并提供 Diff 验收。
        </p>
      )}
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
              批准并开始实现
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
        {proposal.status === 'approved' && execution.kind === 'ready' && (
          <>
            <button
              type="button"
              className="chip chip--active"
              onClick={() => {
                onStart(proposal.id);
              }}
            >
              发送到原生 Agent 继续
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onCopyTask(proposal.id);
              }}
            >
              复制已批准任务
            </button>
          </>
        )}
        {proposal.status === 'approved' && retryable && (
          <>
            <button
              type="button"
              className="chip chip--active"
              disabled={!hasGit || scope.size === 0}
              onClick={() => {
                onApprove(proposal.id, [...scope]);
              }}
            >
              {execution.kind === 'retryable' ? '重新批准并重试' : '重新批准并开始'}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onCopyTask(proposal.id);
              }}
            >
              复制任务（兜底）
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function completedStatusLabel(status: CompletedChange['status']): string {
  return {
    pending_review: '等待验收',
    accepted: '已接受',
    accepted_with_issues: '带问题接受',
    failed: '失败',
    interrupted: '已中断',
  }[status];
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
