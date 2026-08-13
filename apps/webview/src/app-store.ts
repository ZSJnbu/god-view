import type { GuidedStory, GuidedStoryStep, Identifier } from '@god-view/protocol';
import type {
  AgentConfigurationView,
  AgentConversationView,
  AgentPaneView,
  AgentRunView,
  ConfigurableAgent,
  ExtensionEvent,
  SyncState,
} from '@god-view/webview-bridge';
import {
  applyFacts,
  applyLayout,
  applyPatch,
  applySnapshot,
  emptyMapState,
  type LayoutPositions,
  type MapState,
} from './model/store.js';
import type { DetailLevel, ViewOptions } from './model/view-model.js';
import { resolveVisibleAnchor } from './model/view-model.js';

export interface AppState {
  readonly map: MapState;
  readonly view: ViewOptions;
  readonly selectedId: Identifier | undefined;
  readonly sync: SyncState;
  readonly lastError: { readonly code: string; readonly message: string } | undefined;
  readonly story: StoryPlayback;
  readonly agents: readonly AgentConfigurationView[];
  readonly selectedAgent: ConfigurableAgent | undefined;
  readonly agentRun: AgentRunView | undefined;
  readonly agentConversation: AgentConversationView | undefined;
  readonly agentPaneHeight: number;
  readonly agentPaneView: AgentPaneView;
  readonly changedNodeIds: readonly Identifier[];
  readonly changedEdgeIds: readonly Identifier[];
  /** 用户显式要求恢复全图时递增；只触发 viewport fit，不改变图结构。 */
  readonly viewportRevision: number;
  /** 用户点击拓扑排序后递增；让画布在节点移动完成后再适配全图。 */
  readonly topologyRevision: number;
  readonly playback: MapPlaybackState;
}

export interface MapPlaybackState {
  readonly status: 'live' | 'playing' | 'paused';
  readonly authoritativeRevision: number;
  readonly renderedRevision: number;
  readonly pendingCount: number;
  readonly sessionFrameCount: number;
  readonly replaying: boolean;
  readonly speed: 0.5 | 1 | 2;
}

export type StorySpeed = 0.5 | 1 | 1.5 | 2;
export interface StoryPlayback {
  readonly activeStoryId: Identifier | undefined;
  readonly stepIndex: number;
  readonly status: 'idle' | 'playing' | 'paused';
  readonly speed: StorySpeed;
}

const initialAppState: AppState = {
  map: emptyMapState,
  view: { level: 'modules' },
  selectedId: undefined,
  sync: 'idle',
  lastError: undefined,
  story: { activeStoryId: undefined, stepIndex: 0, status: 'idle', speed: 1 },
  agents: [],
  selectedAgent: undefined,
  agentRun: undefined,
  agentConversation: undefined,
  agentPaneHeight: 200,
  agentPaneView: {
    mode: 'docked',
    floatingBounds: { x: 160, y: 120, width: 720, height: 460 },
  },
  changedNodeIds: [],
  changedEdgeIds: [],
  viewportRevision: 0,
  topologyRevision: 0,
  playback: playbackState(0),
};

type Listener = () => void;
type MapSnapshotEvent = Extract<ExtensionEvent, { type: 'map/snapshot' }>;
type MapPatchEvent = Extract<ExtensionEvent, { type: 'map/patch' }>;
const playbackFrameDelayMs = 720;
const maximumSessionFrames = 200;

/**
 * 应用状态容器。
 *
 * React 组件通过 `useSyncExternalStore` 订阅这里，不持有业务真源；
 * Cytoscape 只消费派生出来的可见图（TECHNICAL_ARCHITECTURE.md §10.1）。
 */
export class AppStore {
  #state: AppState = initialAppState;
  readonly #listeners = new Set<Listener>();
  #authoritativeMap: MapState = emptyMapState;
  #pendingPatches: MapPatchEvent[] = [];
  #sessionFrames: MapPatchEvent[] = [];
  #sessionBaseline: MapState | undefined;
  #sessionRunId: string | undefined;
  #playbackTimer: ReturnType<typeof setTimeout> | undefined;

