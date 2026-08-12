import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashSnapshot, toSnapshotDocument } from '@god-view/graph-core';
import { FileEventLog } from './file-event-log.js';
import { FileSnapshotStore } from './file-snapshot-store.js';
import { GraphRepository } from './repository.js';

const fixtureRoot = resolve('fixtures/compat/v0.1.0');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('上一稳定版本存储兼容性', () => {
  it('从 0.1.0 快照与尾部日志恢复，不隔离或拒绝有效事件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'god-view-compat-'));
    temporaryRoots.push(root);
    await cp(fixtureRoot, root, { recursive: true });
    const snapshotBefore = await readFile(join(root, 'snapshot.json'), 'utf8');
    const eventsBefore = await readFile(join(root, 'events.jsonl'), 'utf8');

    const opened = await GraphRepository.open({
      workspaceId: 'ws-compat-0-1-0',
      branchKey: 'main',
      eventLog: new FileEventLog(join(root, 'events.jsonl'), join(root, 'quarantine.jsonl')),
      snapshotStore: new FileSnapshotStore(join(root, 'snapshot.json')),
      now: () => '2026-08-11T01:00:00.000Z',
    });

    expect(opened.report).toMatchObject({
      restoredFrom: 'snapshot',
      replayedEvents: 4,
      rejected: [],
      quarantined: [],
    });
    expect([...opened.repository.snapshot.nodes.keys()].sort()).toEqual([
      'module.api',
      'module.orders',
    ]);
    expect([...opened.repository.snapshot.edges.keys()]).toEqual(['edge.api-orders']);
    expect(opened.repository.snapshot.revision).toBe(3);

    const reopened = await GraphRepository.open({
      workspaceId: 'ws-compat-0-1-0',
      branchKey: 'main',
      eventLog: new FileEventLog(join(root, 'events.jsonl'), join(root, 'quarantine.jsonl')),
      snapshotStore: new FileSnapshotStore(join(root, 'snapshot.json')),
      now: () => '2026-08-11T02:00:00.000Z',
    });
    expect(hashSnapshot(toSnapshotDocument(reopened.repository.snapshot))).toBe(
      hashSnapshot(toSnapshotDocument(opened.repository.snapshot)),
    );
    await expect(readFile(join(root, 'snapshot.json'), 'utf8')).resolves.toBe(snapshotBefore);
    await expect(readFile(join(root, 'events.jsonl'), 'utf8')).resolves.toBe(eventsBefore);
  });
});
