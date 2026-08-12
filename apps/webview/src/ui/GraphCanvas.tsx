import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { GuidedStoryStep, Identifier } from '@god-view/protocol';
import { activeStoryStep, type AppStore } from '../app-store.js';
import type { LayoutClient } from '../layout/layout-client.js';
import { toLayoutRequest } from '../layout/layout-input.js';
import { buildVisibleGraph } from '../model/view-model.js';
import type { CytoscapeAdapter, GraphViewCallbacks } from '../graph/cytoscape-adapter.js';
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
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [createAdapter, callbacks]);

  const graph = useMemo(() => buildVisibleGraph(state.map, state.view), [state.map, state.view]);
  const storyStep = activeStoryStep(state);
  const reducedMotion = state.map.capabilities?.reducedMotion ?? false;
  storyRef.current = { step: storyStep, reducedMotion };

  useEffect(() => {
    const adapter = adapterRef.current;
    if (adapter === null || !state.map.hydrated) {
      return undefined;
    }
    let cancelled = false;
    void layoutClient.compute(toLayoutRequest(graph, state.map.layout)).then((result) => {
      if (cancelled) {
        return;
      }
      adapter.render(graph, {
        positions: result.positions,
        selectedId: state.selectedId,
        reducedMotion: state.map.capabilities?.reducedMotion ?? false,
      });
      adapter.setStoryStep(storyRef.current.step, storyRef.current.reducedMotion);
    });
    return () => {
      cancelled = true;
    };
  }, [
    graph,
    layoutClient,
    state.map.hydrated,
    state.map.layout,
    state.map.capabilities,
    state.selectedId,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (adapter === null || state.selectedId === undefined) {
      return;
    }
    adapter.focus(state.selectedId, state.map.capabilities?.reducedMotion ?? false);
  }, [state.selectedId, state.map.capabilities]);

  useEffect(() => {
    adapterRef.current?.setStoryStep(storyStep, reducedMotion);
  }, [storyStep, reducedMotion, state.map.revision]);

  const fit = useCallback(() => {
    adapterRef.current?.fit();
  }, []);

  return (
    <div className="canvas">
      <div
        className="canvas__surface"
        ref={containerRef}
        role="application"
        aria-label="项目地图"
      />
      <button className="canvas__fit" type="button" onClick={fit}>
        适应窗口
      </button>
      {graph.clippedNodeCount > 0 && (
        <p className="canvas__notice" role="status">
          聚焦模式：另有 {graph.clippedNodeCount} 个节点未绘制，搜索仍然可以命中它们。
        </p>
      )}
    </div>
  );
}