  getState = (): AppState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** 处理扩展事件。未知事件在 messaging 层已被拒绝，这里只处理合法类型。 */
  receive(event: ExtensionEvent): void {
    switch (event.type) {
      case 'map/snapshot':
        this.#receiveMapSnapshot(event);
        return;
      case 'map/patch':
        this.#receiveMapPatch(event);
        return;
      case 'map/facts':
        // 图没变、只有事实变了：不能走补丁路径，那条路径按图版本排序会丢弃它。
        this.#authoritativeMap = applyFacts(this.#authoritativeMap, {
          factsRevision: event.factsRevision,
          drift: event.drift,
          ...(event.coverage === undefined ? {} : { coverage: event.coverage }),
        });
        this.#set({
          map: applyFacts(this.#state.map, {
            factsRevision: event.factsRevision,
            drift: event.drift,
            ...(event.coverage === undefined ? {} : { coverage: event.coverage }),
          }),
          sync: 'idle',
        });
        return;
      case 'status':
        this.#set({ sync: event.state, ...parseFocusDetail(event.detail) });
        return;
      case 'agent/status':
        this.#set({
          agents: event.agents,
          selectedAgent: event.selectedAgent,
        });
        return;
      case 'agent/run':
        if (isActiveRunState(event.run.state) && event.run.runId !== this.#sessionRunId) {
          this.#beginPlaybackSession(event.run.runId);
        }
        this.#set({ agentRun: event.run });
        return;
      case 'agent/conversation':
        this.#set({ agentConversation: event.conversation });
        return;
      case 'error':
        // 错误只记录，不清空地图：已经画出来的内容仍然是有效信息。
        this.#set({ lastError: { code: event.code, message: event.message }, sync: 'degraded' });
        return;
    }
  }

  #receiveMapSnapshot(event: MapSnapshotEvent): void {
    this.#cancelPlaybackTimer();
    this.#pendingPatches = [];
    this.#sessionFrames = [];
    this.#sessionBaseline = undefined;
    this.#authoritativeMap = applySnapshot(this.#state.map, {
      document: event.document,
      capabilities: event.capabilities,
      factsRevision: event.factsRevision,
      drift: event.drift,
      ...(event.coverage === undefined ? {} : { coverage: event.coverage }),
      ...(event.layout === undefined ? {} : { layout: event.layout }),
    });
    this.#set({
      map: this.#authoritativeMap,
      sync: 'idle',
      changedNodeIds: [],
      changedEdgeIds: [],
      story: { ...this.#state.story, activeStoryId: undefined, stepIndex: 0, status: 'idle' },
      ...(event.agentPaneHeight === undefined ? {} : { agentPaneHeight: event.agentPaneHeight }),
      ...(event.agentPaneView === undefined ? {} : { agentPaneView: event.agentPaneView }),
      playback: playbackState(this.#authoritativeMap.revision),
    });
  }

  setLevel(level: DetailLevel): void {
    this.#set({
      // 层级切换是新的浏览上下文，不能继续叠加旧的局部聚焦。
      view: { level, ...optionalQuery(this.#state.view.query) },
      viewportRevision: this.#state.viewportRevision + 1,
    });
  }

  /** 回到最容易理解的完整模块地图，并显式要求画布重新适配全部节点。 */
  showFullMap(): void {
    this.#set({
      view: { level: 'modules' },
      selectedId: undefined,
      viewportRevision: this.#state.viewportRevision + 1,
    });
  }

  setAgentPaneHeight(height: number): void {
    this.#set({ agentPaneHeight: height });
  }

  setAgentPaneView(view: AgentPaneView): void {
    this.#set({ agentPaneView: view });
  }

  pauseMapPlayback(): void {
    if (this.#pendingPatches.length === 0) return;
    this.#cancelPlaybackTimer();
    this.#set({ playback: { ...this.#state.playback, status: 'paused' } });
  }

  resumeMapPlayback(): void {
    if (this.#pendingPatches.length === 0) return;
    this.#set({ playback: { ...this.#state.playback, status: 'playing' } });
    this.#scheduleNextPatch();
  }

  stepMapPlayback(): void {
    this.#cancelPlaybackTimer();
    this.#applyNextPatch(false);
  }

  replayMapSession(): void {
    if (this.#sessionBaseline === undefined || this.#sessionFrames.length === 0) return;
    this.#cancelPlaybackTimer();
    this.#pendingPatches = [...this.#sessionFrames];
    this.#set({
      map: this.#sessionBaseline,
      selectedId: undefined,
      changedNodeIds: [],
      changedEdgeIds: [],
      playback: {
        status: 'playing',
        authoritativeRevision: this.#authoritativeMap.revision,
        renderedRevision: this.#sessionBaseline.revision,
        pendingCount: this.#pendingPatches.length,
        sessionFrameCount: this.#sessionFrames.length,
        replaying: true,
        speed: this.#state.playback.speed,
      },
    });
    this.#scheduleNextPatch();
  }

  showLatestMapRevision(): void {
    this.#cancelPlaybackTimer();
    this.#pendingPatches = [];
    this.#set({
      map: this.#authoritativeMap,
      changedNodeIds: [],
      changedEdgeIds: [],
      playback: {
        ...this.#state.playback,
        status: 'live',
        authoritativeRevision: this.#authoritativeMap.revision,
        renderedRevision: this.#authoritativeMap.revision,
        pendingCount: 0,
        replaying: false,
        speed: this.#state.playback.speed,
      },
    });
  }

  setMapPlaybackSpeed(speed: 0.5 | 1 | 2): void {
    this.#set({ playback: { ...this.#state.playback, speed } });
    if (this.#state.playback.status === 'playing') {
      this.#cancelPlaybackTimer();
      this.#scheduleNextPatch();
    }
  }

  setQuery(query: string): void {
    this.#set({ view: { ...this.#state.view, query } });
  }

  select(id: Identifier | undefined): void {
    this.#set({
      ...(id === undefined ? { selectedId: undefined } : { selectedId: id }),
      ...(this.#state.story.status === 'playing'
        ? { story: { ...this.#state.story, status: 'paused' as const } }
        : {}),
    });
  }

  /** 关闭详情浮层，同时清空搜索，避免搜索结果立即把浮层重新打开。 */
  closeDetails(): void {
    this.#set({
      selectedId: undefined,
      view: {
        level: this.#state.view.level,
        ...(this.#state.view.focusNodeId === undefined
          ? {}
          : { focusNodeId: this.#state.view.focusNodeId }),
        ...(this.#state.view.focusDepth === undefined
          ? {}
          : { focusDepth: this.#state.view.focusDepth }),
      },
    });
  }

  playStory(id: Identifier): void {
    const story = this.#state.map.stories.get(id);
    if (story === undefined) {
      return;
    }
    this.#set({
      story: { ...this.#state.story, activeStoryId: id, stepIndex: 0, status: 'playing' },
      view: this.#viewForStoryStep(story.steps[0]),
    });
  }

  pauseStory(): void {
    if (this.#state.story.status === 'playing') {
      this.#set({ story: { ...this.#state.story, status: 'paused' } });
    }
  }

  resumeStory(): void {
    if (this.#state.story.activeStoryId !== undefined) {
      this.#set({ story: { ...this.#state.story, status: 'playing' } });
    }
  }

  nextStoryStep(): void {
    this.#moveStory(1);
  }

  previousStoryStep(): void {
    this.#moveStory(-1);
  }

  replayStory(): void {
    const id = this.#state.story.activeStoryId;
    if (id !== undefined) {
      this.playStory(id);
    }
  }

  stopStory(): void {
    this.#set({
      story: { ...this.#state.story, activeStoryId: undefined, stepIndex: 0, status: 'idle' },
    });
  }

  setStorySpeed(speed: StorySpeed): void {
    this.#set({ story: { ...this.#state.story, speed } });
  }

  #moveStory(delta: -1 | 1): void {
    const active = activeStory(this.#state);
    if (active === undefined) {
      return;
    }
    const nextIndex = Math.min(
      Math.max(this.#state.story.stepIndex + delta, 0),
      active.steps.length - 1,
    );
    const atEnd = delta === 1 && nextIndex === active.steps.length - 1;
    this.#set({
      story: {
        ...this.#state.story,
        stepIndex: nextIndex,
        status: atEnd ? 'paused' : this.#state.story.status,
      },
      view: this.#viewForStoryStep(active.steps[nextIndex]),
    });
  }

  #viewForStoryStep(step: GuidedStoryStep | undefined): ViewOptions {
    if (step === undefined) {
      return this.#state.view;
    }
    const ranks: Record<DetailLevel, number> = { overview: 0, modules: 1, files: 2 };
    const levels = step.focusNodeIds
      .map((id) => this.#levelShowing(id))
      .filter((level): level is DetailLevel => level !== undefined);
    const level = levels.reduce(
      (current, candidate) => (ranks[candidate] > ranks[current] ? candidate : current),
      this.#state.view.level,
    );
    return { level, ...optionalQuery(this.#state.view.query) };
  }

  /**
   * 定位到某个节点，必要时自动切换到能看见它的层级。
   *
   * 搜索命中全量节点，而当前层级可能把命中项折叠进了祖先。直接 select 一个没有绘制
   * 出来的 id，画布上不会有任何反应——那等于搜索结果不可点。这里先找出最粗的、能让
   * 该节点自身可见的层级再选中，保证「搜到就能到」（TECHNICAL_ARCHITECTURE.md §10.2）。
   */
  revealNode(id: Identifier): void {
    const level = this.#levelShowing(id) ?? this.#state.view.level;
    this.#set({
      // 同时退出聚焦模式：聚焦只渲染目标的一到两层邻域，命中项落在邻域之外时，
      // 即使切到了正确层级也依然不会被绘制。
      view: { level, ...optionalQuery(this.#state.view.query) },
      selectedId: id,
    });
  }

  /** 从远景到近景，返回第一个把该节点画成自己（而不是折叠进祖先）的层级。 */
  #levelShowing(id: Identifier): DetailLevel | undefined {
    const levels: readonly DetailLevel[] = ['overview', 'modules', 'files'];
    return levels.find((level) => resolveVisibleAnchor(this.#state.map, level, id) === id);
  }

  /** 聚焦模式：只渲染目标一到两层邻域。再次点击同一节点即退出。 */
  toggleFocus(id: Identifier): void {
    const current = this.#state.view.focusNodeId;
    const next: ViewOptions =
      current === id
        ? { level: this.#state.view.level, ...optionalQuery(this.#state.view.query) }
        : {
            level: this.#state.view.level,
            focusNodeId: id,
            focusDepth: 1,
            ...optionalQuery(this.#state.view.query),
          };
    this.#set({ view: next });
  }

  clearFocus(): void {
    if (this.#state.view.focusNodeId === undefined) return;
    this.#set({
      view: { level: this.#state.view.level, ...optionalQuery(this.#state.view.query) },
      viewportRevision: this.#state.viewportRevision + 1,
    });
  }

  setFocusDepth(depth: 1 | 2): void {
    if (this.#state.view.focusNodeId === undefined) {
      return;
    }
    this.#set({ view: { ...this.#state.view, focusDepth: depth } });
  }

  rememberLayout(positions: LayoutPositions): void {
    // Cytoscape 已经把被拖动节点放到了新位置；这里只更新持久化真源。
    // 若通知 React，会再次执行整图布局：未固定节点跳到新坐标，但镜头仍停在旧位置，
    // 视觉上就像其他模块突然消失。拖动不是结构变化，因此刻意不广播订阅更新。
    this.#state = { ...this.#state, map: applyLayout(this.#state.map, positions) };
  }

  /** 用一次完整拓扑布局替换旧的手工坐标，并回到无干扰的模块全图。 */
  applyTopologicalLayout(positions: LayoutPositions): void {
    this.#set({
      map: { ...this.#state.map, layout: { ...positions } },
      view: { level: 'modules' },
      selectedId: undefined,
      topologyRevision: this.#state.topologyRevision + 1,
    });
  }

  dismissError(): void {
    this.#set({
      lastError: undefined,
      ...(this.#state.sync === 'degraded' ? { sync: 'idle' as const } : {}),
    });
  }

  #beginPlaybackSession(runId: string): void {
    this.#sessionRunId = runId;
    this.#sessionBaseline = this.#state.map;
    this.#sessionFrames = [];
    this.#set({
      playback: { ...this.#state.playback, sessionFrameCount: 0, replaying: false },
    });
  }

  #receiveMapPatch(event: MapPatchEvent): void {
    const nextAuthoritative = applyMapPatchEvent(this.#authoritativeMap, event);
    if (nextAuthoritative === this.#authoritativeMap) return;
    this.#authoritativeMap = nextAuthoritative;
    if (this.#sessionBaseline === undefined) this.#sessionBaseline = this.#state.map;
    this.#sessionFrames.push(event);
    if (this.#sessionFrames.length > maximumSessionFrames) this.#sessionFrames.shift();
    this.#pendingPatches.push(event);
    if (this.#authoritativeMap.capabilities?.reducedMotion === true) {
      this.showLatestMapRevision();
      return;
    }
    const paused = this.#state.playback.status === 'paused';
    this.#set({
      sync: 'idle',
      playback: {
        ...this.#state.playback,
        status: paused ? 'paused' : 'playing',
        authoritativeRevision: this.#authoritativeMap.revision,
        pendingCount: this.#pendingPatches.length,
        sessionFrameCount: this.#sessionFrames.length,
      },
    });
    if (!paused) this.#scheduleNextPatch();
  }

  #scheduleNextPatch(): void {
    if (this.#playbackTimer !== undefined || this.#pendingPatches.length === 0) return;
    this.#playbackTimer = setTimeout(() => {
      this.#playbackTimer = undefined;
      this.#applyNextPatch(true);
    }, playbackFrameDelayMs / this.#state.playback.speed);
  }

  #applyNextPatch(continuePlaying: boolean): void {
    const event = this.#pendingPatches.shift();
    if (event === undefined) return;
    const map = applyMapPatchEvent(this.#state.map, event);
    const pendingCount = this.#pendingPatches.length;
    this.#set({
      map,
      changedNodeIds: [
        ...event.patch.upsertedNodes.map((node) => node.id),
        ...event.patch.removedNodeIds,
      ],
      changedEdgeIds: [
        ...event.patch.upsertedEdges.map((edge) => edge.id),
        ...event.patch.removedEdgeIds,
      ],
      playback: {
        ...this.#state.playback,
        status: pendingCount === 0 ? 'live' : continuePlaying ? 'playing' : 'paused',
        authoritativeRevision: this.#authoritativeMap.revision,
        renderedRevision: map.revision,
        pendingCount,
        replaying: pendingCount === 0 ? false : this.#state.playback.replaying,
        speed: this.#state.playback.speed,
      },
    });
    if (continuePlaying && pendingCount > 0) this.#scheduleNextPatch();
  }

  #cancelPlaybackTimer(): void {
    if (this.#playbackTimer !== undefined) clearTimeout(this.#playbackTimer);
    this.#playbackTimer = undefined;
  }

  #set(patch: Partial<AppState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function applyMapPatchEvent(state: MapState, event: MapPatchEvent): MapState {
  return applyPatch(state, {
    revision: event.revision,
    factsRevision: event.factsRevision,
    patch: event.patch,
    drift: event.drift,
    ...(event.coverage === undefined ? {} : { coverage: event.coverage }),
  });
}

function playbackState(revision: number): MapPlaybackState {
  return {
    status: 'live',
    authoritativeRevision: revision,
    renderedRevision: revision,
    pendingCount: 0,
    sessionFrameCount: 0,
    replaying: false,
    speed: 1,
  };
}

function isActiveRunState(state: AgentRunView['state']): boolean {
  return state === 'starting' || state === 'running' || state === 'awaiting_input';
}

export function activeStory(state: AppState): GuidedStory | undefined {
  const id = state.story.activeStoryId;
  return id === undefined ? undefined : state.map.stories.get(id);
}

export function activeStoryStep(state: AppState): GuidedStoryStep | undefined {
  return activeStory(state)?.steps[state.story.stepIndex];
}

function optionalQuery(query: string | undefined): { query?: string } {
  return query === undefined ? {} : { query };
}

/** 扩展用 `status` 事件的 detail 字段携带「Reveal in God View」的目标。 */
function parseFocusDetail(detail: string | undefined): Partial<AppState> {
  if (detail?.startsWith('focus:') !== true) {
    return {};
  }
  const id = detail.slice('focus:'.length);
  return id === '' ? {} : { selectedId: id };
}
