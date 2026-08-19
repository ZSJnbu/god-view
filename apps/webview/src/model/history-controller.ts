import type { GraphEdge, GraphNode, Identifier } from '@god-view/protocol';
import type {
  HistoryFrameView,
  HistoryTimelineView,
  ViewCapabilities,
} from '@god-view/webview-bridge';
import {
  historyMapState,
  idleHistoryState,
  isHistoryActive,
  type HistoryReplayState,
  type HistorySpeed,
} from './history-playback.js';
import type { LayoutPositions, MapState } from './store.js';

const historyFrameDelayMs = 620;

/** 控制器写回状态的通道。它不认识整个 AppState，只能改与回放有关的字段。 */
export interface HistoryHost {
  readonly history: () => HistoryReplayState;
  readonly currentMap: () => MapState;
  readonly capabilities: () => ViewCapabilities | undefined;
  readonly apply: (patch: {
    readonly history: HistoryReplayState;
    readonly map?: MapState;
    readonly changedNodeIds?: readonly Identifier[];
    readonly changedEdgeIds?: readonly Identifier[];
    readonly selectedId?: undefined;
  }) => void;
  /** 退出回放后把画布还给权威地图。 */
  readonly restoreLiveMap: () => void;
}

/**
 * Git 历史回放控制器。
 *
 * 时间线、固定坐标和播放定时器都只存在这里；AppStore 只负责把它的输出并入应用状态。
 * 这样「AI 补丁回放」和「历史回放」各自拥有独立的定时器与真源，不会互相打断。
 */
export class HistoryReplayController {
  readonly #host: HistoryHost;
  #frames: readonly HistoryFrameView[] = [];
  #nodes: ReadonlyMap<Identifier, GraphNode> = new Map();
  #edges: readonly GraphEdge[] = [];
  #layout: LayoutPositions = {};
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: HistoryHost) {
    this.#host = host;
  }

  /** 用户点击「历史回放」：先进入加载态，时间线由扩展读取 Git 后推送回来。 */
  beginLoad(): void {
    this.cancelTimer();
    this.#host.apply({ history: { ...idleHistoryState, status: 'loading' } });
  }

  receiveTimeline(timeline: HistoryTimelineView): void {
    this.cancelTimer();
    this.#frames = timeline.frames;
    this.#nodes = new Map(timeline.nodes.map((node) => [node.id, node]));
    this.#edges = timeline.edges;
    this.#layout = {};
    if (timeline.frames.length === 0) {
      this.#host.apply({
        history: { ...idleHistoryState, status: 'error', message: '这个仓库没有可回放的提交。' },
      });
      return;
    }
    this.#host.apply({
      history: {
        ...idleHistoryState,
        status: 'ready',
        frameCount: timeline.frames.length,
        speed: this.#host.history().speed,
        truncatedCommits: timeline.truncatedCommits,
        derivedNodeCount: timeline.derivedNodeCount,
      },
      selectedId: undefined,
    });
    this.#showFrame(0, 'ready');
  }

  play(): void {
    if (this.#frames.length === 0) return;
    this.cancelTimer();
    // 减少动态效果时不自动连播：那正是用户要求关掉的东西。逐帧按钮仍然可用。
    if (this.#host.capabilities()?.reducedMotion === true) {
      this.#host.apply({
        history: {
          ...this.#host.history(),
          status: 'paused',
          message: '系统已开启「减少动态效果」，请使用上一帧 / 下一帧逐步查看。',
        },
      });
      return;
    }
    const current = this.#host.history().index;
    this.#showFrame(current >= this.#frames.length - 1 ? 0 : current, 'playing');
    this.#scheduleNextFrame();
  }

  pause(): void {
    if (this.#host.history().status !== 'playing') return;
    this.cancelTimer();
    this.#host.apply({ history: { ...this.#host.history(), status: 'paused' } });
  }

  step(delta: -1 | 1): void {
    if (this.#frames.length === 0) return;
    this.cancelTimer();
    this.#showFrame(this.#host.history().index + delta, 'paused');
  }

  /** 拖动进度条：直接跳到目标帧，播放状态保持不变。 */
  seek(index: number): void {
    if (this.#frames.length === 0) return;
    const status = this.#host.history().status === 'playing' ? 'playing' : 'paused';
    this.cancelTimer();
    this.#showFrame(index, status);
    if (status === 'playing') this.#scheduleNextFrame();
  }

  setSpeed(speed: HistorySpeed): void {
    this.#host.apply({ history: { ...this.#host.history(), speed } });
    if (this.#host.history().status !== 'playing') return;
    this.cancelTimer();
    this.#scheduleNextFrame();
  }

  /**
   * 记录整段历史的固定坐标。
   *
   * 位置由最终帧一次算出并全程复用：如果每帧重新布局，节点会随着邻居增减不停跳动，
   * 用户根本看不出「谁是新长出来的」。
   */
  setLayout(positions: LayoutPositions): void {
    this.#layout = { ...positions };
    if (!isHistoryActive(this.#host.history())) return;
    this.#host.apply({
      history: this.#host.history(),
      map: { ...this.#host.currentMap(), layout: this.#layout },
    });
  }

  /** 退出回放，回到权威地图。时间线保留在内存里，再次进入无需重新读 Git。 */
  exit(): void {
    this.cancelTimer();
    if (this.#host.history().status === 'idle') return;
    this.#host.apply({ history: idleHistoryState, selectedId: undefined });
    this.#host.restoreLiveMap();
  }

  /**
   * 最终帧的地图，用于一次性算出全程复用的固定坐标。
   *
   * 用最终帧而不是当前帧：只有终态才包含历史上出现过并存活到最后的全部节点，
   * 按它布局后，前面的帧只是逐个点亮同一批位置。
   */
  finalMap(): MapState | undefined {
    const last = this.#frames[this.#frames.length - 1];
    return last === undefined ? undefined : this.#mapState(last);
  }

  cancelTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #showFrame(index: number, status: 'ready' | 'playing' | 'paused'): void {
    const clamped = Math.min(Math.max(index, 0), this.#frames.length - 1);
    const frame = this.#frames[clamped];
    if (frame === undefined) return;
    const present = new Set(frame.presentNodeIds);
    this.#host.apply({
      map: this.#mapState(frame),
      changedNodeIds: frame.changedNodeIds.filter((id) => present.has(id)),
      changedEdgeIds: [],
      history: {
        ...this.#host.history(),
        status,
        index: clamped,
        frame,
        magnitudes: frame.magnitudes,
        message: undefined,
      },
    });
  }

  #mapState(frame: HistoryFrameView): MapState {
    return historyMapState({
      frame,
      nodes: this.#nodes,
      edges: this.#edges,
      layout: this.#layout,
      capabilities: this.#host.capabilities(),
    });
  }

  #scheduleNextFrame(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#host.history().status !== 'playing') return;
      const next = this.#host.history().index + 1;
      if (next >= this.#frames.length) {
        this.#host.apply({ history: { ...this.#host.history(), status: 'paused' } });
        return;
      }
      this.#showFrame(next, 'playing');
      this.#scheduleNextFrame();
    }, historyFrameDelayMs / this.#host.history().speed);
  }
}
