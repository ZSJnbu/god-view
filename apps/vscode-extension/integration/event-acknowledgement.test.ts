import assert from 'node:assert/strict';
import { Uri, workspace } from 'vscode';
import { currentProtocolVersion, type GodViewEvent, type ToolResult } from '@god-view/protocol';
import { createService, identity, workspaceRoot } from './harness.js';

describe('Gateway 事件归约确认', () => {
  it('成功事件与未知 ChangeSet 都产生真实回执', async function () {
    this.timeout(30000);
    const service = await createService();
    await service.open();
    try {
      const common = {
        version: currentProtocolVersion,
        workspaceId: identity().id,
        branchKey: service.capabilities.branchKey,
        sessionId: 'itest-ack',
        timestamp: '2026-08-12T08:00:00.000Z',
        actor: { kind: 'agent' as const, adapterId: 'itest' },
      };
      await writeInbox({
        ...common,
        eventId: 'itest-ack.begin',
        type: 'change_start',
        payload: { changeSetId: 'change-ack', intent: '验证确认闭环' },
      });
      const accepted = await waitForAcknowledgement('itest-ack.begin');
      assert.equal(accepted.accepted, true);
      assert.equal(accepted.mapRevision, 1);

      await writeInbox({
        ...common,
        eventId: 'itest-ack.unknown',
        type: 'node_upsert',
        payload: {
          changeSetId: 'missing-change',
          node: { id: 'module.rejected', type: 'module', label: '不应写入' },
        },
      });
      const rejected = await waitForAcknowledgement('itest-ack.unknown');
      assert.equal(rejected.accepted, false);
      assert.equal(rejected.errors[0]?.code, 'UNKNOWN_CHANGE_SET');
      assert.equal(service.snapshot.nodes.has('module.rejected'), false);
    } finally {
      service.dispose();
    }
  });
});

async function writeInbox(event: GodViewEvent): Promise<void> {
  const inbox = Uri.joinPath(workspaceRoot(), '.godview', 'inbox');
  await workspace.fs.createDirectory(inbox);
  await workspace.fs.writeFile(
    Uri.joinPath(inbox, `${event.eventId}.json`),
    Buffer.from(JSON.stringify(event), 'utf8'),
  );
}

async function waitForAcknowledgement(eventId: string): Promise<ToolResult> {
  const file = Uri.joinPath(workspaceRoot(), '.godview', 'acknowledgements', `${eventId}.json`);
  for (let attempts = 0; attempts < 200; attempts += 1) {
    try {
      return JSON.parse(new TextDecoder().decode(await workspace.fs.readFile(file))) as ToolResult;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`等待确认回执超时：${eventId}`);
}
