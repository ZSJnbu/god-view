import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, type GraphSnapshot } from '@god-view/graph-core';
import type { AnnotationThread, GuidedStory } from '@god-view/protocol';
import { diffSnapshots, isEmptyPatch } from './map-patch.js';

const story: GuidedStory = {
  id: 'story.intro',
  type: 'project_intro',
  title: '认识项目',
  steps: [
    { order: 0, focusNodeIds: ['a'], caption: '从入口开始' },
    { order: 1, focusNodeIds: ['b'], caption: '进入核心模块' },
    { order: 2, focusNodeIds: ['c'], caption: '最后写入存储' },
  ],
};

function empty(): GraphSnapshot {
  return createEmptySnapshot({
    workspaceId: 'ws-test',
    branchKey: 'main',
    createdAt: '2026-08-11T00:00:00.000Z',
  });
}

describe('地图补丁中的讲解', () => {
  it('新增讲解进入增量补丁并使补丁非空', () => {
    const before = empty();
    const after: GraphSnapshot = { ...before, revision: 1, stories: new Map([[story.id, story]]) };
    const patch = diffSnapshots(before, after);

    expect(patch.upsertedStories).toEqual([story]);
    expect(isEmptyPatch(patch)).toBe(false);
  });

  it('相同讲解引用不重复发送', () => {
    const snapshot: GraphSnapshot = { ...empty(), stories: new Map([[story.id, story]]) };
    expect(isEmptyPatch(diffSnapshots(snapshot, snapshot))).toBe(true);
  });
});

describe('地图补丁中的标注', () => {
  const annotation: AnnotationThread = {
    id: 'annotation.a',
    type: 'note',
    status: 'sent',
    target: { nodeIds: ['a'], mapRevision: 1 },
    messages: [
      { id: 'message.a', author: 'user', body: '注意这里', createdAt: '2026-08-11T00:00:01Z' },
    ],
    createdAt: '2026-08-11T00:00:01Z',
  };

  it('新增标注进入增量补丁并使补丁非空', () => {
    const before = empty();
    const after: GraphSnapshot = {
      ...before,
      revision: 1,
      annotations: new Map([[annotation.id, annotation]]),
    };
    const patch = diffSnapshots(before, after);
    expect(patch.upsertedAnnotations).toEqual([annotation]);
    expect(isEmptyPatch(patch)).toBe(false);
  });
});
