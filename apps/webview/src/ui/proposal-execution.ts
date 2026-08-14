import type { ActiveChange, ChangeProposal, CompletedChange } from '@god-view/protocol';

export type ProposalExecutionState =
  | { readonly kind: 'proposed' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'active'; readonly change: ActiveChange }
  | { readonly kind: 'retryable'; readonly change: CompletedChange }
  | { readonly kind: 'completed'; readonly change: CompletedChange };

export function proposalExecutionState(
  proposal: ChangeProposal,
  activeChanges: readonly ActiveChange[],
  completedChanges: readonly CompletedChange[],
  now: number,
): ProposalExecutionState {
  if (proposal.status === 'proposed') return { kind: 'proposed' };

  const active = activeChanges.find((change) => change.proposalId === proposal.id);
  if (active !== undefined) return { kind: 'active', change: active };

  const completed = completedChanges
    .filter(
      (change) =>
        change.proposalId === proposal.id &&
        (proposal.approval === undefined || change.completedAt >= proposal.approval.approvedAt),
    )
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
  if (completed !== undefined) {
    return ['failed', 'interrupted'].includes(completed.status)
      ? { kind: 'retryable', change: completed }
      : { kind: 'completed', change: completed };
  }

  const expiresAt = proposal.approval?.expiresAt;
  return expiresAt !== undefined && Date.parse(expiresAt) <= now
    ? { kind: 'expired' }
    : { kind: 'ready' };
}

export function proposalRemainsActionable(
  proposal: ChangeProposal,
  completedChanges: readonly CompletedChange[],
): boolean {
  if (!['proposed', 'approved'].includes(proposal.status)) return false;
  const latest = completedChanges
    .filter((change) => change.proposalId === proposal.id)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
  return latest === undefined || ['failed', 'interrupted'].includes(latest.status);
}
