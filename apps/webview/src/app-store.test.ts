import { describe, expect, it, vi } from 'vitest';
import type { HistoryTimelineView } from '@god-view/webview-bridge';
import { AppStore } from './app-store.js';
import {
  capabilities,
  makeDocument,
  makeEdge,
  makeNode,
  makeStory,
} from './model/fixtures.test-utils.js';

function hydratedStore(): AppStore {
  const store = new AppStore();
  store.receive({
    type: 'map/snapshot',
    document: makeDocument([makeNode('a'), makeNode('b')], [], 1),
    capabilities,
    factsRevision: 1,
    drift: [],
  });
  return store;
}

describe('AppStore 订阅', () => {
  it('状态变化通知订阅者', () => {
    const store = new AppStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.setLevel('overview');

    expect(calls).toBe(1);
    expect(store.getState().view.level).toBe('overview');
  });

  it('取消订阅后不再收到通知', () => {
    const store = new AppStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    unsubscribe();
    store.setLevel('files');

    expect(calls).toBe(0);
  });
});

describe('AppStore 事件处理', () => {
  it('快照进入状态并标记已同步', () => {
    const store = hydratedStore();

    expect(store.getState().map.hydrated).toBe(true);
    expect(store.getState().sync).toBe('idle');
  });

  it('从工作区快照恢复 Agent 输出视窗高度', () => {
    const store = new AppStore();
    store.receive({
      type: 'map/snapshot',
      document: makeDocument([makeNode('a')], [], 1),
      capabilities,
      factsRevision: 1,
      drift: [],
      agentPaneHeight: 420,
    });

    expect(store.getState().agentPaneHeight).toBe(420);
    store.setAgentPaneHeight(360);
    expect(store.getState().agentPaneHeight).toBe(360);
  });

  it('补丁先推进权威版本，再由播放头推进画面版本', () => {
    const store = hydratedStore();
    store.receive({
      type: 'map/patch',
      revision: 2,
      factsRevision: 2,
      patch: {
        upsertedNodes: [makeNode('c')],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
      },
      drift: [],
    });

    expect(store.getState().playback).toMatchObject({
      authoritativeRevision: 2,
      renderedRevision: 1,
      pendingCount: 1,
      status: 'playing',
    });
    store.stepMapPlayback();
    expect(store.getState().map.revision).toBe(2);
    expect(store.getState().map.nodes.has('c')).toBe(true);
  });

  it('快速写入多个 revision 时支持暂停、逐步、跳到最新和整段回放', () => {
    const store = hydratedStore();
    for (const [revision, id] of [
      [2, 'c'],
      [3, 'd'],
      [4, 'e'],
    ] as const) {
      store.receive({
        type: 'map/patch',
        revision,
        factsRevision: revision,
        patch: {
          upsertedNodes: [makeNode(id)],
          upsertedEdges: [],
          removedNodeIds: [],
          removedEdgeIds: [],
        },
        drift: [],
      });
    }

    expect(store.getState().map.revision).toBe(1);
    expect(store.getState().playback).toMatchObject({
      authoritativeRevision: 4,
      renderedRevision: 1,
      pendingCount: 3,
      sessionFrameCount: 3,
    });
    store.pauseMapPlayback();
    store.stepMapPlayback();
    expect(store.getState().map.revision).toBe(2);
    expect(store.getState().playback).toMatchObject({ status: 'paused', pendingCount: 2 });
    store.showLatestMapRevision();
    expect(store.getState().map.revision).toBe(4);
    expect(store.getState().map.nodes.has('e')).toBe(true);

    store.replayMapSession();
    expect(store.getState().map.revision).toBe(1);
    expect(store.getState().playback).toMatchObject({ replaying: true, pendingCount: 3 });
    store.pauseMapPlayback();
    store.stepMapPlayback();
    expect(store.getState().map.revision).toBe(2);
  });

  it('错误只记录并降级，不清空已有地图', () => {
    const store = hydratedStore();
    store.receive({ type: 'error', code: 'PATH_OUT_OF_SCOPE', message: '越界' });

    expect(store.getState().sync).toBe('degraded');
    expect(store.getState().lastError?.code).toBe('PATH_OUT_OF_SCOPE');
    expect(store.getState().map.nodes.size).toBe(2);

    store.dismissError();
    expect(store.getState().lastError).toBeUndefined();
    expect(store.getState().sync).toBe('idle');
  });

  it('status 的 focus detail 变成选中项', () => {
    const store = hydratedStore();
    store.receive({ type: 'status', state: 'idle', detail: 'focus:b' });

    expect(store.getState().selectedId).toBe('b');
  });

  it('普通 status 不动选中项', () => {
    const store = hydratedStore();
    store.select('a');
    store.receive({ type: 'status', state: 'validating' });

    expect(store.getState().selectedId).toBe('a');
    expect(store.getState().sync).toBe('validating');
  });

  it('保存原生 Agent 配置状态', () => {
    const store = hydratedStore();
    store.receive({
      type: 'agent/status',
      selectedAgent: 'codex',
      agents: [
        {
          agent: 'codex',
          displayName: 'Codex CLI',
          installed: true,
          version: 'codex 0.147.0',
          configuration: 'current',
          workspaceRoot: '/repo',
          detail: '已复验',
        },
      ],
    });
    expect(store.getState().selectedAgent).toBe('codex');
    expect(store.getState().agents[0]?.configuration).toBe('current');
  });

  it('保存停靠或浮动的 Agent 视窗偏好', () => {
    const store = hydratedStore();
    store.setAgentPaneView({
      mode: 'floating',
      floatingBounds: { x: 24, y: 32, width: 680, height: 440 },
    });
    expect(store.getState().agentPaneView.mode).toBe('floating');
    expect(store.getState().agentPaneView.floatingBounds.width).toBe(680);
  });

  it('map/facts 在图不变的情况下更新漂移与覆盖率', () => {
    // 对应真实环境的缺陷：删除文件后 UI 不刷新，重新打开面板才对。
    const store = hydratedStore();
    store.receive({
      type: 'map/facts',
      factsRevision: 2,
      drift: [{ kind: 'missing_file', detail: 'src/payment/index.ts 已不存在' }],
    });

    expect(store.getState().map.revision).toBe(1);
    expect(store.getState().map.nodes.size).toBe(2);
    expect(store.getState().map.drift).toHaveLength(1);
  });

  it('过期的 map/facts 被丢弃', () => {
    const store = hydratedStore();
    store.receive({ type: 'map/facts', factsRevision: 3, drift: [] });
    store.receive({
      type: 'map/facts',
      factsRevision: 2,
      drift: [{ kind: 'missing_file', detail: '过期' }],
    });

    expect(store.getState().map.drift).toEqual([]);
  });
});

