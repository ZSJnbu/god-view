import { err, errorCodes, ok, type ChangeObservedEvent, type Result } from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import type { GraphSnapshot } from './snapshot.js';

export function reduceChangeObserved(
  snapshot: GraphSnapshot,
  event: ChangeObservedEvent,
): Result<GraphSnapshot, DomainError> {
  if (event.actor?.kind !== 'system')
    return err(domainError(errorCodes.UNSUPPORTED, '只有扩展宿主可以发布 Diff 观察结果'));
  const change = snapshot.activeChanges.get(event.payload.changeSetId);
  if (change === undefined)
    return err(
      domainError(
        errorCodes.UNKNOWN_CHANGE_SET,
        `变更 ${event.payload.changeSetId} 不存在或已结束`,
        event.payload.changeSetId,
      ),
    );
  const activeChanges = new Map(snapshot.activeChanges);
  activeChanges.set(change.changeSetId, {
    ...change,
    executionStatus: event.payload.executionStatus,
    diff: {
      ...event.payload.diff,
      files: [...event.payload.diff.files].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    },
  });
  return ok({
    ...snapshot,
    revision: snapshot.revision + 1,
    lastEventSeq: snapshot.lastEventSeq + 1,
    activeChanges,
    appliedEventIds: new Set([...snapshot.appliedEventIds, event.eventId]),
  });
}
