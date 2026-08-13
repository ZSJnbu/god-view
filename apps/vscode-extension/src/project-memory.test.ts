import { describe, expect, it } from 'vitest';
import { fromSnapshotDocument } from '@god-view/graph-core';
import type { GraphSnapshotDocument } from '@god-view/protocol';
import { serializeProjectMemory } from './project-memory.js';

describe('ProjectMemory', () => {
  it('serializes current map and recent conversation into readable project memory', () => {
    const text = serializeProjectMemory(
      {
        threadId: 'thread-1',
        agent: 'codex',
        state: 'idle',
        messages: [
          { id: 'm1', role: 'user', body: '做成个人博客', createdAt: '2026-08-13T00:00:00Z' },
          { id: 'm2', role: 'agent', body: '会新增文章模块', createdAt: '2026-08-13T00:00:01Z' },
        ],
      },
      fromSnapshotDocument(document()),
    );
    expect(text).toContain('# GODVIEW — 项目记忆');
    expect(text).toContain('地图版本：r4');
    expect(text).toContain('做成个人博客');
  });
});

function document(): GraphSnapshotDocument {
  return {
    schemaVersion: '1.3',
    workspaceId: 'ws-test',
    branchKey: 'main',
    revision: 4,
    lastEventSeq: 4,
    createdAt: '2026-08-13T00:00:00Z',
    nodes: [],
    edges: [],
    activeChanges: [],
    stories: [],
    annotations: [],
    writeAccessRequests: [],
    changeProposals: [],
    completedChanges: [],
    appliedEventIds: [],
  };
}