describe('AppStore 视图操作', () => {
  it('聚焦可切换开关，并默认一层邻域', () => {
    const store = hydratedStore();
    store.toggleFocus('a');

    expect(store.getState().view.focusNodeId).toBe('a');
    expect(store.getState().view.focusDepth).toBe(1);

    store.toggleFocus('a');
    expect(store.getState().view.focusNodeId).toBeUndefined();
  });

  it('切换聚焦目标时保留搜索词', () => {
    const store = hydratedStore();
    store.setQuery('订单');
    store.toggleFocus('a');
    store.toggleFocus('b');

    expect(store.getState().view.focusNodeId).toBe('b');
    expect(store.getState().view.query).toBe('订单');
  });

  it('未聚焦时设置深度无效', () => {
    const store = hydratedStore();
    store.setFocusDepth(2);

    expect(store.getState().view.focusDepth).toBeUndefined();
  });

  it('聚焦后可以改深度', () => {
    const store = hydratedStore();
    store.toggleFocus('a');
    store.setFocusDepth(2);

    expect(store.getState().view.focusDepth).toBe(2);
  });

  it('切换层级时退出局部视图，避免两个导航状态叠加', () => {
    const store = hydratedStore();
    store.toggleFocus('a');

    store.setLevel('files');

    expect(store.getState().view).toEqual({ level: 'files' });
  });

  it('显示完整地图会回到模块层、关闭详情并要求重新适配视口', () => {
    const store = hydratedStore();
    store.setLevel('files');
    store.toggleFocus('a');
    store.select('a');
    const before = store.getState().viewportRevision;

    store.showFullMap();

    expect(store.getState().view).toEqual({ level: 'modules' });
    expect(store.getState().selectedId).toBeUndefined();
    expect(store.getState().viewportRevision).toBe(before + 1);
  });

  it('记住拖拽后的坐标', () => {
    const store = hydratedStore();
    store.rememberLayout({ a: { x: 5, y: 6 } });

    expect(store.getState().map.layout).toEqual({ a: { x: 5, y: 6 } });
  });

  it('拖动坐标只更新持久化真源，不通知 React 重新绘制整张图', () => {
    const store = hydratedStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.rememberLayout({ a: { x: 120, y: 80 } });

    expect(store.getState().map.layout).toEqual({ a: { x: 120, y: 80 } });
    expect(notifications).toBe(0);
  });

  it('拓扑排序替换全部旧坐标、退出局部详情并只通知一次', () => {
    const store = hydratedStore();
    store.rememberLayout({ a: { x: 900, y: 900 }, stale: { x: 1, y: 2 } });
    store.toggleFocus('a');
    store.select('a');
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.applyTopologicalLayout({ a: { x: 0, y: 0 }, b: { x: 320, y: 0 } });

    expect(store.getState().map.layout).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 320, y: 0 },
    });
    expect(store.getState().view).toEqual({ level: 'modules' });
    expect(store.getState().selectedId).toBeUndefined();
    expect(store.getState().topologyRevision).toBe(1);
    expect(notifications).toBe(1);
  });

  it('可以清空选中项', () => {
    const store = hydratedStore();
    store.select('a');
    store.select(undefined);

    expect(store.getState().selectedId).toBeUndefined();
  });

  it('普通选中只改变高亮目标，不改变层级、局部模式或视口', () => {
    const store = hydratedStore();
    const beforeView = store.getState().view;
    const beforeViewport = store.getState().viewportRevision;

    store.select('a');

    expect(store.getState().selectedId).toBe('a');
    expect(store.getState().view).toBe(beforeView);
    expect(store.getState().viewportRevision).toBe(beforeViewport);
  });

  it('关闭详情同时清空选择与搜索，但保留层级和聚焦设置', () => {
    const store = hydratedStore();
    store.setQuery('订单');
    store.toggleFocus('a');
    store.select('a');

    store.closeDetails();

    expect(store.getState().selectedId).toBeUndefined();
    expect(store.getState().view).toMatchObject({
      level: 'modules',
      focusNodeId: 'a',
      focusDepth: 1,
    });
    expect(store.getState().view.query).toBeUndefined();
  });
});

