import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GuidedStoryStep, Identifier } from '@god-view/protocol';
import { activeStoryStep, type AppStore } from '../app-store.js';
import type { LayoutPositions } from '../model/store.js';
import type { LayoutClient } from '../layout/layout-client.js';
import { toLayoutRequest } from '../layout/layout-input.js';
import { buildVisibleGraph } from '../model/view-model.js';
import type {
  CytoscapeAdapter,
  GraphViewCallbacks,
  RelationHover,
} from '../graph/cytoscape-adapter.js';
import { useAppState } from './use-app-state.js';

export interface GraphCanvasProps {
  readonly store: AppStore;
  readonly layoutClient: LayoutClient;
  readonly createAdapter: (
    container: HTMLElement,
    callbacks: GraphViewCallbacks,
  ) => CytoscapeAdapter;
  readonly onOpenSource: (nodeId: Identifier) => void;
  readonly onPersistLayout: () => void;
}

/**
 * 画布宿主。
 *
 * React 只负责挂载容器与把派生数据交给适配器；节点位置、选择状态都不进入组件
 * 局部 state，避免出现第二份真源。
 */
export function GraphCanvas(props: GraphCanvasProps): React.JSX.Element {
  const state = useAppState(props.store);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<CytoscapeAdapter | null>(null);
  const storyRef = useRef<{
    readonly step: GuidedStoryStep | undefined;
    readonly reducedMotion: boolean;
  }>({ step: undefined, reducedMotion: false });
  const renderedGraphKeyRef = useRef<string | undefined>(undefined);
  const renderedViewKeyRef = useRef<string | undefined>(undefined);
  const renderedTopologyRevisionRef = useRef(0);
  const layoutCacheRef = useRef<{
    readonly graphKey: string;
    readonly layout: LayoutPositions;
    readonly topologyRevision: number;
    readonly positions: LayoutPositions;
  }>(undefined);
  const [relationHover, setRelationHover] = useState<RelationHover | undefined>();
  const { store, createAdapter, layoutClient, onOpenSource, onPersistLayout } = props;

  const callbacks = useMemo<GraphViewCallbacks>(
    () => ({
      onSelect: (id) => {
        store.select(id);
      },
      onActivate: (id) => {
        onOpenSource(id);
      },
      onPositionsChanged: (positions) => {
        store.rememberLayout(positions);
        onPersistLayout();
      },
      onRelationHover: setRelationHover,
    }),
    [store, onOpenSource, onPersistLayout],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    const adapter = createAdapter(container, callbacks);
    adapterRef.current = adapter;
    const onResize = (): void => {
      adapter.resize();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', onResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [createAdapter, callbacks]);

  // 事实校验、覆盖率和选择状态变化都不改变图结构，不能因此重新跑布局。
  const graphView = useMemo(
    () => ({
      level: state.view.level,
      ...(state.view.focusNodeId === undefined ? {} : { focusNodeId: state.view.focusNodeId }),
      ...(state.view.focusDepth === undefined ? {} : { focusDepth: state.view.focusDepth }),
    }),
    [state.view.level, state.view.focusNodeId, state.view.focusDepth],
  );
  const graph = useMemo(
    () => buildVisibleGraph(state.map, graphView),
    [state.map.nodes, state.map.edges, graphView],
  );
  const graphKey = useMemo(
    () =>
      [
        graphView.level,
        graphView.focusNodeId ?? '',
        String(graphView.focusDepth ?? ''),
        ...graph.nodes.map(({ node }) => node.id),
        ...graph.edges.map((edge) => `${edge.id}:${edge.from}:${edge.to}`),
      ].join('\n'),
    [graph, graphView],
  );
  const viewKey = `${graphView.level}\n${graphView.focusNodeId ?? ''}\n${String(graphView.focusDepth ?? '')}`;
  const storyStep = activeStoryStep(state);
  const reducedMotion = state.map.capabilities?.reducedMotion ?? false;
  storyRef.current = { step: storyStep, reducedMotion };

  useEffect(() => {
    const adapter = adapterRef.current;
    if (adapter === null || !state.map.hydrated) {
      return undefined;
    }
    let cancelled = false;
    const cached = layoutCacheRef.current;
    const cachedPositions =
      cached?.graphKey === graphKey &&
      cached.layout === state.map.layout &&
      cached.topologyRevision === state.topologyRevision
        ? cached.positions
        : undefined;
    void (cachedPositions === undefined
      ? layoutClient.compute(toLayoutRequest(graph, state.map.layout)).then((result) => {
          layoutCacheRef.current = {
            graphKey,
            layout: state.map.layout,
            topologyRevision: state.topologyRevision,
            positions: result.positions,
          };
          return result.positions;
        })
      : Promise.resolve(cachedPositions)
    ).then(async (positions) => {
      if (cancelled) {
        return;
      }
      const firstRender = renderedGraphKeyRef.current === undefined;
      const completed = await adapter.render(graph, {
        positions,
        selectedId: state.selectedId,
        reducedMotion: state.map.capabilities?.reducedMotion ?? false,
        topologyRevision: state.topologyRevision,
        changedNodeIds: state.changedNodeIds,
        changedEdgeIds: state.changedEdgeIds,
      });
      if (!completed) return;
      adapter.setStoryStep(storyRef.current.step, storyRef.current.reducedMotion);
      if (renderedTopologyRevisionRef.current !== state.topologyRevision) {
        renderedTopologyRevisionRef.current = state.topologyRevision;
        adapter.fit(!storyRef.current.reducedMotion);
      }
      // 只有初次呈现、切换层级或显式聚焦才适配镜头。地图补丁保留用户当前视口，
      // 节点增删由局部转场解释，避免整图突然缩放造成“其他模块消失”的错觉。
      if (renderedViewKeyRef.current !== viewKey || firstRender) {
        renderedViewKeyRef.current = viewKey;
        adapter.fit(!firstRender && !storyRef.current.reducedMotion);
      }
      renderedGraphKeyRef.current = graphKey;
    });
    return () => {
      cancelled = true;
    };
  }, [
    graph,
    graphKey,
    layoutClient,
    state.map.hydrated,
    state.map.layout,
    state.map.capabilities,
    state.topologyRevision,
    state.changedNodeIds,
    state.changedEdgeIds,
    viewKey,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (adapter === null) return;
    adapter.select(state.selectedId);
  }, [state.selectedId]);

  useEffect(() => {
    adapterRef.current?.setStoryStep(storyStep, reducedMotion);
  }, [storyStep, reducedMotion, state.map.revision]);

  useEffect(() => {
    if (state.viewportRevision > 0) adapterRef.current?.fit();
  }, [state.viewportRevision]);

  const fit = useCallback(() => {
    adapterRef.current?.fit();
  }, []);
  const renderedLineCount = graph.edges.length;
  const declaredRelationCount = graph.edges.reduce((total, edge) => total + edge.count, 0);

  return (
    <div className="canvas">
      <div
        className="canvas__surface"
        ref={containerRef}
        role="application"
        aria-label="项目地图"
      />
      <button className="canvas__fit" type="button" onClick={fit}>
        显示完整地图
      </button>
      <p className="canvas__summary" role="status">
        当前绘制 {graph.nodes.length} 个节点 · {renderedLineCount} 根连线
        {declaredRelationCount === renderedLineCount
          ? ''
          : `（汇总 ${String(declaredRelationCount)} 条关系）`}
      </p>
      <aside className="canvas__legend" aria-label="关系线说明">
        <strong>关系线</strong>
        <span>颜色跟随起点模块，箭头指向被调用或依赖方</span>
        <span>每条关系使用独立线槽，不与其他线重叠；拱桥表示交叉但不相连</span>
        <span>悬停连线查看关系类型与具体说明</span>
      </aside>
      {relationHover !== undefined && (
        <aside
          className="canvas__relation-tooltip"
          role="tooltip"
          style={{
            left: relationHover.x,
            top: relationHover.y,
            borderColor: relationHover.color,
          }}
        >
          <strong>{relationHover.title}</strong>
          <span>
            {relationHover.fromLabel} → {relationHover.toLabel}
          </span>
          <p>{relationHover.description}</p>
        </aside>
      )}
      {graph.clippedNodeCount > 0 && (
        <p className="canvas__notice" role="status">
          当前是局部视图：已隐藏 {graph.clippedNodeCount} 个节点。
        </p>
      )}
    </div>
  );
}
