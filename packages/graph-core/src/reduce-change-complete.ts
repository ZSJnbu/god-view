import {
  err,
  errorCodes,
  ok,
  type ActiveChange,
  type ChangeCompleteEvent,
  type CompletedChange,
  type Result,
} from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import type { GraphSnapshot } from './snapshot.js';

export function reduceChangeComplete(
  snapshot: GraphSnapshot,
  event: ChangeCompleteEvent,
): Result<GraphSnapshot, DomainError> {
  const { changeSetId, status } = event.payload;
  const change = snapshot.activeChanges.get(changeSetId);
  if (change === undefined)
    return err(
      domainError(errorCodes.UNKNOWN_CHANGE_SET, `变更 ${changeSetId} 不存在或已结束`, changeSetId),
    );
  if (status === 'completed' && change.executionStatus === 'scope_violation')
    return err(
      domainError(
        errorCodes.SCOPE_VIOLATION,
        'ChangeSet 存在批准范围外写入，不能标记为成功完成',
        changeSetId,
      ),
    );
  const finalStatus = status === 'completed' ? 'active' : 'failed';
  const revision = snapshot.revision + 1;
  const nodes = new Map(snapshot.nodes);
  for (const nodeId of change.touchedNodeIds) {
    const node = nodes.get(nodeId);
    if (node?.lifecycle.status === 'in_progress')
      nodes.set(nodeId, {
        ...node,
        lifecycle: { status: finalStatus, changeSetId },
        updatedAt: event.timestamp,
        revision,
      });
  }
  const edges = new Map(snapshot.edges);
  for (const edgeId of change.touchedEdgeIds) {
    const edge = edges.get(edgeId);
    if (edge?.lifecycle.status === 'in_progress')
      edges.set(edgeId, {
        ...edge,
        lifecycle: { status: finalStatus, changeSetId },
        updatedAt: event.timestamp,
        revision,
      });
  }
  const activeChanges = new Map(snapshot.activeChanges);
  activeChanges.delete(changeSetId);
  const completedChanges = new Map(snapshot.completedChanges);
  const completed = buildCompletedChange(change, event);
  if (completed !== undefined) completedChanges.set(changeSetId, completed);
  const annotations = annotationAfterCompletion(snapshot, change, status);
  return ok({
    ...snapshot,
    revision,
    lastEventSeq: snapshot.lastEventSeq + 1,
    nodes,
    edges,
    activeChanges,
    completedChanges,
    annotations,
    appliedEventIds: new Set([...snapshot.appliedEventIds, event.eventId]),
  });
}

function annotationAfterCompletion(
  snapshot: GraphSnapshot,
  change: ActiveChange,
  status: ChangeCompleteEvent['payload']['status'],
): GraphSnapshot['annotations'] {
  const annotations = new Map(snapshot.annotations);
  if (change.proposalId === undefined || status === 'completed') return annotations;
  const proposal = snapshot.changeProposals.get(change.proposalId);
  const annotation =
    proposal === undefined ? undefined : snapshot.annotations.get(proposal.annotationId);
  if (annotation !== undefined) {
    annotations.set(annotation.id, { ...annotation, status: 'needs_clarification' });
  }
  return annotations;
}

function buildCompletedChange(
  change: ActiveChange,
  event: ChangeCompleteEvent,
): CompletedChange | undefined {
  if (change.proposalId === undefined || change.diff === undefined) return undefined;
  const { changeSetId, status } = event.payload;
  return {
    changeSetId,
    proposalId: change.proposalId,
    status:
      status === 'completed'
        ? 'pending_review'
        : status === 'interrupted'
          ? 'interrupted'
          : 'failed',
    completedAt: event.timestamp,
    plannedFiles: [...(change.plannedFiles ?? [])],
    actualFiles: [...(event.payload.actualFiles ?? change.diff.files.map((file) => file.path))],
    touchedNodeIds: [...change.touchedNodeIds],
    touchedEdgeIds: [...change.touchedEdgeIds],
    diff: change.diff,
    ...(event.payload.note === undefined ? {} : { note: event.payload.note }),
  };
}