describe('AppStore 讲解播放', () => {
  function storyStore(): AppStore {
    const store = new AppStore();
    store.receive({
      type: 'map/snapshot',
      document: makeDocument([makeNode('a'), makeNode('b')], [], 1, [makeStory()]),
      capabilities,
      factsRevision: 1,
      drift: [],
    });
    return store;
  }

  it('播放、逐步导航、暂停、重播与退出均保持确定状态', () => {
    const store = storyStore();
    store.playStory('story.intro');
    expect(store.getState().story).toMatchObject({ status: 'playing', stepIndex: 0 });

    store.nextStoryStep();
    expect(store.getState().story.stepIndex).toBe(1);
    store.pauseStory();
    expect(store.getState().story.status).toBe('paused');
    store.resumeStory();
    store.nextStoryStep();
    expect(store.getState().story).toMatchObject({ status: 'paused', stepIndex: 2 });

    store.replayStory();
    expect(store.getState().story).toMatchObject({ status: 'playing', stepIndex: 0 });
    store.stopStory();
    expect(store.getState().story.status).toBe('idle');
  });

  it('播放中选择节点会暂停，允许自由探索后继续', () => {
    const store = storyStore();
    store.playStory('story.intro');
    store.select('b');

    expect(store.getState().selectedId).toBe('b');
    expect(store.getState().story.status).toBe('paused');
  });

  it('补丁可以增量加入讲解，不替换节点和关系', () => {
    const store = hydratedStore();
    store.receive({
      type: 'map/patch',
      revision: 2,
      factsRevision: 1,
      patch: {
        upsertedNodes: [],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
        upsertedStories: [makeStory()],
      },
      drift: [],
    });

    store.stepMapPlayback();

    expect(store.getState().map.stories.has('story.intro')).toBe(true);
    expect(store.getState().map.nodes.size).toBe(2);
  });
});

