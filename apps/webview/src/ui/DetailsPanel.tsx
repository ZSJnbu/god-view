import { useMemo, useRef, useState } from 'react';
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
import { AnnotationThreads } from './AnnotationThreads.js';

export interface DetailsPanelProps {
  readonly store: AppStore;
  readonly onOpenSource: (path: string, startLine?: number) => void;
  readonly onCreateAnnotation: (
    type: 'note' | 'explain' | 'risk' | 'change',
    body: string,
    nodeIds: readonly Identifier[],
    excludedPaths: readonly WorkspacePath[],
  ) => void;
  readonly onResolveAnnotation: (annotationId: Identifier) => void;
  readonly onStartAnnotationAnswer: (annotationId: Identifier) => void;
  readonly onCopyAnnotationTask: (annotationId: Identifier) => void;
  readonly onApproveProposal: (
    proposalId: Identifier,
    approvedScope: readonly WorkspacePath[],
  ) => void;
  readonly onStartApprovedChange: (proposalId: Identifier) => void;
  readonly onRejectProposal: (proposalId: Identifier) => void;
  readonly onCopyApprovedChangeTask: (proposalId: Identifier) => void;
}

/** 详情侧栏；搜索命中全量节点，并自动定位到可见层级。 */
export function DetailsPanel({
  store,
  onOpenSource,
  onCreateAnnotation,
  onResolveAnnotation,
  onStartAnnotationAnswer,
  onCopyAnnotationTask,
  onApproveProposal,
  onStartApprovedChange,
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
      <button
        className="details__close"
        type="button"
        aria-label="关闭详情"
        title="关闭详情"
        onClick={() => {
          store.closeDetails();
        }}
      >
        ×
      </button>
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
          onStartAnnotationAnswer={onStartAnnotationAnswer}
          onCopyAnnotationTask={onCopyAnnotationTask}
          onApproveProposal={onApproveProposal}
          onStartApprovedChange={onStartApprovedChange}
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
  onStartAnnotationAnswer,
  onCopyAnnotationTask,
  onApproveProposal,
  onStartApprovedChange,
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
  readonly onStartAnnotationAnswer: DetailsPanelProps['onStartAnnotationAnswer'];
  readonly onCopyAnnotationTask: DetailsPanelProps['onCopyAnnotationTask'];
  readonly onApproveProposal: DetailsPanelProps['onApproveProposal'];
  readonly onStartApprovedChange: DetailsPanelProps['onStartApprovedChange'];
  readonly onRejectProposal: DetailsPanelProps['onRejectProposal'];
  readonly onCopyApprovedChangeTask: DetailsPanelProps['onCopyApprovedChangeTask'];
}): React.JSX.Element {
  const badges = badgesFor(node);
  const agentRun = store.getState().agentRun;
  const annotationRun = annotationRunState(agentRun);
  const editRun = approvedChangeRunState(agentRun);
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

      <NodeEvidence node={node} onOpenSource={onOpenSource} />

      <button
        type="button"
        className="chip"
        onClick={() => {
          store.toggleFocus(node.id);
        }}
      >
        {store.getState().view.focusNodeId === node.id ? '返回完整地图' : '只看相关模块'}
      </button>

      <AnnotationComposer node={node} onCreate={onCreateAnnotation} />
      <AnnotationThreads
        annotations={annotations}
        requests={requests}
        proposals={proposals}
        hasGit={store.getState().map.capabilities?.hasGit ?? false}
        onOpenSource={onOpenSource}
        onResolve={onResolveAnnotation}
        onStartAnswer={onStartAnnotationAnswer}
        answeringAnnotationId={annotationRun.activeId}
        failedAnnotationId={annotationRun.failedId}
        onCopyTask={onCopyAnnotationTask}
        onApproveProposal={onApproveProposal}
        onStartApprovedChange={onStartApprovedChange}
        onRejectProposal={onRejectProposal}
        onCopyApprovedChangeTask={onCopyApprovedChangeTask}
        editingProposalId={editRun.activeId}
        failedProposalId={editRun.failedId}
      />
    </section>
  );
}

