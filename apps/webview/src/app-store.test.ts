import { describe, expect, it } from 'vitest';
import { AppStore } from './app-store.js';
import { capabilities, makeDocument, makeNode, makeStory } from './model/fixtures.test-utils.js';

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

  it('补丁更新版本号', () => {
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

    expect(store.getState().map.revision).toBe(2);
    expect(store.getState().map.nodes.has('c')).toBe(true);
  });

  it('错误只记录并降级，不清空已有地图', () => {
    const store = hydratedStore();
    store.receive({ type: 'error', code: 'PATH_OUT_OF_SCOPE', message: '越界' });

    expect(store.getState().sync).toBe('degraded');
    expect(store.getState().lastError?.code).toBe('PATH_OUT_OF_SCOPE');
    expect(store.getState().map.nodes.size).toBe(2);

    store.dismissError();
    expect(store.getState().lastError).toBeUndefined();
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

  it('记住拖拽后的坐标', () => {
    const store = hydratedStore();
    store.rememberLayout({ a: { x: 5, y: 6 } });

    expect(store.getState().map.layout).toEqual({ a: { x: 5, y: 6 } });
  });

  it('可以清空选中项', () => {
    const store = hydratedStore();
    store.select('a');
    store.select(undefined);

    expect(store.getState().selectedId).toBeUndefined();
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
