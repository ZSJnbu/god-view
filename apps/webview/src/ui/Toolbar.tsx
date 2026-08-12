import type { AppStore } from '../app-store.js';
import type { DetailLevel } from '../model/view-model.js';
import { useAppState } from './use-app-state.js';

const levels: readonly { readonly id: DetailLevel; readonly label: string }[] = [
  { id: 'overview', label: '远景 · 分组' },
  { id: 'modules', label: '中景 · 模块' },
  { id: 'files', label: '近景 · 文件' },
];

export interface ToolbarProps {
  readonly store: AppStore;
}

export function Toolbar({ store }: ToolbarProps): React.JSX.Element {
  const state = useAppState(store);
  const capabilities = state.map.capabilities;

  return (
    <header className="toolbar">
      <div className="toolbar__group" role="radiogroup" aria-label="细节层级">
        {levels.map((level) => (
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

      {state.view.focusNodeId !== undefined && (
        <div className="toolbar__group" aria-label="聚焦深度">
          {([1, 2] as const).map((depth) => (
            <button
              key={depth}
              type="button"
              className={state.view.focusDepth === depth ? 'chip chip--active' : 'chip'}
              onClick={() => {
                store.setFocusDepth(depth);
              }}
            >
              {depth} 层邻域
            </button>
          ))}
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

      <span className="toolbar__branch" title="地图按分支隔离">
        {capabilities?.hasGit === true ? capabilities.branchKey : '无 Git 工作区'}
      </span>
    </header>
  );
}