describe('AppStore 搜索定位', () => {
  /** 三层结构：分组 → 模块 → 文件，用来验证「搜到就能到」。 */
  function layeredStore(): AppStore {
    const store = new AppStore();
    store.receive({
      type: 'map/snapshot',
      document: makeDocument(
        [
          makeNode('domain', { type: 'group' }),
          makeNode('orders', { type: 'module', parentId: 'domain' }),
          makeNode('orders/a.ts', { type: 'file', parentId: 'orders' }),
        ],
        [],
        1,
      ),
      capabilities,
      factsRevision: 1,
      drift: [],
    });
    return store;
  }

  it('命中被折叠时自动切到能看见它的层级', () => {
    const store = layeredStore();
    store.setLevel('overview');

    store.revealNode('orders/a.ts');

    // 文件级节点只在近景可见，直接 select 会选中一个没画出来的 id。
    expect(store.getState().view.level).toBe('files');
    expect(store.getState().selectedId).toBe('orders/a.ts');
  });

  it('选择能看见该节点的最粗层级，不无谓下钻', () => {
    const store = layeredStore();
    store.setLevel('files');

    store.revealNode('domain');

    expect(store.getState().view.level).toBe('overview');
  });

  it('当前层级已经能看见时只切换选中项', () => {
    const store = layeredStore();
    store.setLevel('modules');

    store.revealNode('orders');

    expect(store.getState().view.level).toBe('modules');
    expect(store.getState().selectedId).toBe('orders');
  });

  it('未知节点保持当前层级', () => {
    const store = layeredStore();
    store.setLevel('modules');

    store.revealNode('missing');

    expect(store.getState().view.level).toBe('modules');
    expect(store.getState().selectedId).toBe('missing');
  });

  it('保留搜索词，方便继续挑其它命中项', () => {
    const store = layeredStore();
    store.setQuery('orders');

    store.revealNode('orders/a.ts');

    expect(store.getState().view.query).toBe('orders');
  });

  it('退出聚焦模式，避免命中项落在邻域之外不被绘制', () => {
    const store = layeredStore();
    store.toggleFocus('domain');

    store.revealNode('orders/a.ts');

    expect(store.getState().view.focusNodeId).toBeUndefined();
    expect(store.getState().view.focusDepth).toBeUndefined();
    expect(store.getState().selectedId).toBe('orders/a.ts');
  });
});

/** 历史回放：回放的是仓库自己的提交历史，与 AI 补丁回放共享画布但互不干扰。 */
function historyTimeline(): HistoryTimelineView {
  const frame = (
    index: number,
    presentNodeIds: readonly string[],
    changedNodeIds: readonly string[],
    magnitudes: Record<string, number>,
  ) => ({
    index,
    sha: `sha-${String(index)}`,
    shortSha: `sha-${String(index)}`,
    author: 'tester',
    committedAt: `2026-01-0${String(index + 1)}T00:00:00.000Z`,
    subject: `commit ${String(index)}`,
    additions: 10,
    deletions: 1,
    commitCount: 1,
    fileCount: index + 1,
    presentNodeIds: [...presentNodeIds],
    changedNodeIds: [...changedNodeIds],
    magnitudes,
  });
  return {
    nodes: [makeNode('h1'), makeNode('h2')],
    edges: [makeEdge('h.edge', 'h1', 'h2')],
    frames: [
      frame(0, ['h1'], ['h1'], { h1: 10 }),
      frame(1, ['h1', 'h2'], ['h2'], { h1: 10, h2: 5 }),
    ],
    truncatedCommits: 3,
    derivedNodeCount: 1,
  };
}

