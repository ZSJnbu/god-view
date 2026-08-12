import { useMemo, useState } from 'react';
import type {
  AnnotationThread,
  ChangeProposal,
  GraphNode,
  Identifier,
  WorkspacePath,
  WriteAccessRequest,
} from '@god-view/protocol';
import type { AppStore } from '../app-store.js';
import { badgesFor, nodeTypeLabels } from '../model/presentation.js';
import { searchNodes } from '../model/view-model.js';
import { useAppState } from './use-app-state.js';

export interface DetailsPanelProps {
  readonly store: AppStore;
  readonly onOpenSource: (path: string, startLine?: number) => void;
  readonly onCreateAnnotation: (
    type: 'note' | 'explain' | 'risk',
    body: string,
    nodeIds: readonly Identifier[],
    excludedPaths: readonly WorkspacePath[],
  ) => void;
  readonly onResolveAnnotation: (annotationId: Identifier) => void;
  readonly onCopyAnnotationTask: (annotationId: Identifier) => void;
  readonly onApproveProposal: (
    proposalId: Identifier,
    approvedScope: readonly WorkspacePath[],
  ) => void;
  readonly onRejectProposal: (proposalId: Identifier) => void;
  readonly onCopyApprovedChangeTask: (proposalId: Identifier) => void;
}

/**
 * 详情侧栏。
 *
 * 同时承担搜索结果列表：搜索命中全量节点，即使当前层级把它折叠了也能定位
 * （TECHNICAL_ARCHITECTURE.md §10.2）。
 */
export function DetailsPanel({
  store,
  onOpenSource,
  onCreateAnnotation,
  onResolveAnnotation,
  onCopyAnnotationTask,
  onApproveProposal,
  onRejectProposal,
  onCopyApprovedChangeTask,
}: DetailsPanelProps): React.JSX.Element {
  const state = useAppState(store);
  const query = state.view.query ?? '';
  const results = query.trim() === '' ? [] : searchNodes(state.map, query);
  const selected =
    state.selectedId === undefined ? undefined : state.map.nodes.get(state.selectedId);

  return (
    <aside className="details" aria-label="详情">
      {results.length > 0 && (
        <section className="details__section">
          <h2>搜索结果（{results.length}）</h2>
          <ul className="details__results">
            {results.slice(0, 50).map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => {
                    store.revealNode(node.id);
                  }}
                >
                  {node.label}
                  <small>{nodeTypeLabels[node.type]}</small>
                </button>
              </li>
            ))}
          </ul>
          {results.length > 50 && (
            <p className="details__more">另有 {results.length - 50} 条未列出。</p>
          )}
        </section>
      )}

      {selected === undefined ? (
        <p className="details__empty">选择一个节点查看它的职责、证据与文件。</p>
      ) : (
        <NodeDetails
          node={selected}
          store={store}
          annotations={[...state.map.annotations.values()].filter((annotation) =>
            annotation.target.nodeIds?.includes(selected.id),
          )}
          requests={[...state.map.writeAccessRequests.values()]}
          proposals={[...state.map.changeProposals.values()]}
          onOpenSource={onOpenSource}
          onCreateAnnotation={onCreateAnnotation}
          onResolveAnnotation={onResolveAnnotation}
          onCopyAnnotationTask={onCopyAnnotationTask}
          onApproveProposal={onApproveProposal}
          onRejectProposal={onRejectProposal}
          onCopyApprovedChangeTask={onCopyApprovedChangeTask}
        />
      )}
    </aside>
  );
}

