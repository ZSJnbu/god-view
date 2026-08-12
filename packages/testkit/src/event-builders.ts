import {
  currentProtocolVersion,
  type AgentEdgeDeclaration,
  type AgentNodeDeclaration,
  type AnnotationAnswerEvent,
  type AnnotationCreateEvent,
  type AnnotationMessage,
  type AnnotationResolveEvent,
  type AnnotationThread,
  type ChangeCompleteEvent,
  type ChangeStartEvent,
  type EdgeRemoveEvent,
  type EdgeUpsertEvent,
  type EventEnvelope,
  type NodeRemoveEvent,
  type NodeUpsertEvent,
  type SessionEndEvent,
  type SessionStartEvent,
  type StoryUpsertEvent,
  type GuidedStory,
} from '@god-view/protocol';

/**
 * 测试事件构造器。
 *
 * 时间与 ID 全部由调用方显式给出，测试不依赖真实时钟或随机数
 * （CODING_STANDARDS.md §17）。
 */
export const workspaceId = 'ws-test';
export const branchKey = 'main';
export const sessionId = 'session-1';

let sequence = 0;

export function resetEventSequence(): void {
  sequence = 0;
}

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  sequence += 1;
  return {
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId,
    eventId: `event-${String(sequence)}`,
    timestamp: `2026-08-07T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    actor: { kind: 'agent', adapterId: 'claude-code' },
    ...overrides,
  };
}

export function sessionStart(overrides?: Partial<EventEnvelope>): SessionStartEvent {
  return { ...envelope(overrides), type: 'session_start', payload: { adapterId: 'claude-code' } };
}

export function sessionEnd(overrides?: Partial<EventEnvelope>): SessionEndEvent {
  return { ...envelope(overrides), type: 'session_end', payload: { status: 'completed' } };
}

export function changeStart(
  changeSetId: string,
  intent = '构建订单模块',
  overrides?: Partial<EventEnvelope>,
): ChangeStartEvent {
  return { ...envelope(overrides), type: 'change_start', payload: { changeSetId, intent } };
}

export function changeComplete(
  changeSetId: string,
  status: 'completed' | 'failed' | 'interrupted' = 'completed',
  overrides?: Partial<EventEnvelope>,
): ChangeCompleteEvent {
  return {
    ...envelope(overrides),
    type: 'change_complete',
    payload: { changeSetId, status },
  };
}

export function node(id: string, extra: Partial<AgentNodeDeclaration> = {}): AgentNodeDeclaration {
  return { id, type: 'module', label: id, ...extra };
}

export function nodeUpsert(
  declaration: AgentNodeDeclaration,
  options: { changeSetId?: string; envelope?: Partial<EventEnvelope> } = {},
): NodeUpsertEvent {
  return {
    ...envelope(options.envelope),
    type: 'node_upsert',
    payload: {
      node: declaration,
      ...(options.changeSetId === undefined ? {} : { changeSetId: options.changeSetId }),
    },
  };
}

export function nodeRemove(
  nodeId: string,
  options: { reason?: string; changeSetId?: string; envelope?: Partial<EventEnvelope> } = {},
): NodeRemoveEvent {
  return {
    ...envelope(options.envelope),
    type: 'node_remove',
    payload: {
      nodeId,
      reason: options.reason ?? '目录已删除',
      ...(options.changeSetId === undefined ? {} : { changeSetId: options.changeSetId }),
    },
  };
}

export function edge(
  id: string,
  from: string,
  to: string,
  extra: Partial<AgentEdgeDeclaration> = {},
): AgentEdgeDeclaration {
  return { id, from, to, type: 'depends_on', ...extra };
}

export function edgeUpsert(
  declaration: AgentEdgeDeclaration,
  options: { changeSetId?: string; envelope?: Partial<EventEnvelope> } = {},
): EdgeUpsertEvent {
  return {
    ...envelope(options.envelope),
    type: 'edge_upsert',
    payload: {
      edge: declaration,
      ...(options.changeSetId === undefined ? {} : { changeSetId: options.changeSetId }),
    },
  };
}

export function storyUpsert(
  story: GuidedStory,
  overrides?: Partial<EventEnvelope>,
): StoryUpsertEvent {
  return { ...envelope(overrides), type: 'story_upsert', payload: { story } };
}

export function annotationCreate(
  annotation: AnnotationThread,
  overrides?: Partial<EventEnvelope>,
): AnnotationCreateEvent {
  return {
    ...envelope({ actor: { kind: 'user' }, ...overrides }),
    type: 'annotation_create',
    payload: { annotation },
  };
}

export function annotationAnswer(
  annotationId: string,
  message: AnnotationMessage,
  overrides?: Partial<EventEnvelope>,
): AnnotationAnswerEvent {
  return {
    ...envelope({ actor: { kind: 'agent', adapterId: 'test-agent' }, ...overrides }),
    type: 'annotation_answer',
    payload: { annotationId, message },
  };
}

export function annotationResolve(
  annotationId: string,
  overrides?: Partial<EventEnvelope>,
): AnnotationResolveEvent {
  return {
    ...envelope({ actor: { kind: 'user' }, ...overrides }),
    type: 'annotation_resolve',
    payload: { annotationId },
  };
}

export function edgeRemove(
  edgeId: string,
  options: { reason?: string; changeSetId?: string; envelope?: Partial<EventEnvelope> } = {},
): EdgeRemoveEvent {
  return {
    ...envelope(options.envelope),
    type: 'edge_remove',
    payload: {
      edgeId,
      reason: options.reason ?? '依赖已解除',
      ...(options.changeSetId === undefined ? {} : { changeSetId: options.changeSetId }),
    },
  };
}