function historyStore(): AppStore {
  const store = hydratedStore();
  store.beginHistoryLoad();
  store.receive({ type: 'history/timeline', timeline: historyTimeline() });
  return store;
}

describe('AppStore 历史回放', () => {
  it('时间线到达后画出第一帧，并保留截断与推断节点的说明', () => {
    const store = historyStore();

    const state = store.getState();
    expect(state.history).toMatchObject({
      status: 'ready',
      index: 0,
      frameCount: 2,
      truncatedCommits: 3,
      derivedNodeCount: 1,
    });
    expect([...state.map.nodes.keys()]).toEqual(['h1']);
    // 关系的另一端还没出现，这一帧不能画出这条线。
    expect(state.map.edges.size).toBe(0);
    expect(state.changedNodeIds).toEqual(['h1']);
  });

  it('逐帧前进后补齐节点与关系，并标出本帧改动', () => {
    const store = historyStore();

    store.stepHistory(1);

    const state = store.getState();
    expect([...state.map.nodes.keys()]).toEqual(['h1', 'h2']);
    expect(state.map.edges.has('h.edge')).toBe(true);
    expect(state.changedNodeIds).toEqual(['h2']);
    expect(state.history.magnitudes).toEqual({ h1: 10, h2: 5 });
  });

  it('拖动进度条跳帧，越界值被夹到有效范围', () => {
    const store = historyStore();

    store.seekHistory(99);

    expect(store.getState().history.index).toBe(1);
  });

  it('播放到最后一帧后停在终态', async () => {
    vi.useFakeTimers();
    try {
      const store = historyStore();
      store.playHistory();

      expect(store.getState().history.status).toBe('playing');
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.getState().history.index).toBe(1);
      expect(store.getState().history.status).toBe('paused');
    } finally {
      vi.useRealTimers();
    }
  });

  it('减少动态效果时不自动连播，只提示逐帧查看', () => {
    const store = new AppStore();
    store.receive({
      type: 'map/snapshot',
      document: makeDocument([makeNode('a')], [], 1),
      capabilities: { ...capabilities, reducedMotion: true },
      factsRevision: 1,
      drift: [],
    });
    store.receive({ type: 'history/timeline', timeline: historyTimeline() });

    store.playHistory();

    expect(store.getState().history.status).toBe('paused');
    expect(store.getState().history.message).toContain('减少动态效果');
  });

  it('回放期间到达的地图补丁不改画面，退出后可见', () => {
    const store = historyStore();

    store.receive({
      type: 'map/patch',
      revision: 2,
      factsRevision: 2,
      patch: {
        upsertedNodes: [makeNode('c')],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
      },
      drift: [],
    });

    expect(store.getState().map.nodes.has('c')).toBe(false);
    expect([...store.getState().map.nodes.keys()]).toEqual(['h1']);

    store.exitHistory();

    expect(store.getState().history.status).toBe('idle');
    expect(store.getState().map.nodes.has('c')).toBe(true);
    expect(store.getState().map.nodes.has('h1')).toBe(false);
  });

  it('回放期间到达的快照只更新权威地图', () => {
    const store = historyStore();

    store.receive({
      type: 'map/snapshot',
      document: makeDocument([makeNode('a'), makeNode('b'), makeNode('z')], [], 5),
      capabilities,
      factsRevision: 5,
      drift: [],
    });

    expect([...store.getState().map.nodes.keys()]).toEqual(['h1']);

    store.exitHistory();

    expect(store.getState().map.nodes.has('z')).toBe(true);
  });

  it('固定坐标应用到当前帧，让节点只出现不重排', () => {
    const store = historyStore();

    store.setHistoryLayout({ h1: { x: 10, y: 20 }, h2: { x: 30, y: 40 } });

    expect(store.getState().map.layout).toEqual({ h1: { x: 10, y: 20 }, h2: { x: 30, y: 40 } });
    store.stepHistory(1);
    expect(store.getState().map.layout['h2']).toEqual({ x: 30, y: 40 });
  });

  it('最终帧的地图用于一次性计算全程坐标', () => {
    const store = historyStore();

    expect([...(store.historyFinalMap()?.nodes.keys() ?? [])]).toEqual(['h1', 'h2']);
  });

  it('读取失败时进入错误态并保留原因', () => {
    const store = hydratedStore();
    store.beginHistoryLoad();

    store.receive({
      type: 'error',
      code: 'HISTORY_UNAVAILABLE',
      message: '当前工作区没有可回放的 Git 历史',
    });

    expect(store.getState().history.status).toBe('error');
    expect(store.getState().history.message).toContain('Git 历史');
    // 出错不清空画布：已经画出来的地图仍然有效。
    expect(store.getState().map.nodes.size).toBe(2);
  });
});

