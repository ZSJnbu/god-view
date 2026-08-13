import { err, errorCodes, type GodViewEvent, type Result } from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import { reduceAnnotation } from './reduce-annotation.js';
import { reduceChangeObserved } from './reduce-change-observed.js';
import { reduceProposal } from './reduce-proposal.js';
import type { GraphSnapshot } from './snapshot.js';

type ReduceResult = Result<GraphSnapshot, DomainError>;
type Commit = (
  snapshot: GraphSnapshot,
  event: GodViewEvent,
  mutation: {
    readonly completedChanges?: GraphSnapshot['completedChanges'];
    readonly annotations?: GraphSnapshot['annotations'];
    readonly bumpsRevision: boolean;
  },
) => GraphSnapshot;

function isAnnotationEvent(
  event: GodViewEvent,
): event is Extract<
  GodViewEvent,
  { type: 'annotation_create' | 'annotation_answer' | 'annotation_resolve' }
> {
  return ['annotation_create', 'annotation_answer', 'annotation_resolve'].includes(event.type);
}

function isProposalEvent(
  event: GodViewEvent,
): event is Extract<
  GodViewEvent,
  { type: 'write_access_requested' | 'change_proposal' | 'change_approved' | 'change_rejected' }
> {
  return [
    'write_access_requested',
    'change_proposal',
    'change_approved',
    'change_rejected',
  ].includes(event.type);
}

export function reduceSpecialEvent(
  snapshot: GraphSnapshot,
  event: GodViewEvent,
  commit: Commit,
): ReduceResult | undefined {
  if (isAnnotationEvent(event)) return reduceAnnotation(snapshot, event);
  if (isProposalEvent(event)) return reduceProposal(snapshot, event);
  if (event.type === 'change_observed') return reduceChangeObserved(snapshot, event);
  if (event.type !== 'change_reviewed') return undefined;
  if (event.actor?.kind !== 'user')
    return err(domainError(errorCodes.UNSUPPORTED, '只有用户可以接受 ChangeSet 结果'));
  const completed = snapshot.completedChanges.get(event.payload.changeSetId);
  if (completed?.status !== 'pending_review')
    return err(
      domainError(
        errorCodes.UNKNOWN_CHANGE_SET,
        `变更 ${event.payload.changeSetId} 不存在或不在待审查状态`,
        event.payload.changeSetId,
      ),
    );
  if (
    event.payload.status === 'accepted' &&
    completed.diff.files.some((file) => file.scopeStatus === 'outside_scope')
  )
    return err(
      domainError(
        errorCodes.SCOPE_VIOLATION,
        '存在越界文件时只能选择带问题接受',
        completed.changeSetId,
      ),
    );
  const completedChanges = new Map(snapshot.completedChanges);
  completedChanges.set(completed.changeSetId, {
    ...completed,
    status: event.payload.status,
    ...(event.payload.note === undefined ? {} : { note: event.payload.note }),
  });
  const proposal = snapshot.changeProposals.get(completed.proposalId);
  const annotation =
    proposal === undefined ? undefined : snapshot.annotations.get(proposal.annotationId);
  const annotations = new Map(snapshot.annotations);
  if (annotation !== undefined) {
    annotations.set(annotation.id, {
      ...annotation,
      status: 'resolved',
      resolvedAt: event.timestamp,
    });
  }
  return {
    ok: true,
    value: commit(snapshot, event, { completedChanges, annotations, bumpsRevision: true }),
  };
}
