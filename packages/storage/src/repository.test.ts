import { beforeEach, describe, expect, it } from 'vitest';
import { currentProtocolVersion, errorCodes, type GodViewEvent } from '@god-view/protocol';
import { GraphRepository } from './repository.js';
import { MemoryEventLog, MemorySnapshotStore } from './memory-stores.js';

const workspaceId = 'ws-test';
const branchKey = 'main';
const now = (): string => '2026-08-07T09:00:00.000Z';

let sequence = 0;

function nodeEvent(nodeId: string, label = nodeId): GodViewEvent {
  sequence += 1;
  return {
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId: 'session-1',
    eventId: `event-${String(sequence)}`,
    timestamp: `2026-08-07T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    actor: { kind: 'agent', adapterId: 'codex' },
    type: 'node_upsert',
    payload: { node: { id: nodeId, type: 'module', label } },
  };
}

/** 父节点缺失的事件，用于验证被领域规则拒绝的路径。 */
function danglingParentEvent(): GodViewEvent {
  sequence += 1;
  return {
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId: 'session-1',
    eventId: `event-${String(sequence)}`,
    timestamp: '2026-08-07T10:00:00.000Z',
    type: 'node_upsert',
    payload: { node: { id: 'child', type: 'module', label: 'child', parentId: 'missing' } },
  };
}

function annotationEvent(annotationId: string, timestamp: string, pinned = false): GodViewEvent {
  sequence += 1;
  return {
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId: 'user-session',
    eventId: `annotation-${String(sequence)}`,
    timestamp,
    actor: { kind: 'user' },
    type: 'annotation_create',
    payload: {
      annotation: {
        id: annotationId,
        type: 'note',
        status: 'sent',
        target: { nodeIds: ['target'], mapRevision: 1 },
        messages: [
          {
            id: `${annotationId}.message`,
            author: 'user',
            body: `secret conversation ${annotationId}`,
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
        ...(pinned ? { pinned: true } : {}),
      },
    },
  };
}

function resolveAnnotationEvent(annotationId: string, timestamp: string): GodViewEvent {
  sequence += 1;
  return {
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId: 'user-session',
    eventId: `resolve-${String(sequence)}`,
    timestamp,
    actor: { kind: 'user' },
    type: 'annotation_resolve',
    payload: { annotationId },
  };
}

interface Harness {
  readonly repository: GraphRepository;
  readonly eventLog: MemoryEventLog;
  readonly snapshotStore: MemorySnapshotStore;
}

async function openRepository(
  eventLog = new MemoryEventLog(),
  snapshotStore = new MemorySnapshotStore(),
  snapshotIntervalEvents = 200,
): Promise<Harness & { report: Awaited<ReturnType<typeof GraphRepository.open>>['report'] }> {
  const { repository, report } = await GraphRepository.open({
    workspaceId,
    branchKey,
    eventLog,
    snapshotStore,
    now,
    snapshotIntervalEvents,
  });
  return { repository, eventLog, snapshotStore, report };
}

beforeEach(() => {
  sequence = 0;
});

describe('打开与恢复', () => {
  it('空存储从空地图开始', async () => {
    const { repository, report } = await openRepository();
    expect(report.restoredFrom).toBe('empty');
    expect(repository.snapshot.nodes.size).toBe(0);
  });

  it('重启后从快照与尾部事件恢复到相同状态', async () => {
    const eventLog = new MemoryEventLog();
    const snapshotStore = new MemorySnapshotStore();
    const first = await openRepository(eventLog, snapshotStore, 2);
    await first.repository.append(nodeEvent('a'));
    await first.repository.append(nodeEvent('b'));
    await first.repository.append(nodeEvent('c'));

    const second = await openRepository(eventLog, snapshotStore, 2);
    expect(second.report.restoredFrom).toBe('snapshot');
    expect([...second.repository.snapshot.nodes.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('快照损坏时退化为完整回放而不是拒绝启动', async () => {
    const eventLog = new MemoryEventLog();
    const snapshotStore = new MemorySnapshotStore();
    const first = await openRepository(eventLog, snapshotStore, 1);
    await first.repository.append(nodeEvent('a'));
    snapshotStore.corrupt();

    const second = await openRepository(eventLog, snapshotStore, 1);
    expect(second.report.restoredFrom).toBe('empty');
    expect(second.repository.snapshot.nodes.size).toBe(1);
  });

  it('快照属于其它分支时不被采用', async () => {
    const eventLog = new MemoryEventLog();
    const snapshotStore = new MemorySnapshotStore();
    const first = await openRepository(eventLog, snapshotStore, 1);
    await first.repository.append(nodeEvent('a'));

    const other = await GraphRepository.open({
      workspaceId,
      branchKey: 'feature/x',
      eventLog: new MemoryEventLog(),
      snapshotStore,
      now,
    });
    expect(other.report.restoredFrom).toBe('empty');
    expect(other.repository.snapshot.branchKey).toBe('feature/x');
  });

  it('日志中损坏的行被隔离并在恢复报告中可见', async () => {
    const eventLog = new MemoryEventLog();
    eventLog.injectRawLine('{"broken');
    const { report } = await openRepository(eventLog);
    expect(report.quarantined).toHaveLength(1);
  });

  it('日志中违反领域规则的事件进入 rejected，不中断恢复', async () => {
    const eventLog = new MemoryEventLog();
    await eventLog.append(nodeEvent('a'));
    await eventLog.append(danglingParentEvent());
    await eventLog.append(nodeEvent('b'));

    const { repository, report } = await openRepository(eventLog);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]?.error.code).toBe(errorCodes.UNKNOWN_ENTITY);
    expect(repository.snapshot.nodes.size).toBe(2);
  });
});

describe('写入', () => {
  it('被领域规则拒绝的事件不写入规范日志', async () => {
    const { repository, eventLog } = await openRepository();
    const result = await repository.append(danglingParentEvent());

    expect(result.ok).toBe(false);
    await expect(eventLog.count()).resolves.toBe(0);
  });

  it('重复事件不重复写入日志', async () => {
    const { repository, eventLog } = await openRepository();
    const duplicate = nodeEvent('a');
    await repository.append(duplicate);
    await repository.append(duplicate);

    await expect(eventLog.count()).resolves.toBe(1);
  });

  it('并发调用被串行化，日志顺序与最终状态一致', async () => {
    const { repository, eventLog } = await openRepository();
    await Promise.all([
      repository.append(nodeEvent('a')),
      repository.append(nodeEvent('b')),
      repository.append(nodeEvent('c')),
    ]);

    const { records } = await eventLog.read(0);
    expect(records.map((record) => record.event.eventId)).toEqual([
      'event-1',
      'event-2',
      'event-3',
    ]);
    expect(repository.snapshot.nodes.size).toBe(3);
  });

  it('单次写入失败不会阻塞后续写入', async () => {
    const { repository } = await openRepository();
    const rejected = await repository.append(danglingParentEvent());
    expect(rejected.ok).toBe(false);

    const accepted = await repository.append(nodeEvent('a'));
    expect(accepted.ok).toBe(true);
  });
});

describe('快照触发', () => {
  it('达到阈值后写入快照', async () => {
    const { repository, snapshotStore } = await openRepository(
      new MemoryEventLog(),
      new MemorySnapshotStore(),
      2,
    );
    await repository.append(nodeEvent('a'));
    expect(snapshotStore.saveCount).toBe(0);

    await repository.append(nodeEvent('b'));
    expect(snapshotStore.saveCount).toBe(1);
  });

  it('flush 写入尚未落快照的尾部事件', async () => {
    const { repository, snapshotStore } = await openRepository(
      new MemoryEventLog(),
      new MemorySnapshotStore(),
      100,
    );
    await repository.append(nodeEvent('a'));
    await repository.flush();

    expect(snapshotStore.saveCount).toBe(1);
  });

  it('没有新事件时 flush 不重复写快照', async () => {
    const { repository, snapshotStore } = await openRepository();
    await repository.flush();
    expect(snapshotStore.saveCount).toBe(0);
  });

  it('快照记录的事件序号与日志一致', async () => {
    const eventLog = new MemoryEventLog();
    const snapshotStore = new MemorySnapshotStore();
    const { repository } = await openRepository(eventLog, snapshotStore, 100);
    await repository.append(nodeEvent('a'));
    await repository.append(nodeEvent('b'));
    await repository.flush();

    const stored = await snapshotStore.load();
    expect(stored?.document.lastEventSeq).toBe(2);
  });
});

describe('30 天保留压缩', () => {
  it('保留当前地图，只删除过期原始事件并清理旧的已解决对话正文', async () => {
    const eventLog = new MemoryEventLog();
    const snapshotStore = new MemorySnapshotStore();
    const { repository } = await openRepository(eventLog, snapshotStore);
    const target = { ...nodeEvent('target'), timestamp: '2026-06-01T00:00:00.000Z' };
    await repository.append(target);
    await repository.append(annotationEvent('old.resolved', '2026-06-01T00:00:00.000Z'));
    await repository.append(resolveAnnotationEvent('old.resolved', '2026-06-02T00:00:00.000Z'));
    await repository.append(annotationEvent('old.unresolved', '2026-06-01T00:00:00.000Z'));
    await repository.append(annotationEvent('old.pinned', '2026-06-01T00:00:00.000Z', true));
    await repository.append(resolveAnnotationEvent('old.pinned', '2026-06-02T00:00:00.000Z'));
    const recent = { ...nodeEvent('recent'), timestamp: '2026-08-10T00:00:00.000Z' };
    await repository.append(recent);

    const report = await repository.compact('2026-07-13T00:00:00.000Z');
    expect(report).toEqual({ prunedEvents: 6, retainedEvents: 1, redactedAnnotations: 1 });
    expect(repository.snapshot.nodes.has('target')).toBe(true);
    expect(repository.snapshot.nodes.has('recent')).toBe(true);
    expect(repository.snapshot.annotations.get('old.resolved')?.messages[0]?.body).toContain(
      '已按本地保留策略清理',
    );
    expect(repository.snapshot.annotations.get('old.unresolved')?.messages[0]?.body).toContain(
      'secret conversation',
    );
    expect(repository.snapshot.annotations.get('old.pinned')?.messages[0]?.body).toContain(
      'secret conversation',
    );
    const { records } = await eventLog.read(0);
    expect(records.map((record) => record.event.eventId)).toEqual([recent.eventId]);

    const reopened = await openRepository(eventLog, snapshotStore);
    expect(reopened.repository.snapshot.nodes.has('target')).toBe(true);
    expect(reopened.repository.snapshot.nodes.has('recent')).toBe(true);
    expect(
      reopened.repository.snapshot.annotations.get('old.resolved')?.messages[0]?.body,
    ).toContain('已按本地保留策略清理');
  });

  it('无过期内容时不写快照或替换日志', async () => {
    const snapshotStore = new MemorySnapshotStore();
    const { repository, eventLog } = await openRepository(new MemoryEventLog(), snapshotStore);
    const recent = { ...nodeEvent('recent'), timestamp: '2026-08-10T00:00:00.000Z' };
    await repository.append(recent);

    await expect(repository.compact('2026-07-13T00:00:00.000Z')).resolves.toEqual({
      prunedEvents: 0,
      retainedEvents: 1,
      redactedAnnotations: 0,
    });
    expect(snapshotStore.saveCount).toBe(1);
    await expect(eventLog.count()).resolves.toBe(1);
  });

  it('拒绝无效 cutoff', async () => {
    const { repository } = await openRepository();
    await expect(repository.compact('not-a-date')).rejects.toThrow(/cutoff/u);
  });
});