function NodeDetails({
  node,
  store,
  annotations,
  requests,
  proposals,
  onOpenSource,
  onCreateAnnotation,
  onResolveAnnotation,
  onCopyAnnotationTask,
  onApproveProposal,
  onRejectProposal,
  onCopyApprovedChangeTask,
}: {
  readonly node: GraphNode;
  readonly store: AppStore;
  readonly annotations: readonly AnnotationThread[];
  readonly requests: readonly WriteAccessRequest[];
  readonly proposals: readonly ChangeProposal[];
  readonly onOpenSource: (path: string, startLine?: number) => void;
  readonly onCreateAnnotation: DetailsPanelProps['onCreateAnnotation'];
  readonly onResolveAnnotation: DetailsPanelProps['onResolveAnnotation'];
  readonly onCopyAnnotationTask: DetailsPanelProps['onCopyAnnotationTask'];
  readonly onApproveProposal: DetailsPanelProps['onApproveProposal'];
  readonly onRejectProposal: DetailsPanelProps['onRejectProposal'];
  readonly onCopyApprovedChangeTask: DetailsPanelProps['onCopyApprovedChangeTask'];
}): React.JSX.Element {
  const badges = badgesFor(node);
  return (
    <section className="details__section">
      <h2>{node.label}</h2>
      <p className="details__kind">{nodeTypeLabels[node.type]}</p>

      <dl className="details__trust">
        <div>
          <dt>代码校验</dt>
          <dd className={`trust trust--${badges.trust}`}>
            {badges.validationLabel}
            <small>{badges.level}</small>
          </dd>
        </div>
        <div>
          <dt>声明来源</dt>
          <dd>{badges.sourceLabel}</dd>
        </div>
        <div>
          <dt>用户确认</dt>
          <dd>{badges.confirmationLabel}</dd>
        </div>
        <div>
          <dt>代码证据</dt>
          {/* Agent 自述（agent_claim）不计入代码证据，避免把说法当成事实。 */}
          <dd>{badges.codeEvidenceCount} 条</dd>
        </div>
      </dl>

      {node.responsibility !== undefined && (
        <p className="details__responsibility">{node.responsibility}</p>
      )}

      {(node.uncertainties ?? []).length > 0 && (
        <section>
          <h3>Agent 声明的不确定点</h3>
          <ul>
            {(node.uncertainties ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {(node.paths ?? []).length > 0 && (
        <section>
          <h3>文件</h3>
          <ul className="details__paths">
            {(node.paths ?? []).map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSource(path);
                  }}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(node.locations ?? []).length > 0 && (
        <section>
          <h3>位置</h3>
          <ul className="details__paths">
            {(node.locations ?? []).map((location) => (
              <li key={`${location.path}:${String(location.startLine ?? 0)}`}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSource(location.path, location.startLine);
                  }}
                >
                  {location.path}
                  {location.startLine === undefined ? '' : `:${String(location.startLine)}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        className="chip"
        onClick={() => {
          toggleFocus(store, node.id);
        }}
      >
        聚焦邻域
      </button>

      <AnnotationComposer node={node} onCreate={onCreateAnnotation} />
      <AnnotationThreads
        annotations={annotations}
        requests={requests}
        proposals={proposals}
        hasGit={store.getState().map.capabilities?.hasGit ?? false}
        onOpenSource={onOpenSource}
        onResolve={onResolveAnnotation}
        onCopyTask={onCopyAnnotationTask}
        onApproveProposal={onApproveProposal}
        onRejectProposal={onRejectProposal}
        onCopyApprovedChangeTask={onCopyApprovedChangeTask}
      />
    </section>
  );
}

function AnnotationComposer({
  node,
  onCreate,
}: {
  readonly node: GraphNode;
  readonly onCreate: DetailsPanelProps['onCreateAnnotation'];
}): React.JSX.Element {
  const [type, setType] = useState<'note' | 'explain' | 'risk'>('explain');
  const [body, setBody] = useState('');
  const contextPaths = useMemo(
    () => [...new Set([...(node.paths ?? []), ...(node.locations ?? []).map((item) => item.path)])],
    [node],
  );
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  return (
    <section className="annotation-composer" aria-labelledby="annotation-heading">
      <h3 id="annotation-heading">原位标注</h3>
      <label>
        类型
        <select
          value={type}
          onChange={(event) => {
            setType(event.currentTarget.value as typeof type);
          }}
        >
          <option value="explain">要求解释</option>
          <option value="note">备注</option>
          <option value="risk">风险</option>
        </select>
      </label>
      <label>
        内容
        <textarea
          value={body}
          maxLength={4000}
          rows={4}
          placeholder="写下问题或上下文…"
          onChange={(event) => {
            setBody(event.currentTarget.value);
          }}
        />
      </label>
      {contextPaths.length > 0 && (
        <fieldset>
          <legend>发送前预览（只含路径，不含源码）</legend>
          {contextPaths.map((path) => (
            <label key={path} className="annotation-composer__context">
              <input
                type="checkbox"
                checked={!excluded.has(path)}
                onChange={(event) => {
                  const next = new Set(excluded);
                  if (event.currentTarget.checked) next.delete(path);
                  else next.add(path);
                  setExcluded(next);
                }}
              />
              {path}
            </label>
          ))}
        </fieldset>
      )}
      <p className="annotation-composer__permission">
        解释权限：受监控。此操作不会授权 Agent 修改代码或创建 ChangeSet。
      </p>
      <button
        type="button"
        className="chip chip--active"
        disabled={body.trim() === ''}
        onClick={() => {
          onCreate(type, body.trim(), [node.id], [...excluded]);
          setBody('');
        }}
      >
        创建标注
      </button>
    </section>
  );
}

const annotationTypeLabel: Record<AnnotationThread['type'], string> = {
  note: '备注',
  explain: '解释',
  risk: '风险',
  change: '修改',
};

function AnnotationThreads({
  annotations,
  requests,
  proposals,
  hasGit,
  onOpenSource,
  onResolve,
  onCopyTask,
  onApproveProposal,
  onRejectProposal,
  onCopyApprovedChangeTask,
}: {
  readonly annotations: readonly AnnotationThread[];
  readonly requests: readonly WriteAccessRequest[];
  readonly proposals: readonly ChangeProposal[];
  readonly hasGit: boolean;
  readonly onOpenSource: DetailsPanelProps['onOpenSource'];
  readonly onResolve: DetailsPanelProps['onResolveAnnotation'];
  readonly onCopyTask: DetailsPanelProps['onCopyAnnotationTask'];
  readonly onApproveProposal: DetailsPanelProps['onApproveProposal'];
  readonly onRejectProposal: DetailsPanelProps['onRejectProposal'];
  readonly onCopyApprovedChangeTask: DetailsPanelProps['onCopyApprovedChangeTask'];
}): React.JSX.Element {
  if (annotations.length === 0) return <></>;
  return (
    <section className="annotation-threads" aria-labelledby="annotation-threads-heading">
      <h3 id="annotation-threads-heading">标注线程（{annotations.length}）</h3>
      {annotations.map((annotation) => {
        const question = annotation.messages.find((message) => message.author === 'user');
        const answers = annotation.messages.filter((message) => message.author === 'agent');
        return (
          <article
            className="annotation-thread"
            key={annotation.id}
            data-status={annotation.status}
          >
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
                              onOpenSource(
                                evidence.location?.path ?? '',
                                evidence.location?.startLine,
                              );
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
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    onCopyTask(annotation.id);
                  }}
                >
                  复制解释任务
                </button>
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
                  onReject={onRejectProposal}
                  onCopyTask={onCopyApprovedChangeTask}
                />
              ))}
          </article>
        );
      })}
    </section>
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
  onReject,
  onCopyTask,
}: {
  readonly proposal: ChangeProposal;
  readonly hasGit: boolean;
  readonly onApprove: DetailsPanelProps['onApproveProposal'];
  readonly onReject: DetailsPanelProps['onRejectProposal'];
  readonly onCopyTask: DetailsPanelProps['onCopyApprovedChangeTask'];
}): React.JSX.Element {
  const [scope, setScope] = useState<ReadonlySet<WorkspacePath>>(
    () => new Set(proposal.approval?.approvedScope ?? proposal.plannedFiles),
  );
  const pending = proposal.status === 'proposed';
  return (
    <section className="proposal-card" aria-label={`修改方案：${proposal.summary}`}>
      <header>
        <h4>修改方案</h4>
        <span>{proposal.status}</span>
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
          <button
            type="button"
            className="chip chip--active"
            onClick={() => {
              onCopyTask(proposal.id);
            }}
          >
            复制已批准修改任务
          </button>
        )}
      </div>
    </section>
  );
}

function ProposalList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}): React.JSX.Element {
  if (items.length === 0) return <></>;
  return (
    <section>
      <h5>{title}</h5>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function toggleFocus(store: AppStore, id: Identifier): void {
  store.toggleFocus(id);
}
