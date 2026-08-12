import { useState } from 'react';
import type { WorkspacePath } from '@god-view/protocol';
import type { AppStore } from '../app-store.js';
import { useAppState } from './use-app-state.js';

export function ChangeReview({
  store,
  onOpenDiff,
  onReview,
  onInterrupt,
}: {
  readonly store: AppStore;
  readonly onOpenDiff: (path: WorkspacePath) => void;
  readonly onReview: (
    changeSetId: string,
    status: 'accepted' | 'accepted_with_issues',
    note?: string,
  ) => void;
  readonly onInterrupt: (changeSetId: string) => void;
}): React.JSX.Element | null {
  const state = useAppState(store);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
  const active = [...state.map.activeChanges.values()][0];
  const history = [...state.map.completedChanges.values()].sort((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  );
  const completed = history.find((entry) => entry.changeSetId === selectedHistoryId) ?? history[0];
  const change = active ?? completed;
  if (change?.diff === undefined) return null;
  const hasOutsideScope = change.diff.files.some((file) => file.scopeStatus === 'outside_scope');
  return (
    <aside className="change-review" aria-label="ChangeSet Diff 审查">
      <header>
        <strong>ChangeSet Diff</strong>
        <span>
          {change.diff.files.length} 个文件 · +{change.diff.additions} / -{change.diff.deletions}
        </span>
      </header>
      <ul>
        {change.diff.files.map((file) => (
          <li key={file.path} data-scope={file.scopeStatus}>
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
              {file.scopeStatus === 'approved' ? '批准范围内' : '越界'} ·{' '}
              {file.attribution === 'preexisting_overlap' ? '与任务前改动重叠' : '本 ChangeSet'}
            </span>
          </li>
        ))}
      </ul>
      <small>God View 仅保存路径、统计和哈希；源码内容由 VS Code 原生 Git Diff 打开。</small>
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
          {!hasOutsideScope && (
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
