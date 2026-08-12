import {
  err,
  errorCodes,
  ok,
  type AnnotationAnswerEvent,
  type AnnotationCreateEvent,
  type AnnotationResolveEvent,
  type AnnotationThread,
  type GodViewEvent,
  type GuidedStory,
  type Identifier,
  type Result,
} from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import type { GraphSnapshot } from './snapshot.js';

type AnnotationEvent = AnnotationCreateEvent | AnnotationAnswerEvent | AnnotationResolveEvent;
type ReduceResult = Result<GraphSnapshot, DomainError>;

function commit(
  snapshot: GraphSnapshot,
  event: GodViewEvent,
  annotations: ReadonlyMap<Identifier, AnnotationThread>,
  stories: ReadonlyMap<Identifier, GuidedStory> = snapshot.stories,
): GraphSnapshot {
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    lastEventSeq: snapshot.lastEventSeq + 1,
    annotations,
    stories,
    appliedEventIds: new Set([...snapshot.appliedEventIds, event.eventId]),
  };
}

function validateStory(snapshot: GraphSnapshot, story: GuidedStory): DomainError | undefined {
  if (new Set(story.steps.map((step) => step.order)).size !== story.steps.length) {
    return domainError(
      errorCodes.SCHEMA_VIOLATION,
      `讲解 ${story.id} 的步骤 order 必须唯一`,
      story.id,
    );
  }
  for (const step of story.steps) {
    const missingNode = step.focusNodeIds.find((id) => !snapshot.nodes.has(id));
    if (missingNode !== undefined) {
      return domainError(
        errorCodes.UNKNOWN_ENTITY,
        `讲解 ${story.id} 引用了不存在的节点 ${missingNode}`,
        missingNode,
      );
    }
    const missingEdge = (step.focusEdgeIds ?? []).find((id) => !snapshot.edges.has(id));
    if (missingEdge !== undefined) {
      return domainError(
        errorCodes.UNKNOWN_ENTITY,
        `讲解 ${story.id} 引用了不存在的关系 ${missingEdge}`,
        missingEdge,
      );
    }
  }
  return undefined;
}

function normalizedStory(story: GuidedStory): GuidedStory {
  return {
    ...story,
    steps: [...story.steps]
      .sort((left, right) => left.order - right.order)
      .map((step) => ({
        ...step,
        focusNodeIds: [...step.focusNodeIds],
        ...(step.focusEdgeIds === undefined ? {} : { focusEdgeIds: [...step.focusEdgeIds] }),
      })),
  };
}

function targetReferenceError(
  snapshot: GraphSnapshot,
  annotation: AnnotationThread,
): DomainError | undefined {
  const target = annotation.target;
  const missingNode = (target.nodeIds ?? []).find((id) => !snapshot.nodes.has(id));
  if (missingNode !== undefined) {
    return domainError(
      errorCodes.UNKNOWN_ENTITY,
      `标注引用了不存在的节点 ${missingNode}`,
      missingNode,
    );
  }
  const missingEdge = (target.edgeIds ?? []).find((id) => !snapshot.edges.has(id));
  if (missingEdge !== undefined) {
    return domainError(
      errorCodes.UNKNOWN_ENTITY,
      `标注引用了不存在的关系 ${missingEdge}`,
      missingEdge,
    );
  }
  if (target.storyId !== undefined && !snapshot.stories.has(target.storyId)) {
    return domainError(
      errorCodes.UNKNOWN_ENTITY,
      `标注引用了不存在的讲解 ${target.storyId}`,
      target.storyId,
    );
  }
  if (target.changeSetId !== undefined && !snapshot.activeChanges.has(target.changeSetId)) {
    return domainError(
      errorCodes.UNKNOWN_CHANGE_SET,
      `标注引用了不存在的变更 ${target.changeSetId}`,
      target.changeSetId,
    );
  }
  return undefined;
}

function targetError(
  snapshot: GraphSnapshot,
  annotation: AnnotationThread,
): DomainError | undefined {
  const target = annotation.target;
  const collectionTargets =
    (target.nodeIds?.length ?? 0) +
    (target.edgeIds?.length ?? 0) +
    (target.codeLocations?.length ?? 0);
  if (collectionTargets === 0 && target.storyId === undefined && target.changeSetId === undefined) {
    return domainError(
      errorCodes.SCHEMA_VIOLATION,
      `标注 ${annotation.id} 必须至少关联一个实体或代码位置`,
      annotation.id,
    );
  }
  if (target.mapRevision > snapshot.revision) {
    return domainError(
      errorCodes.STALE_MAP_REVISION,
      `标注 ${annotation.id} 引用了未来地图版本 ${String(target.mapRevision)}`,
      annotation.id,
    );
  }
  return targetReferenceError(snapshot, annotation);
}

