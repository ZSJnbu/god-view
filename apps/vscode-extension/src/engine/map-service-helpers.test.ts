import { describe, expect, it } from 'vitest';
import { fromSnapshotDocument } from '@god-view/graph-core';
import type { GraphSnapshotDocument } from '@god-view/protocol';
import { publicDocument } from './public-document.js';

const timestamp = '2026-08-12T10:00:00.000Z';

function document(): GraphSnapshotDocument {
  return {
    schemaVersion: '1.3',
    workspaceId: 'ws-test',
    branchKey: 'main',
    revision: 1,
    lastEventSeq: 1,
    createdAt: timestamp,
    nodes: [
      {
        id: 'module.orders',
        type: 'module',
        label: 'Orders',
        paths: ['src/orders'],
        source: { kind: 'agent_declared', actor: { kind: 'agent' }, declaredAt: timestamp },
        codeValidation: { status: 'unverified' },
        userConfirmation: { status: 'unconfirmed' },
        lifecycle: { status: 'active' },
        updatedAt: timestamp,
        revision: 1,
      },
    ],
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

describe('publicDocument', () => {
  it('把运行时校验结论投影到 Webview 文档，不改动事件真源', () => {
    const snapshot = fromSnapshotDocument(document());
    const projected = publicDocument(snapshot, undefined, [
      {
        targetId: 'module.orders',
        status: 'verified',
        level: 'L0',
        validator: 'god-view.file-fact',
        evidence: [{ kind: 'file_exists', location: { path: 'src/orders' } }],
        checkedAt: timestamp,
      },
    ]);

    expect(projected.nodes[0]?.codeValidation).toMatchObject({
      status: 'verified',
      level: 'L0',
      validator: 'god-view.file-fact',
    });
    expect(snapshot.nodes.get('module.orders')?.codeValidation.status).toBe('unverified');
  });
});