describe('AppStore 历史回放的边界情况', () => {
  it('没有时间线时播放、逐帧和拖动都不做任何事', () => {
    const store = hydratedStore();

    store.playHistory();
    store.stepHistory(1);
    store.seekHistory(3);
    store.pauseHistory();

    expect(store.getState().history.status).toBe('idle');
    expect(store.historyFinalMap()).toBeUndefined();
    expect([...store.getState().map.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('空时间线报告没有可回放的提交，而不是画一张空图', () => {
    const store = hydratedStore();
    store.beginHistoryLoad();

    store.receive({
      type: 'history/timeline',
      timeline: { nodes: [], edges: [], frames: [], truncatedCommits: 0, derivedNodeCount: 0 },
    });

    expect(store.getState().history.status).toBe('error');
    expect(store.getState().history.message).toContain('没有可回放的提交');
    expect(store.getState().map.nodes.size).toBe(2);
  });

  it('未播放时的暂停与未进入回放时的退出都是空操作', () => {
    const store = historyStore();
    store.pauseHistory();
    expect(store.getState().history.status).toBe('ready');

    store.exitHistory();
    expect(store.getState().history.status).toBe('idle');
    store.exitHistory();
    expect(store.getState().history.status).toBe('idle');
  });

  it('播放中改变速度后继续按新节奏播放', async () => {
    vi.useFakeTimers();
    try {
      const store = historyStore();
      store.playHistory();
      store.setHistorySpeed(4);

      expect(store.getState().history.speed).toBe(4);
      expect(store.getState().history.status).toBe('playing');
      await vi.advanceTimersByTimeAsync(200);
      expect(store.getState().history.index).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('播放中拖动进度条保持播放状态', async () => {
    vi.useFakeTimers();
    try {
      const store = historyStore();
      store.playHistory();

      store.seekHistory(0);

      expect(store.getState().history.status).toBe('playing');
      await vi.advanceTimersByTimeAsync(5000);
      expect(store.getState().history.index).toBe(1);
      expect(store.getState().history.status).toBe('paused');
    } finally {
      vi.useRealTimers();
    }
  });

  it('暂停中的速度调整不会偷偷恢复播放', () => {
    const store = historyStore();

    store.setHistorySpeed(2);

    expect(store.getState().history.status).toBe('ready');
    expect(store.getState().history.speed).toBe(2);
  });

  it('未进入回放时设置坐标不影响 live 地图', () => {
    const store = hydratedStore();

    store.setHistoryLayout({ a: { x: 5, y: 5 } });

    expect(store.getState().map.layout).toEqual({});
  });

  it('回放期间的事实更新不挂到历史帧上', () => {
    const store = historyStore();

    store.receive({
      type: 'map/facts',
      factsRevision: 9,
      drift: [{ kind: 'missing_file', detail: 'src/gone.ts 已不存在' }],
    });

    expect(store.getState().map.drift).toEqual([]);

    store.exitHistory();

    expect(store.getState().map.drift).toHaveLength(1);
  });
});
