import { useMemo } from 'react';
import type { AppStore } from '../app-store.js';
import { buildVisibleGraph } from '../model/view-model.js';
import { useAppState } from './use-app-state.js';

const levelCopy = {
  overview: {
    name: '分组概览',
    detail: '把模块折叠到所属分组，适合快速认识项目的主要区域。',
  },
  modules: {
    name: '模块关系图',
    detail: '显示模块及其关系。点击模块可在右侧查看职责、文件路径和标注。',
  },
  files: {
    name: '文件关系图',
    detail: '把 Agent 单独声明的文件画成节点；它是关系图，不是文件列表。',
  },
} as const;

export function ViewContext({ store }: { readonly store: AppStore }): React.JSX.Element {
  const state = useAppState(store);
  const graph = useMemo(
    () => buildVisibleGraph(state.map, state.view),
    [state.map.nodes, state.map.edges, state.view],
  );
  const focus =
    state.view.focusNodeId === undefined
      ? undefined
      : (state.map.nodes.get(state.view.focusNodeId)?.label ?? state.view.focusNodeId);
  const copy = levelCopy[state.view.level];

  return (
    <nav
      className={`view-context${focus === undefined ? '' : ' view-context--focused'}`}
      aria-label="当前地图视图"
    >
      <div>
        <strong>{focus === undefined ? copy.name : `局部视图：${focus}`}</strong>
        <span>
          {focus === undefined
            ? copy.detail
            : `只显示 ${String(state.view.focusDepth ?? 1)} 层相关模块；已隐藏 ${String(graph.clippedNodeCount)} 个节点。`}
        </span>
      </div>
      <span className="view-context__count">
        当前绘制 {graph.nodes.length} 个图形 · 地图共 {state.map.nodes.size} 个声明节点
      </span>
      <button
        type="button"
        className={
          focus === undefined && state.view.level === 'modules' ? 'chip' : 'chip chip--active'
        }
        onClick={() => {
          store.showFullMap();
        }}
      >
        返回模块关系图
      </button>
    </nav>
  );
}