function annotationRunState(run: ReturnType<AppStore['getState']>['agentRun']): {
  activeId: Identifier | undefined;
  failedId: Identifier | undefined;
} {
  if (run?.purpose !== 'annotation_answer') return { activeId: undefined, failedId: undefined };
  return {
    activeId: ['starting', 'running', 'awaiting_input'].includes(run.state)
      ? run.annotationId
      : undefined,
    failedId: run.state === 'failed' ? run.annotationId : undefined,
  };
}

function approvedChangeRunState(run: ReturnType<AppStore['getState']>['agentRun']): {
  activeId: Identifier | undefined;
  failedId: Identifier | undefined;
} {
  if (run?.purpose !== 'approved_change') return { activeId: undefined, failedId: undefined };
  return {
    activeId: ['starting', 'running', 'awaiting_input'].includes(run.state)
      ? run.proposalId
      : undefined,
    failedId: run.state === 'failed' ? run.proposalId : undefined,
  };
}

function NodeEvidence({
  node,
  onOpenSource,
}: {
  readonly node: GraphNode;
  readonly onOpenSource: DetailsPanelProps['onOpenSource'];
}): React.JSX.Element {
  return (
    <>
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
          <h3>范围路径</h3>
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
    </>
  );
}

function AnnotationComposer({
  node,
  onCreate,
}: {
  readonly node: GraphNode;
  readonly onCreate: DetailsPanelProps['onCreateAnnotation'];
}): React.JSX.Element {
  const [type, setType] = useState<'note' | 'explain' | 'risk' | 'change'>('explain');
  const [body, setBody] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | undefined>();
  const [submittedMessage, setSubmittedMessage] = useState<string | undefined>();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const contextPaths = useMemo(
    () => [...new Set([...(node.paths ?? []), ...(node.locations ?? []).map((item) => item.path)])],
    [node],
  );
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const includedCount = contextPaths.length - excluded.size;

  const submit = (): void => {
    const trimmed = body.trim();
    if (trimmed === '') {
      setSubmittedMessage(undefined);
      setValidationMessage('请先写下希望 Agent 解释、记录或关注的内容。');
      bodyRef.current?.focus();
      bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    onCreate(type, trimmed, [node.id], [...excluded]);
    setBody('');
    setValidationMessage(undefined);
    setSubmittedMessage('标注已创建；已配置 Agent 时会在下方启动内部解释子线程。');
  };

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
          <option value="change">要求修改</option>
        </select>
      </label>
      <label>
        内容
        <textarea
          ref={bodyRef}
          value={body}
          maxLength={4000}
          rows={4}
          placeholder="写下问题或上下文…"
          aria-invalid={validationMessage !== undefined}
          aria-describedby="annotation-content-help"
          onChange={(event) => {
            setBody(event.currentTarget.value);
            if (event.currentTarget.value.trim() !== '') setValidationMessage(undefined);
            setSubmittedMessage(undefined);
          }}
        />
        <span id="annotation-content-help" className="annotation-composer__help">
          例如：为什么这个模块依赖数据层？这段职责是否仍然准确？
        </span>
      </label>
      {contextPaths.length > 0 && (
        <fieldset>
          <legend>
            随标注发送的路径（{includedCount}/{contextPaths.length}）
          </legend>
          <p className="annotation-composer__help">只发送路径名称，不发送源码内容。</p>
          <div className="annotation-composer__context-actions">
            <button
              type="button"
              className="chip"
              onClick={() => {
                setExcluded(new Set());
              }}
            >
              全选
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setExcluded(new Set(contextPaths));
              }}
            >
              全不选
            </button>
          </div>
          <div className="annotation-composer__context-list">
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
          </div>
        </fieldset>
      )}
      <p className="annotation-composer__permission">
        解释权限：受监控。此操作不会授权 Agent 修改代码或创建 ChangeSet。
      </p>
      <div className="annotation-composer__submit">
        {validationMessage !== undefined && (
          <p className="annotation-composer__validation" role="alert">
            {validationMessage}
          </p>
        )}
        {submittedMessage !== undefined && (
          <p className="annotation-composer__success" role="status">
            {submittedMessage}
          </p>
        )}
        <button type="button" className="chip chip--active" onClick={submit}>
          创建
          {type === 'explain'
            ? '解释'
            : type === 'risk'
              ? '风险'
              : type === 'change'
                ? '修改'
                : '备注'}
          标注
        </button>
      </div>
    </section>
  );
}
