import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashSnapshot, toSnapshotDocument, createEmptySnapshot } from '@god-view/graph-core';
import { currentProtocolVersion, type GodViewEvent } from '@god-view/protocol';
import { FileEventLog } from './file-event-log.js';
import { FileSnapshotStore } from './file-snapshot-store.js';
import { resolveBranchStorage, toDirectorySegment } from './paths.js';
import { writeFileAtomic } from './atomic-file.js';

const workspaceId = 'ws-test';
const branchKey = 'main';

function event(eventId: string): GodViewEvent {
  return {
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId: 'session-1',
    eventId,
    timestamp: '2026-08-07T10:00:00.000Z',
    type: 'node_upsert',
    payload: { node: { id: 'module.orders', type: 'module', label: '订单' } },
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'god-view-storage-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('存储路径隔离', () => {
  it('按 workspace 与 branch 分目录', () => {
    const layout = resolveBranchStorage(root, workspaceId, branchKey);
    expect(layout.eventLogFile.startsWith(layout.root)).toBe(true);
    expect(layout.snapshotFile.startsWith(layout.root)).toBe(true);
  });

  it('分支名中的斜杠不会产生嵌套目录或路径穿越', () => {
    const segment = toDirectorySegment('feature/../../etc');
    expect(segment).not.toContain('/');
    expect(segment).not.toContain('..');
  });

  it('不同分支即使清洗后同名也不会碰撞', () => {
    expect(toDirectorySegment('feature/a')).not.toBe(toDirectorySegment('feature-a'));
  });

  it('空标识符仍产生可用目录名', () => {
    expect(toDirectorySegment('')).toMatch(/^default-[0-9a-f]{8}$/u);
  });
});

describe('事件日志', () => {
  it('不存在的日志读取为空而不是报错', async () => {
    const log = new FileEventLog(join(root, 'events.jsonl'), join(root, 'quarantine.jsonl'));
    await expect(log.read(0)).resolves.toEqual({ records: [], quarantined: [] });
    await expect(log.count()).resolves.toBe(0);
  });

  it('追加后可按顺序读回', async () => {
    const log = new FileEventLog(join(root, 'events.jsonl'), join(root, 'quarantine.jsonl'));
    await log.append(event('e-1'));
    await log.append(event('e-2'));

    const { records } = await log.read(0);
    expect(records.map((record) => record.event.eventId)).toEqual(['e-1', 'e-2']);
    expect(records.map((record) => record.seq)).toEqual([1, 2]);
    await expect(log.count()).resolves.toBe(2);
  });

  it('原子压缩日志后保留序号水位且不留下旧事件正文', async () => {
    const logFile = join(root, 'events.jsonl');
    const log = new FileEventLog(logFile, join(root, 'quarantine.jsonl'));
    await log.append(event('old'));
    await log.append(event('kept-1'));
    await log.append(event('kept-2'));
    await log.compact(
      [
        { seq: 2, event: event('kept-1') },
        { seq: 3, event: event('kept-2') },
      ],
      3,
    );

    const { records } = await log.read(0);
    expect(records.map((record) => [record.seq, record.event.eventId])).toEqual([
      [2, 'kept-1'],
      [3, 'kept-2'],
    ]);
    await expect(readFile(logFile, 'utf8')).resolves.not.toContain('"eventId":"old"');
    await expect(readFile(`${logFile}.tmp`, 'utf8')).rejects.toThrow();
  });

  it('只读取指定序号之后的事件', async () => {
    const log = new FileEventLog(join(root, 'events.jsonl'), join(root, 'quarantine.jsonl'));
    await log.append(event('e-1'));
    await log.append(event('e-2'));

    const { records } = await log.read(1);
    expect(records.map((record) => record.event.eventId)).toEqual(['e-2']);
  });

  it('损坏行进入隔离区，其余事件继续可用', async () => {
    const logFile = join(root, 'events.jsonl');
    const quarantineFile = join(root, 'quarantine.jsonl');
    const log = new FileEventLog(logFile, quarantineFile);
    await log.append(event('e-1'));
    await writeFile(logFile, `${JSON.stringify(event('e-1'))}\n{"half-written`, 'utf8');

    const { records, quarantined } = await log.read(0);
    expect(records).toHaveLength(1);
    expect(quarantined).toEqual([{ seq: 2, reason: 'JSON 解析失败' }]);
    await expect(readFile(quarantineFile, 'utf8')).resolves.toContain('"seq":2');
  });

  it('不符合协议的事件被隔离，不进入图状态', async () => {
    const logFile = join(root, 'events.jsonl');
    await writeFile(logFile, `${JSON.stringify({ type: 'node_upsert' })}\n`, 'utf8');
    const log = new FileEventLog(logFile, join(root, 'quarantine.jsonl'));

    const { records, quarantined } = await log.read(0);
    expect(records).toEqual([]);
    expect(quarantined).toHaveLength(1);
  });

  it('隔离记录只保存序号与原因，不复制原始内容', async () => {
    const logFile = join(root, 'events.jsonl');
    const quarantineFile = join(root, 'quarantine.jsonl');
    await writeFile(logFile, '{"secret":"token-abc123"\n', 'utf8');
    await new FileEventLog(logFile, quarantineFile).read(0);

    await expect(readFile(quarantineFile, 'utf8')).resolves.not.toContain('token-abc123');
  });

  it('忽略空行', async () => {
    const logFile = join(root, 'events.jsonl');
    await writeFile(logFile, `\n${JSON.stringify(event('e-1'))}\n\n`, 'utf8');
    const log = new FileEventLog(logFile, join(root, 'quarantine.jsonl'));

    const { records, quarantined } = await log.read(0);
    expect(records).toHaveLength(1);
    expect(quarantined).toEqual([]);
    await expect(log.count()).resolves.toBe(1);
  });
});

