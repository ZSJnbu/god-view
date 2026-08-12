import type { GraphEdge, GraphNode, GraphSnapshotDocument, GuidedStory } from '@god-view/protocol';
import { currentProtocolVersion } from '@god-view/protocol';
import type { ViewCapabilities } from '@god-view/webview-bridge';

/** Webview 测试用的图 fixtures。时间与版本号显式给出，不依赖真实时钟。 */

export function makeNode(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: 'module',
    label: id,
    source: {
      kind: 'agent_declared',
      actor: { kind: 'agent' },
      declaredAt: '2026-08-07T10:00:00.000Z',
    },
    codeValidation: { status: 'unverified' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: '2026-08-07T10:00:00.000Z',
    revision: 1,
    ...extra,
  };
}

export function makeEdge(
  id: string,
  from: string,
  to: string,
  extra: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id,
    from,
    to,
    type: 'depends_on',
    source: {
      kind: 'agent_declared',
      actor: { kind: 'agent' },
      declaredAt: '2026-08-07T10:00:00.000Z',
    },
    codeValidation: { status: 'unverified' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: '2026-08-07T10:00:00.000Z',
    revision: 1,
    ...extra,
  };
}

export function makeDocument(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[] = [],
  revision = 1,
  stories: readonly GuidedStory[] = [],
): GraphSnapshotDocument {
  return {
    schemaVersion: currentProtocolVersion,
    workspaceId: 'ws-test',
    branchKey: 'main',
    revision,
    lastEventSeq: revision,
    createdAt: '2026-08-07T10:00:00.000Z',
    nodes: [...nodes],
    edges: [...edges],
    stories: [...stories],
    appliedEventIds: [],
  };
}

export function makeStory(id = 'story.intro', extra: Partial<GuidedStory> = {}): GuidedStory {
  return {
    id,
    type: 'project_intro',
    title: '认识项目',
    steps: [
      { order: 0, focusNodeIds: ['a'], caption: '从入口开始' },
      { order: 1, focusNodeIds: ['b'], caption: '进入核心模块' },
      { order: 2, focusNodeIds: ['a', 'b'], caption: '完成主流程' },
    ],
    ...extra,
  };
}

export const capabilities: ViewCapabilities = {
  hasGit: true,
  canExecuteChanges: false,
  reducedMotion: false,
  branchKey: 'main',
};
