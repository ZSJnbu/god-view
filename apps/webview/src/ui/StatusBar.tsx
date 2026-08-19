import type { ActiveChange, CoverageReport, DriftFinding } from '@god-view/protocol';
import type { SyncState } from '@god-view/webview-bridge';
import { isHistoryActive, type AppStore } from '../app-store.js';
import { useAppState } from './use-app-state.js';

const syncLabels: Record<SyncState, string> = {
  idle: '已同步',
  receiving: '接收中',
  validating: '校验中',
  degraded: '降级运行',
};

export interface StatusBarProps {
  readonly store: AppStore;
}

/**
 * 状态栏。
 *
 * 覆盖率的分母是插件生成的第一方文件清单，不是 Agent 自报的节点数
 * （TECHNICAL_ARCHITECTURE.md §12）。未分类文件必须显式可见，不能被静默忽略。
 */
export function StatusBar({ store }: StatusBarProps): React.JSX.Element {
  const state = useAppState(store);
  return (
    <footer className="status" aria-label="同步与覆盖率">
      <span className={`status__sync status__sync--${state.sync}`}>{syncLabels[state.sync]}</span>
      {isHistoryActive(state.history) ? (
        // 历史帧是过去的仓库状态：当前版本号、覆盖率与漂移都不适用于它，不能顺手展示。
        <span role="status">
          历史回放 · 第 {state.history.index + 1} / {state.history.frameCount} 帧（覆盖率与漂移只对
          当前工作区有效，回放期间不显示）
        </span>
      ) : (
        <>
          <span>版本 r{state.map.revision}</span>
          <CoverageSummary coverage={state.map.coverage} />
          <DriftSummary drift={state.map.drift} />
          <ChangeSummary changes={[...state.map.activeChanges.values()]} />
        </>
      )}
      {state.lastError !== undefined && (
        <span className="status__error" role="alert">
          {state.lastError.code}：{state.lastError.message}
          <button
            type="button"
            onClick={() => {
              store.dismissError();
            }}
          >
            知道了
          </button>
        </span>
      )}
    </footer>
  );
}

function ChangeSummary({
  changes,
}: {
  readonly changes: readonly ActiveChange[];
}): React.JSX.Element | null {
  const change = changes[0];
  if (change === undefined) return null;
  const files = change.diff?.files.length ?? 0;
  return (
    <span
      className={change.executionStatus === 'scope_violation' ? 'status__error' : 'status__drift'}
      role="status"
    >
      ChangeSet {change.executionStatus ?? 'in_progress'} · {files} 个文件
      {change.diff === undefined
        ? ''
        : ` · +${String(change.diff.additions)} / -${String(change.diff.deletions)}`}
    </span>
  );
}

function CoverageSummary({
  coverage,
}: {
  readonly coverage: CoverageReport | undefined;
}): React.JSX.Element {
  if (coverage === undefined) {
    return <span>覆盖率待计算</span>;
  }
  const total = coverage.classified + coverage.unclassified;
  const percent = total === 0 ? 0 : Math.round((coverage.classified / total) * 100);
  return (
    <span
      title={`已分类 ${String(coverage.classified)} / 纳入范围 ${String(total)}，另有 ${String(coverage.excluded)} 个文件被排除`}
    >
      覆盖率 {percent}%（未分类 {coverage.unclassified}）
    </span>
  );
}

function DriftSummary({
  drift,
}: {
  readonly drift: readonly DriftFinding[];
}): React.JSX.Element | null {
  if (drift.length === 0) {
    return null;
  }
  const missing = drift.filter((finding) => finding.kind === 'missing_file').length;
  return (
    <span className="status__drift" role="status">
      漂移 {drift.length} 项{missing > 0 ? `（缺失文件 ${String(missing)}）` : ''}
    </span>
  );
}
