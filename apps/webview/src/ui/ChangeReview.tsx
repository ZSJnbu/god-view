import { useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { CompletedChange, WorkspacePath } from '@god-view/protocol';
import type { AppStore } from '../app-store.js';
import { useAppState } from './use-app-state.js';

// eslint-disable-next-line complexity -- Diff、扩围审批和历史审查共享同一个可拖动面板。
export function ChangeReview({
  store,
  onOpenDiff,
  onReview,
  onInterrupt,
  onScopeExpansionDecision,
}: {
  readonly store: AppStore;
  readonly onOpenDiff: (path: WorkspacePath) => void;
  readonly onReview: (
    changeSetId: string,
    status: 'accepted' | 'accepted_with_issues',
    note?: string,
  ) => void;
  readonly onInterrupt: (changeSetId: string) => void;
  readonly onScopeExpansionDecision: (
    changeSetId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ) => void;
}): React.JSX.Element | null {
  const state = useAppState(store);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
  const [position, setPosition] = useState<ReviewPosition>();
  const active = [...state.map.activeChanges.values()][0];
  const history = [...state.map.completedChanges.values()].sort((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  );
  const completed = history.find((entry) => entry.changeSetId === selectedHistoryId) ?? history[0];
  const change = active ?? completed;
  const pendingScopeRequests =
    active?.scopeExpansionRequests?.filter((request) => request.status === 'pending') ?? [];
  if (change === undefined || (change.diff === undefined && pendingScopeRequests.length === 0))
    return null;
  const hasChangeSetOutsideScope =
    change.diff?.files.some(
      (file) => file.scopeStatus === 'outside_scope' && file.attribution !== 'preexisting_overlap',
    ) ?? false;
  const drag = (event: ReactPointerEvent<HTMLElement>): void => {
    const panel = event.currentTarget.closest<HTMLElement>('.change-review');
    if (panel === null) return;
    const bounds = panel.getBoundingClientRect();
    beginReviewDrag(event, bounds, setPosition);
  };
  const moveByKeyboard = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const step = event.shiftKey ? 40 : 12;
    const delta: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const movement = delta[event.key];
    if (movement === undefined) return;
    const panel = event.currentTarget.closest<HTMLElement>('.change-review');
    if (panel === null) return;
    event.preventDefault();
    const bounds = panel.getBoundingClientRect();
    setPosition(
      clampReviewPosition({ x: bounds.left + movement[0], y: bounds.top + movement[1] }, bounds),
    );
  };
  const panelStyle: CSSProperties | undefined =
    position === undefined
      ? undefined
      : { left: position.x, top: position.y, right: 'auto', bottom: 'auto' };
  return (
    <aside className="change-review" aria-label="ChangeSet Diff 审查" style={panelStyle}>
      <header
        role="toolbar"
        aria-label="ChangeSet Diff 拖动标题栏"
        tabIndex={0}
        title="按住并拖动面板；方向键微调位置，Shift + 方向键快速移动"
        onPointerDown={drag}
        onKeyDown={moveByKeyboard}
      >
        <span className="change-review__grip" aria-hidden="true">
          ⠿
        </span>
        <strong>ChangeSet Diff</strong>
        <span>
          {change.diff === undefined
            ? '等待范围审批'
            : `${String(change.diff.files.length)} 个文件 · +${String(change.diff.additions)} / -${String(change.diff.deletions)}`}
        </span>
      </header>
      {pendingScopeRequests.map((request) => (
        <section className="scope-expansion-card" key={request.id}>
          <strong>原生 Agent 申请扩大 ChangeSet 范围</strong>
          <p>{request.reason}</p>
          <p>{request.requestedFiles.join('、')}</p>
          <div className="annotation-thread__actions">
            <button
              type="button"
              className="chip chip--active"
              onClick={() => {
                onScopeExpansionDecision(active?.changeSetId ?? '', request.id, 'approved');
              }}
            >
              批准并继续
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                onScopeExpansionDecision(active?.changeSetId ?? '', request.id, 'rejected');
              }}
            >
              拒绝扩围
            </button>
          </div>
          <small>
            审批会写入权威 ChangeSet；Agent 可在原生终端中继续，无需 God View 恢复会话。
          </small>
        </section>
      ))}
      {change.diff !== undefined && (
        <ul>
          {change.diff.files.map((file) => (
            <li
              key={file.path}
              data-scope={
                file.attribution === 'preexisting_overlap' ? 'preexisting' : file.scopeStatus
              }
            >
              <button
                type="button"
                onClick={() => {
                  onOpenDiff(file.path);
                }}
              >
                {file.status} · {file.path}
              </button>
              <span>
                +{file.additions} / -{file.deletions} ·{' '}
                {scopeLabel(file.scopeStatus, file.attribution)} ·{' '}
                {attributionLabel(file.attribution)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {change.diff !== undefined && (
        <small>God View 仅保存路径、统计和哈希；源码内容由 VS Code 原生 Git Diff 打开。</small>
      )}
      <MapImpact completed={completed} />
      {active === undefined && history.length > 0 && (
        <details className="change-review__history">
          <summary>ChangeSet 历史（{history.length}）</summary>
          <ol>
            {history.map((entry) => (
              <li key={entry.changeSetId}>
                <button
                  type="button"
                  aria-pressed={entry.changeSetId === change.changeSetId}
                  onClick={() => {
                    setSelectedHistoryId(entry.changeSetId);
                  }}
                >
                  <span>{entry.changeSetId}</span>
                  <small>
                    {changeStatusLabel(entry.status)} · {formatTimestamp(entry.completedAt)} ·{' '}
                    {entry.actualFiles.length} 个文件
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {active !== undefined && (
        <button
          type="button"
          className="chip"
          onClick={() => {
            onInterrupt(active.changeSetId);
          }}
        >
          停止并保留 Diff
        </button>
      )}
      {completed?.status === 'pending_review' && (
        <div className="annotation-thread__actions">
          {!hasChangeSetOutsideScope && (
            <button
              type="button"
              className="chip chip--active"
              onClick={() => {
                onReview(completed.changeSetId, 'accepted');
              }}
            >
              接受结果
            </button>
          )}
          <button
            type="button"
            className="chip"
            onClick={() => {
              onReview(
                completed.changeSetId,
                'accepted_with_issues',
                '用户确认保留当前 Diff，但验证仍有问题',
              );
            }}
          >
            带问题接受
          </button>
        </div>
      )}
    </aside>
  );
}

interface ReviewPosition {
  readonly x: number;
  readonly y: number;
}

function clampReviewPosition(
  position: ReviewPosition,
  bounds: Pick<DOMRect, 'width' | 'height'>,
): ReviewPosition {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(window.innerWidth - bounds.width - margin, position.x)),
    y: Math.max(margin, Math.min(window.innerHeight - bounds.height - margin, position.y)),
  };
}

function beginReviewDrag(
  event: ReactPointerEvent<HTMLElement>,
  bounds: DOMRect,
  onMove: (position: ReviewPosition) => void,
): void {
  event.preventDefault();
  const target = event.currentTarget;
  const start = { x: event.clientX, y: event.clientY };
  target.setPointerCapture(event.pointerId);
  const move = (nextEvent: PointerEvent): void => {
    onMove(
      clampReviewPosition(
        {
          x: bounds.left + nextEvent.clientX - start.x,
          y: bounds.top + nextEvent.clientY - start.y,
        },
        bounds,
      ),
    );
  };
  const end = (nextEvent: PointerEvent): void => {
    if (target.hasPointerCapture(nextEvent.pointerId)) {
      target.releasePointerCapture(nextEvent.pointerId);
    }
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

function scopeLabel(
  scopeStatus: 'approved' | 'outside_scope',
  attribution: 'change_set' | 'preexisting_overlap' | 'unknown_external',
): string {
  if (scopeStatus === 'approved') return '批准范围内';
  return attribution === 'preexisting_overlap' ? '任务前已有' : '越界';
}

function attributionLabel(
  attribution: 'change_set' | 'preexisting_overlap' | 'unknown_external',
): string {
  const labels = {
    change_set: '本 ChangeSet',
    preexisting_overlap: '不影响本次验收',
    unknown_external: '来源不明的外部写入',
  } as const;
  return labels[attribution];
}

function MapImpact({
  completed,
}: {
  readonly completed: CompletedChange | undefined;
}): React.JSX.Element {
  if (completed === undefined) return <></>;
  const hasNodes = (completed.touchedNodeIds?.length ?? 0) > 0;
  const hasEdges = (completed.touchedEdgeIds?.length ?? 0) > 0;
  return (
    <>
      {completed.note !== undefined && (
        <p className="change-review__summary">
          <strong>变更说明：</strong>
          {completed.note}
        </p>
      )}
      {(hasNodes || hasEdges) && (
        <section className="change-review__map-impact" aria-label="地图同步结果">
          <strong>地图同步结果</strong>
          {hasNodes && <p>更新模块：{completed.touchedNodeIds?.join('、')}</p>}
          {hasEdges && <p>更新关系：{completed.touchedEdgeIds?.join('、')}</p>}
        </section>
      )}
    </>
  );
}

function changeStatusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    pending_review: '待验收',
    accepted: '已接受',
    accepted_with_issues: '带问题接受',
    interrupted: '已中断',
    failed: '失败',
  };
  return labels[status] ?? status;
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
}
