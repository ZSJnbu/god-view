import type { HistoryFrameView } from '@god-view/webview-bridge';
import type { AppStore, HistoryReplayState, HistorySpeed } from '../app-store.js';
import { useAppState } from './use-app-state.js';

const speeds: readonly HistorySpeed[] = [0.5, 1, 2, 4];

function formatMoment(value: string): string {
  const parsed = new Date(value);
  // 提交时间来自 git，不保证能被解析；解析失败时如实显示原始字符串。
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Git 历史回放控制条。
 *
 * 回放的是**用户仓库自己的提交历史**，与「修改动画回放」（AI 本次对画布的补丁）
 * 是两条独立的时间线，因此有独立的区域、状态和进度。
 */
export function HistoryReplay(props: {
  readonly store: AppStore;
  readonly onRetry: () => void;
}): React.JSX.Element | null {
  const { store, onRetry } = props;
  const history = useAppState(store).history;
  if (history.status === 'idle') return null;
  if (history.status === 'loading' || history.status === 'error') {
    return <HistoryReplayNotice store={store} history={history} onRetry={onRetry} />;
  }

  return (
    <section className="history-replay" aria-label="项目历史回放">
      <HistoryReplaySummary history={history} />
      <label className="history-replay__progress">
        <span className="visually-hidden">历史进度</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, history.frameCount - 1)}
          step={1}
          value={history.index}
          aria-label="历史进度"
          onChange={(event) => {
            store.seekHistory(Number(event.target.value));
          }}
        />
      </label>
      <HistoryReplayActions store={store} history={history} />
    </section>
  );
}

/** 加载与失败态：不显示进度条，但保留重试与关闭入口。 */
function HistoryReplayNotice(props: {
  readonly store: AppStore;
  readonly history: HistoryReplayState;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const { store, history, onRetry } = props;
  return (
    <section className="history-replay" aria-label="项目历史回放">
      <div className="history-replay__summary">
        <strong>项目历史回放</strong>
        <span role="status">
          {history.status === 'loading'
            ? '正在读取 Git 提交历史…'
            : (history.message ?? '无法读取 Git 历史。')}
        </span>
      </div>
      <div className="history-replay__actions">
        {history.status === 'error' && (
          <button type="button" className="chip" onClick={onRetry}>
            重试
          </button>
        )}
        <button
          type="button"
          className="chip"
          onClick={() => {
            store.exitHistory();
          }}
        >
          关闭
        </button>
      </div>
    </section>
  );
}

function HistoryReplaySummary(props: { readonly history: HistoryReplayState }): React.JSX.Element {
  const { history } = props;
  return (
    <div className="history-replay__summary">
      <strong>
        {history.status === 'playing' ? '正在回放项目历史' : '项目历史回放'}
        <span className="history-replay__position">
          {' '}
          第 {history.index + 1} / {history.frameCount} 帧
        </span>
      </strong>
      {history.frame !== undefined && <HistoryFrameDetail frame={history.frame} />}
      <span className="history-replay__notes">{historyNotes(history)}</span>
    </div>
  );
}

function HistoryFrameDetail(props: { readonly frame: HistoryFrameView }): React.JSX.Element {
  const { frame } = props;
  return (
    <>
      <span className="history-replay__commit">
        {formatMoment(frame.committedAt)} · {frame.author} · {frame.subject}
      </span>
      <span className="history-replay__stats">
        {frame.shortSha} · +{frame.additions} / -{frame.deletions} · 当前 {frame.fileCount} 个文件
        {frame.commitCount > 1 ? ` · 本帧合并了 ${String(frame.commitCount)} 次提交` : ''}
      </span>
    </>
  );
}

/** 回放的边界必须说清楚：截断的提交、按目录推断的节点都不能被默认成完整事实。 */
function historyNotes(history: HistoryReplayState): string {
  const notes = [
    history.truncatedCommits > 0
      ? `仅回放最近的提交，更早的 ${String(history.truncatedCommits)} 次提交未包含在内。`
      : '已覆盖当前分支的全部提交。',
  ];
  if (history.derivedNodeCount > 0) {
    notes.push(
      `其中 ${String(history.derivedNodeCount)} 个节点按目录结构推断，不是 Agent 声明的模块。`,
    );
  }
  if (history.message !== undefined) notes.push(history.message);
  return notes.join(' ');
}

function HistoryReplayActions(props: {
  readonly store: AppStore;
  readonly history: HistoryReplayState;
}): React.JSX.Element {
  const { store, history } = props;
  const atEnd = history.index >= history.frameCount - 1;
  return (
    <div className="history-replay__actions">
      <label>
        速度
        <select
          aria-label="历史回放速度"
          value={String(history.speed)}
          onChange={(event) => {
            store.setHistorySpeed(Number(event.target.value) as HistorySpeed);
          }}
        >
          {speeds.map((speed) => (
            <option key={speed} value={String(speed)}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="chip"
        disabled={history.index === 0}
        onClick={() => {
          store.stepHistory(-1);
        }}
      >
        上一帧
      </button>
      {history.status === 'playing' ? (
        <button
          type="button"
          className="chip"
          onClick={() => {
            store.pauseHistory();
          }}
        >
          暂停
        </button>
      ) : (
        <button
          type="button"
          className="chip chip--active"
          onClick={() => {
            store.playHistory();
          }}
        >
          {atEnd ? '重新播放' : '播放'}
        </button>
      )}
      <button
        type="button"
        className="chip"
        disabled={atEnd}
        onClick={() => {
          store.stepHistory(1);
        }}
      >
        下一帧
      </button>
      <button
        type="button"
        className="chip"
        onClick={() => {
          store.exitHistory();
        }}
      >
        退出回放
      </button>
    </div>
  );
}
