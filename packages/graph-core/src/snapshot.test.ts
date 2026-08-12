import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  createEmptySnapshot,
  fromSnapshotDocument,
  hashSnapshot,
  toSnapshotDocument,
} from './snapshot.js';
import { replay } from './replay.js';
import {
  branchKey,
  changeStart,
  edge,
  edgeUpsert,
  node,
  nodeUpsert,
  resetEventSequence,
  workspaceId,
} from '@god-view/testkit';

function base() {
  return createEmptySnapshot({
    workspaceId,
    branchKey,
    createdAt: '2026-08-07T09:00:00.000Z',
    baseGitRevision: 'abc123',
  });
}

describe('规范化序列化', () => {
  it('对象键顺序不影响输出', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('数组顺序仍然是语义的一部分', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('忽略 undefined 值，与 JSON 序列化语义一致', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it.each([
    [null, 'null'],
    ['text', '"text"'],
    [42, '42'],
    [true, 'true'],
  ])('原子值 %s 序列化为 %s', (value, expected) => {
    expect(canonicalize(value)).toBe(expected);
  });

  it('嵌套结构递归排序', () => {
    expect(canonicalize({ outer: { z: 1, a: [{ y: 1, x: 2 }] } })).toBe(
      '{"outer":{"a":[{"x":2,"y":1}],"z":1}}',
    );
  });
});

describe('快照文档转换', () => {
  it('节点、关系与事件 ID 按字典序排序，保证序列化结果稳定', () => {
    resetEventSequence();
    const snapshot = replay(base(), [
      nodeUpsert(node('zeta')),
      nodeUpsert(node('alpha')),
      edgeUpsert(edge('e-z', 'zeta', 'alpha')),
      edgeUpsert(edge('e-a', 'alpha', 'zeta')),
    ]).snapshot;

    const document = toSnapshotDocument(snapshot);
    expect(document.nodes.map((entry) => entry.id)).toEqual(['alpha', 'zeta']);
    expect(document.edges.map((entry) => entry.id)).toEqual(['e-a', 'e-z']);
    expect([...document.appliedEventIds]).toEqual([...document.appliedEventIds].sort());
  });

  it('往返转换保持语义等价', () => {
    resetEventSequence();
    const snapshot = replay(base(), [
      changeStart('cs-1'),
      nodeUpsert(node('a'), { changeSetId: 'cs-1' }),
    ]).snapshot;

    const roundTripped = fromSnapshotDocument(toSnapshotDocument(snapshot));
    expect(hashSnapshot(toSnapshotDocument(roundTripped))).toBe(
      hashSnapshot(toSnapshotDocument(snapshot)),
    );
    expect(roundTripped.activeChanges.get('cs-1')?.intent).toBe('构建订单模块');
  });

  it('保留 Git 基线；缺省时不写入该字段', () => {
    expect(toSnapshotDocument(base()).baseGitRevision).toBe('abc123');
    const withoutGit = createEmptySnapshot({
      workspaceId,
      branchKey,
      createdAt: '2026-08-07T09:00:00.000Z',
    });
    expect('baseGitRevision' in toSnapshotDocument(withoutGit)).toBe(false);
    expect(fromSnapshotDocument(toSnapshotDocument(withoutGit)).baseGitRevision).toBeUndefined();
  });

  it('没有活动变更时 activeChanges 为空数组', () => {
    expect(toSnapshotDocument(base()).activeChanges).toEqual([]);
    const { activeChanges: _omitted, ...withoutChanges } = toSnapshotDocument(base());
    expect(fromSnapshotDocument(withoutChanges).activeChanges.size).toBe(0);
  });

  it('旧快照缺少 1.1-1.3 集合时全部恢复为空集合', () => {
    const document = toSnapshotDocument(base());
    const {
      activeChanges: _active,
      stories: _stories,
      annotations: _annotations,
      writeAccessRequests: _requests,
      changeProposals: _proposals,
      completedChanges: _completed,
      ...legacy
    } = document;
    const restored = fromSnapshotDocument(legacy);
    expect(restored.activeChanges.size).toBe(0);
    expect(restored.stories.size).toBe(0);
    expect(restored.annotations.size).toBe(0);
    expect(restored.writeAccessRequests.size).toBe(0);
    expect(restored.changeProposals.size).toBe(0);
    expect(restored.completedChanges.size).toBe(0);
  });

  it('讲解与标注集合按 ID 排序并能从文档恢复索引', () => {
    const timestamp = '2026-08-07T09:00:00.000Z';
    const snapshot = {
      ...base(),
      stories: new Map([
        [
          'z-story',
          {
            id: 'z-story',
            type: 'key_flow' as const,
            title: 'Z',
            steps: [{ order: 0, focusNodeIds: [], caption: 'Z' }],
          },
        ],
        [
          'a-story',
          {
            id: 'a-story',
            type: 'key_flow' as const,
            title: 'A',
            steps: [{ order: 0, focusNodeIds: [], caption: 'A' }],
          },
        ],
      ]),
      annotations: new Map([
        [
          'z-note',
          {
            id: 'z-note',
            type: 'note' as const,
            status: 'sent' as const,
            target: { codeLocations: [{ path: 'z.ts' }], mapRevision: 0 },
            messages: [
              { id: 'z-message', author: 'user' as const, body: 'Z', createdAt: timestamp },
            ],
            createdAt: timestamp,
          },
        ],
        [
          'a-note',
          {
            id: 'a-note',
            type: 'note' as const,
            status: 'sent' as const,
            target: { codeLocations: [{ path: 'a.ts' }], mapRevision: 0 },
            messages: [
              { id: 'a-message', author: 'user' as const, body: 'A', createdAt: timestamp },
            ],
            createdAt: timestamp,
          },
        ],
      ]),
    };
    const document = toSnapshotDocument(snapshot);
    expect(document.stories?.map((story) => story.id)).toEqual(['a-story', 'z-story']);
    expect(document.annotations?.map((annotation) => annotation.id)).toEqual(['a-note', 'z-note']);
    const restored = fromSnapshotDocument(document);
    expect(restored.stories.has('a-story')).toBe(true);
    expect(restored.annotations.has('z-note')).toBe(true);
  });
});

describe('内容哈希', () => {
  it('相同内容得到相同哈希', () => {
    expect(hashSnapshot(toSnapshotDocument(base()))).toBe(hashSnapshot(toSnapshotDocument(base())));
  });

  it('内容变化后哈希变化', () => {
    resetEventSequence();
    const changed = replay(base(), [nodeUpsert(node('a'))]).snapshot;
    expect(hashSnapshot(toSnapshotDocument(changed))).not.toBe(
      hashSnapshot(toSnapshotDocument(base())),
    );
  });

  it('输出固定长度的十六进制串', () => {
    expect(hashSnapshot(toSnapshotDocument(base()))).toMatch(/^[0-9a-f]{16}$/u);
  });
});
