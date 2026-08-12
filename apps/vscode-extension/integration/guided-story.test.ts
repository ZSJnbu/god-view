import assert from 'node:assert/strict';
import { currentProtocolVersion, type GodViewEvent } from '@god-view/protocol';
import { parseExtensionEvent } from '@god-view/webview-bridge';
import { routeMapUpdate } from '../src/view/map-update-event.js';
import { createService, deliver, identity, watchUpdates } from './harness.js';

describe('GuidedStory 增量链路', () => {
  it('Agent 事件经 Inbox、MapService 与 Webview bridge 形成可播放讲解补丁', async function () {
    this.timeout(30000);
    const service = await createService();
    const { id: workspaceId } = identity();
    const branchKey = service.capabilities.branchKey;
    const envelope = (eventId: string) => ({
      version: currentProtocolVersion,
      workspaceId,
      branchKey,
      sessionId: 'itest-story',
      eventId,
      timestamp: '2026-08-11T00:00:00.000Z',
      actor: { kind: 'agent' as const, adapterId: 'itest' },
    });
    const nodes: GodViewEvent[] = ['entry', 'core', 'storage'].map((nodeId, index) => ({
      ...envelope(`itest.story.node.${nodeId}`),
      type: 'node_upsert',
      payload: { node: { id: nodeId, type: index === 0 ? 'entry' : 'module', label: nodeId } },
    }));

    await deliver(nodes);
    await service.open();
    const waiter = watchUpdates(service);
    try {
      await deliver([
        {
          ...envelope('itest.story.upsert'),
          type: 'story_upsert',
          payload: {
            story: {
              id: 'story.intro',
              type: 'project_intro',
              title: '认识项目',
              steps: [
                { order: 0, focusNodeIds: ['entry'], caption: '从入口开始' },
                { order: 1, focusNodeIds: ['core'], caption: '进入核心模块' },
                { order: 2, focusNodeIds: ['storage'], caption: '最后写入存储' },
              ],
            },
          },
        },
      ]);

      const update = await waiter.next(
        (candidate) => (candidate.patch.upsertedStories?.length ?? 0) === 1,
        'story_upsert 应产生包含讲解的地图补丁',
      );
      assert.equal(update.kind, 'patch');
      assert.equal(service.snapshot.stories.get('story.intro')?.steps.length, 3);

      const delivery = routeMapUpdate(update);
      assert.equal(delivery.kind, 'event');
      const parsed = parseExtensionEvent(delivery.event);
      assert.ok(parsed.ok);
      assert.equal(parsed.value.type, 'map/patch');
    } finally {
      waiter.dispose();
      await service.flush();
      service.dispose();
    }
  });
});
