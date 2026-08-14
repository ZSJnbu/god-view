import {
  currentProtocolVersion,
  type GodViewEvent,
  type GraphSnapshotDocument,
  type Identifier,
} from '@god-view/protocol';

interface EventAuthority {
  readonly snapshot: Pick<GraphSnapshotDocument, 'workspaceId' | 'branchKey'>;
  readonly eventId: Identifier;
  readonly timestamp: string;
}

export function rejectProposalEvent(
  authority: EventAuthority,
  proposalId: Identifier,
): GodViewEvent {
  return {
    version: currentProtocolVersion,
    ...authority.snapshot,
    sessionId: 'god-view.user',
    eventId: authority.eventId,
    timestamp: authority.timestamp,
    actor: { kind: 'user', displayName: 'VS Code user' },
    type: 'change_rejected',
    payload: { proposalId, reason: '用户在 God View 中拒绝修改方案' },
  };
}

export function reviewChangeEvent(
  authority: EventAuthority,
  input: {
    readonly changeSetId: Identifier;
    readonly status: 'accepted' | 'accepted_with_issues';
    readonly note?: string;
  },
): GodViewEvent {
  return {
    version: currentProtocolVersion,
    ...authority.snapshot,
    sessionId: 'god-view.user',
    eventId: authority.eventId,
    timestamp: authority.timestamp,
    actor: { kind: 'user', displayName: 'VS Code user' },
    type: 'change_reviewed',
    payload: {
      changeSetId: input.changeSetId,
      status: input.status,
      ...(input.note === undefined ? {} : { note: input.note }),
    },
  };
}

export function interruptChangeEvent(
  authority: EventAuthority,
  changeSetId: Identifier,
  reason: string,
  actor: 'user' | 'system' = 'user',
): GodViewEvent {
  return {
    version: currentProtocolVersion,
    ...authority.snapshot,
    sessionId: `god-view.${actor}`,
    eventId: authority.eventId,
    timestamp: authority.timestamp,
    actor: {
      kind: actor,
      displayName: actor === 'user' ? 'VS Code user' : 'God View branch guard',
    },
    type: 'change_complete',
    payload: { changeSetId, status: 'interrupted', note: reason.slice(0, 500) },
  };
}

export function decideScopeExpansionEvent(
  authority: EventAuthority,
  input: {
    readonly changeSetId: Identifier;
    readonly requestId: Identifier;
    readonly decision: 'approved' | 'rejected';
  },
): GodViewEvent {
  return {
    version: currentProtocolVersion,
    ...authority.snapshot,
    sessionId: 'god-view.user',
    eventId: authority.eventId,
    timestamp: authority.timestamp,
    actor: { kind: 'user', displayName: 'VS Code user' },
    type: 'scope_expansion_decided',
    payload: input,
  };
}
