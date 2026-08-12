import assert from 'node:assert/strict';
import { currentProtocolVersion, type GodViewEvent } from '@god-view/protocol';
import { parseExtensionEvent } from '@god-view/webview-bridge';
import { routeMapUpdate } from '../src/view/map-update-event.js';
import { createService, deliver, identity, watchUpdates } from './harness.js';

describe('原位标注与 Agent 解释完整宿主链路', () => {
  it('Webview 用户事件落盘，Gateway 形态答案经 Inbox 回到增量消息，用户可解决', async function () {
    this.timeout(30000);
    const service = await createService();
    const { id: workspaceId } = identity();
    const branchKey = service.capabilities.branchKey;
    const envelope = (eventId: string) => ({
      version: currentProtocolVersion,
      workspaceId,
      branchKey,
      sessionId: 'itest-annotation',
      eventId,
      timestamp: '2026-08-12T00:00:00.000Z',
    });
    const nodeEvent: GodViewEvent = {
      ...envelope('itest.annotation.node'),
      actor: { kind: 'agent', adapterId: 'itest' },
      type: 'node_upsert',
      payload: {
        node: {
          id: 'orders',
          type: 'module',
          label: 'Orders',
          paths: ['src/orders/index.ts'],
        },
      },
    };
    await deliver([nodeEvent]);
    await service.open();
    const waiter = watchUpdates(service);
    try {
      const createUpdatePromise = waiter.next(
        (update) => (update.patch.upsertedAnnotations?.length ?? 0) === 1,
        '用户创建标注应产生增量补丁',
      );
      const annotationId = await service.createAnnotation({
        annotationType: 'explain',
        body: '为什么订单依赖支付？',
        nodeIds: ['orders'],
      });
      assert.ok(annotationId);
      const created = await createUpdatePromise;
      assert.equal(created.kind, 'patch');
      assert.equal(service.snapshot.annotations.get(annotationId)?.status, 'sent');
      assert.equal(service.snapshot.activeChanges.size, 0, '解释不得创建写入 ChangeSet');

      const answer: GodViewEvent = {
        ...envelope('itest.annotation.answer'),
        actor: { kind: 'agent', adapterId: 'itest' },
        type: 'annotation_answer',
        payload: {
          annotationId,
          message: {
            id: 'itest.annotation.answer.message',
            author: 'agent',
            body: '订单确认前需要支付授权。',
            evidence: [
              {
                kind: 'explicit_import',
                location: { path: 'src/orders/index.ts', startLine: 1 },
              },
            ],
            createdAt: '2026-08-12T00:00:01.000Z',
          },
        },
      };
      const answerUpdatePromise = waiter.next(
        (update) =>
          update.patch.upsertedAnnotations?.[0]?.messages.some(
            (message) => message.author === 'agent',
          ) === true,
        'Agent 答案应经过 Inbox 和 MapService 回到 Webview 补丁',
      );
      await deliver([answer]);
      const answered = await answerUpdatePromise;
      const delivery = routeMapUpdate(answered);
      assert.equal(delivery.kind, 'event');
      const parsed = parseExtensionEvent(delivery.event);
      assert.ok(parsed.ok);
      assert.equal(parsed.value.type, 'map/patch');
      assert.equal(service.snapshot.annotations.get(annotationId)?.status, 'answered');

      const resolved = await service.resolveAnnotation(annotationId);
      assert.equal(resolved, true);
      assert.equal(service.snapshot.annotations.get(annotationId)?.status, 'resolved');
      await service.flush();
      assert.equal(service.toDocument().annotations?.[0]?.status, 'resolved');
    } finally {
      waiter.dispose();
      service.dispose();
    }
  });
});
