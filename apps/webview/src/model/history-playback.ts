import type { GraphEdge, GraphNode, Identifier } from '@god-view/protocol';
import type { HistoryFrameView, ViewCapabilities } from '@god-view/webview-bridge';
import { emptyMapState, type LayoutPositions, type MapState } from './store.js';

/**
 * Git 历史回放的状态与投影。
 *
 * 与「修改动画回放」是两条独立的时间线：那个回放的是本次会话里 AI 对画布的补丁，
 * 这个回放的是用户仓库自己的提交历史。它们共享画布，但各自有状态、定时器和真源。
 */

export type HistorySpeed = 0.5 | 1 | 2 | 4;

export interface HistoryReplayState {
  readonly status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';
  readonly frameCount: number;
  readonly index: number;
  readonly speed: HistorySpeed;
  /** 当前帧对应的提交信息；未进入回放时为 undefined。 */
  readonly frame: HistoryFrameView | undefined;
  /** 节点规模（累计代码行 + 文件数），供画布把体量画出来。 */
  readonly magnitudes: Readonly<Record<Identifier, number>>;
  /** 超出回放窗口的更早提交数，必须如实告诉用户回放不完整。 */
  readonly truncatedCommits: number;
  /** 按目录推断出来的节点数，不能展示成 Agent 声明结果。 */
  readonly derivedNodeCount: number;
  readonly message: string | undefined;
}

export const idleHistoryState: HistoryReplayState = {
  status: 'idle',
  frameCount: 0,
  index: 0,
  speed: 1,
  frame: undefined,
  magnitudes: {},
  truncatedCommits: 0,
  derivedNodeCount: 0,
  message: undefined,
};

/** 历史回放是否正在占用画布。加载中与出错时画布仍属于权威地图。 */
export function isHistoryActive(history: HistoryReplayState): boolean {
  return history.status === 'ready' || history.status === 'playing' || history.status === 'paused';
}

/**
 * 把一帧投影成可渲染的地图。
 *
 * 历史地图是派生视图：它不共享权威地图的版本线，也不写回权威地图，
 * 因此退出回放后 live 状态完全不受影响。
 */
export function historyMapState(input: {
  readonly frame: HistoryFrameView;
  readonly nodes: ReadonlyMap<Identifier, GraphNode>;
  readonly edges: readonly GraphEdge[];
  readonly layout: LayoutPositions;
  readonly capabilities: ViewCapabilities | undefined;
}): MapState {
  const present = new Set(input.frame.presentNodeIds);
  const nodes = new Map<Identifier, GraphNode>();
  for (const id of input.frame.presentNodeIds) {
    const node = input.nodes.get(id);
    if (node !== undefined) nodes.set(id, node);
  }
  const edges = new Map<Identifier, GraphEdge>(
    input.edges
      .filter((edge) => present.has(edge.from) && present.has(edge.to))
      .map((edge) => [edge.id, edge]),
  );
  return {
    ...emptyMapState,
    // 帧序号当作图版本：历史地图与权威地图各自计数，互不干扰。
    revision: input.frame.index + 1,
    nodes,
    edges,
    capabilities: input.capabilities,
    layout: input.layout,
    hydrated: true,
  };
}
