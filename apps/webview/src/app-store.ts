import type { GuidedStory, GuidedStoryStep, Identifier } from '@god-view/protocol';
import type { ExtensionEvent, SyncState } from '@god-view/webview-bridge';
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
};

type Listener = () => void;

/**
 * 应用状态容器。
 *
 * React 组件通过 `useSyncExternalStore` 订阅这里，不持有业务真源；
 * Cytoscape 只消费派生出来的可见图（TECHNICAL_ARCHITECTURE.md §10.1）。
 */
export class AppStore {
  #state: AppState = initialAppState;
  readonly #listeners = new Set<Listener>();

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
        this.#set({
          map: applySnapshot(this.#state.map, {
            document: event.document,
            capabilities: event.capabilities,
            factsRevision: event.factsRevision,
            drift: event.drift,
            ...(event.coverage === undefined ? {} : { coverage: event.coverage }),
            ...(event.layout === undefined ? {} : { layout: event.layout }),
          }),
          sync: 'idle',
          story: { ...this.#state.story, activeStoryId: undefined, stepIndex: 0, status: 'idle' },
        });
        return;
      case 'map/patch':
        this.#set({
          map: applyPatch(this.#state.map, {
            revision: event.revision,
            factsRevision: event.factsRevision,
            patch: event.patch,
            drift: event.drift,
            ...(event.coverage === undefined ? {} : { coverage: event.coverage }),
          }),
          sync: 'idle',
        });
        return;
      case 'map/facts':
        // 图没变、只有事实变了：不能走补丁路径，那条路径按图版本排序会丢弃它。
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
      case 'error':
        // 错误只记录，不清空地图：已经画出来的内容仍然是有效信息。
        this.#set({ lastError: { code: event.code, message: event.message }, sync: 'degraded' });
        return;
    }
  }

  setLevel(level: DetailLevel): void {
    this.#set({ view: { ...this.#state.view, level } });
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

  setFocusDepth(depth: 1 | 2): void {
    if (this.#state.view.focusNodeId === undefined) {
      return;
    }
    this.#set({ view: { ...this.#state.view, focusDepth: depth } });
  }

  rememberLayout(positions: LayoutPositions): void {
    this.#set({ map: applyLayout(this.#state.map, positions) });
  }

  dismissError(): void {
    this.#set({ lastError: undefined });
  }

  #set(patch: Partial<AppState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) {
      listener();
    }
  }
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