function create(snapshot: GraphSnapshot, event: AnnotationCreateEvent): ReduceResult {
  const annotation = event.payload.annotation;
  if (event.actor?.kind !== 'user')
    return err(domainError(errorCodes.UNSUPPORTED, '只有用户可以创建原位标注', annotation.id));
  if (snapshot.annotations.has(annotation.id))
    return err(
      domainError(errorCodes.STABLE_ID_VIOLATION, `标注 ${annotation.id} 已存在`, annotation.id),
    );
  if (!['draft', 'sent'].includes(annotation.status))
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, '新标注只能处于 draft 或 sent 状态', annotation.id),
    );
  if (annotation.messages.some((message) => message.author !== 'user'))
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, '创建标注时只能包含用户消息', annotation.id),
    );
  if (new Set(annotation.messages.map((message) => message.id)).size !== annotation.messages.length)
    return err(domainError(errorCodes.STABLE_ID_VIOLATION, '标注消息 ID 不能重复', annotation.id));
  const invalid = targetError(snapshot, annotation);
  if (invalid !== undefined) return err(invalid);
  const annotations = new Map(snapshot.annotations);
  annotations.set(annotation.id, annotation);
  return ok(commit(snapshot, event, annotations));
}

function answer(snapshot: GraphSnapshot, event: AnnotationAnswerEvent): ReduceResult {
  const current = snapshot.annotations.get(event.payload.annotationId);
  if (current === undefined)
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `标注 ${event.payload.annotationId} 不存在`,
        event.payload.annotationId,
      ),
    );
  if (event.actor?.kind !== 'agent' || event.payload.message.author !== 'agent')
    return err(domainError(errorCodes.UNSUPPORTED, '只有 Agent 可以提交解释答案', current.id));
  if (!['sent', 'answered', 'needs_clarification'].includes(current.status))
    return err(
      domainError(
        errorCodes.SCHEMA_VIOLATION,
        `标注 ${current.id} 在 ${current.status} 状态下不能回答`,
        current.id,
      ),
    );
  if (current.messages.some((message) => message.id === event.payload.message.id))
    return err(
      domainError(
        errorCodes.STABLE_ID_VIOLATION,
        `消息 ${event.payload.message.id} 已存在`,
        event.payload.message.id,
      ),
    );
  const stories = new Map(snapshot.stories);
  if (event.payload.story !== undefined) {
    const invalid = validateStory(snapshot, event.payload.story);
    if (invalid !== undefined) return err(invalid);
    stories.set(event.payload.story.id, normalizedStory(event.payload.story));
  }
  const annotations = new Map(snapshot.annotations);
  annotations.set(current.id, {
    ...current,
    status: 'answered',
    messages: [...current.messages, event.payload.message],
  });
  return ok(commit(snapshot, event, annotations, stories));
}

function resolve(snapshot: GraphSnapshot, event: AnnotationResolveEvent): ReduceResult {
  const current = snapshot.annotations.get(event.payload.annotationId);
  if (current === undefined)
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `标注 ${event.payload.annotationId} 不存在`,
        event.payload.annotationId,
      ),
    );
  if (event.actor?.kind !== 'user')
    return err(domainError(errorCodes.UNSUPPORTED, '只有用户可以解决标注', current.id));
  if (current.status === 'resolved' || current.status === 'cancelled')
    return err(
      domainError(
        errorCodes.SCHEMA_VIOLATION,
        `标注 ${current.id} 已处于终态 ${current.status}`,
        current.id,
      ),
    );
  const annotations = new Map(snapshot.annotations);
  annotations.set(current.id, { ...current, status: 'resolved', resolvedAt: event.timestamp });
  return ok(commit(snapshot, event, annotations));
}

export function reduceAnnotation(snapshot: GraphSnapshot, event: AnnotationEvent): ReduceResult {
  switch (event.type) {
    case 'annotation_create':
      return create(snapshot, event);
    case 'annotation_answer':
      return answer(snapshot, event);
    case 'annotation_resolve':
      return resolve(snapshot, event);
  }
}