describe('快照存储', () => {
  function document() {
    return toSnapshotDocument(
      createEmptySnapshot({ workspaceId, branchKey, createdAt: '2026-08-07T09:00:00.000Z' }),
    );
  }

  it('保存后可读回并校验内容哈希', async () => {
    const store = new FileSnapshotStore(join(root, 'snapshot.json'));
    await store.save(document());

    const loaded = await store.load();
    expect(loaded?.contentHash).toBe(hashSnapshot(document()));
  });

  it('不存在的快照返回 undefined', async () => {
    await expect(new FileSnapshotStore(join(root, 'none.json')).load()).resolves.toBeUndefined();
  });

  it('内容被篡改导致哈希不匹配时视为损坏', async () => {
    const filePath = join(root, 'snapshot.json');
    const store = new FileSnapshotStore(filePath);
    await store.save(document());

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
      contentHash: string;
      document: { revision: number };
    };
    raw.document.revision = 99;
    await writeFileAtomic(filePath, JSON.stringify(raw));

    await expect(store.load()).resolves.toBeUndefined();
  });

  it('半写的 JSON 视为损坏而不是抛出异常', async () => {
    const filePath = join(root, 'snapshot.json');
    await writeFile(filePath, '{"contentHash":"abc","document":{', 'utf8');
    await expect(new FileSnapshotStore(filePath).load()).resolves.toBeUndefined();
  });

  it('不符合协议的快照视为损坏', async () => {
    const filePath = join(root, 'snapshot.json');
    await writeFile(
      filePath,
      JSON.stringify({ contentHash: 'abc', document: { revision: -1 } }),
      'utf8',
    );
    await expect(new FileSnapshotStore(filePath).load()).resolves.toBeUndefined();
  });

  it('写入使用临时文件后原子替换，不留下 .tmp 残留', async () => {
    const filePath = join(root, 'snapshot.json');
    const store = new FileSnapshotStore(filePath);
    await store.save(document());
    await expect(readFile(`${filePath}.tmp`, 'utf8')).rejects.toThrow();
  });

  it('并发写同一目标不会争用临时文件或产生半写内容', async () => {
    const filePath = join(root, 'concurrent.json');
    const first = JSON.stringify({ writer: 'first', payload: 'a'.repeat(16_384) });
    const second = JSON.stringify({ writer: 'second', payload: 'b'.repeat(16_384) });

    await expect(
      Promise.all([writeFileAtomic(filePath, first), writeFileAtomic(filePath, second)]),
    ).resolves.toEqual([undefined, undefined]);

    expect([first, second]).toContain(await readFile(filePath, 'utf8'));
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('文件读取错误处理', () => {
  it('目标是目录等非 ENOENT 错误照常抛出，不伪装成空内容', async () => {
    const log = new FileEventLog(root, join(root, 'quarantine.jsonl'));
    await expect(log.read(0)).rejects.toThrow();
  });
});
