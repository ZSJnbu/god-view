import type { AppStore } from '../app-store.js';
import { buildVisibleGraph, type DetailLevel } from '../model/view-model.js';
import { useAppState } from './use-app-state.js';

const levels: readonly { readonly id: DetailLevel; readonly label: string }[] = [
  { id: 'overview', label: '分组概览' },
  { id: 'modules', label: '模块关系图' },
  { id: 'files', label: '文件关系图' },
];

function graphSignature(store: AppStore, level: DetailLevel): string {
  const graph = buildVisibleGraph(store.getState().map, { level });
  return graph.nodes
    .map(({ node }) => node.id)
    .sort()
    .join('\n');
}

export interface ToolbarProps {
  readonly store: AppStore;
  readonly onReinitialize: () => void;
  readonly onTopologicalSort: () => void;
  readonly onCompleteLevel: (target: 'groups' | 'files') => void;
  readonly topologicalSortBusy: boolean;
  readonly hasConfiguredAgent: boolean;
}

export function Toolbar({
  store,
  onReinitialize,
  onTopologicalSort,
  onCompleteLevel,
  topologicalSortBusy,
  hasConfiguredAgent,
}: ToolbarProps): React.JSX.Element {
  const state = useAppState(store);
  const capabilities = state.map.capabilities;
  const moduleSignature = graphSignature(store, 'modules');
  const usefulLevels = levels.filter(
    ({ id }) => id === 'modules' || graphSignature(store, id) !== moduleSignature,
  );
  const missingLevels = levels.filter(
    ({ id }) => id !== 'modules' && graphSignature(store, id) === moduleSignature,
  );
  const agentTaskBusy =
    state.map.activeChanges.size > 0 ||
    (state.agentRun !== undefined &&
      ['starting', 'running', 'awaiting_input'].includes(state.agentRun.state));

  return (
    <header className="toolbar">
      <div className="toolbar__level">
        <span className="toolbar__level-label">绘图层级</span>
        <div className="toolbar__group" role="radiogroup" aria-label="绘图层级">
          {usefulLevels.map((level) => (
            <button
              key={level.id}
              type="button"
              role="radio"
              aria-checked={state.view.level === level.id}
              className={state.view.level === level.id ? 'chip chip--active' : 'chip'}
              onClick={() => {
                store.setLevel(level.id);
              }}
            >
              {level.label}
            </button>
          ))}
        </div>
        {missingLevels.map((level) => (
          <button
            key={`complete-${level.id}`}
            type="button"
            className="chip chip--completion"
            disabled={agentTaskBusy}
            title={
              level.id === 'overview'
                ? '当前地图没有独立分组层级；让 Agent 基于现有模块增量补全'
                : '当前地图没有独立文件节点；让 Agent 补充关键文件关系，不会平铺全部文件'
            }
            onClick={() => {
              onCompleteLevel(level.id === 'overview' ? 'groups' : 'files');
            }}
          >
            ＋ AI 补全{level.id === 'overview' ? '分组层级' : '关键文件关系'}
          </button>
        ))}
      </div>

      <label className="toolbar__search">
        <span className="visually-hidden">搜索节点</span>
        <input
          type="search"
          placeholder="搜索模块、职责或路径"
          value={state.view.query ?? ''}
          onChange={(event) => {
            store.setQuery(event.target.value);
          }}
        />
      </label>

      <button
        type="button"
        className="chip chip--topology"
        disabled={topologicalSortBusy}
        title="按依赖方向重新排列全部模块，尽量减少关系交叉并绕开模块"
        onClick={onTopologicalSort}
      >
        {topologicalSortBusy ? '正在整理…' : '拓扑排序'}
      </button>

      {state.view.focusNodeId !== undefined && (
        <div className="toolbar__group toolbar__focus" aria-label="局部视图范围">
          {([1, 2] as const).map((depth) => (
            <button
              key={depth}
              type="button"
              className={state.view.focusDepth === depth ? 'chip chip--active' : 'chip'}
              onClick={() => {
                store.setFocusDepth(depth);
              }}
            >
              相关 {depth} 层
            </button>
          ))}
          <button
            type="button"
            className="chip"
            onClick={() => {
              store.clearFocus();
            }}
          >
            退出局部视图
          </button>
        </div>
      )}

      {/* 外部 Agent 通过批准令牌启动；扩展没有主动调用执行器，因此这里保持禁用。 */}
      <button
        type="button"
        className="chip"
        disabled={capabilities?.canExecuteChanges !== true}
        title={
          capabilities?.canExecuteChanges === true
            ? '执行已批准的修改'
            : '当前为 MCP 引导调用：请把已批准任务交给 Agent 执行'
        }
      >
        执行修改
      </button>

      <button
        type="button"
        className="chip"
        disabled={agentTaskBusy}
        title={
          state.map.activeChanges.size > 0
            ? '已有进行中的 ChangeSet，请先完成或停止它'
            : hasConfiguredAgent
              ? '根据当前仓库状态重新分析并完整重绘项目地图'
              : '先配置可用 Agent，再重新初始化'
        }
        onClick={onReinitialize}
      >
        {hasConfiguredAgent ? '重新初始化' : '配置 Agent 后重绘'}
      </button>

      <span className="toolbar__branch" title="地图按分支隔离">
        {capabilities?.hasGit === true ? capabilities.branchKey : '无 Git 工作区'}
      </span>
    </header>
  );
}
