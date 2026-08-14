import {
  err,
  errorCodes,
  ok,
  type ChangeProposal,
  type ChangeApprovedEvent,
  type ChangeProposalEvent,
  type ChangeRejectedEvent,
  type GodViewEvent,
  type Result,
  type WriteAccessRequestedEvent,
} from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import type { GraphSnapshot } from './snapshot.js';

type ProposalEvent =
  WriteAccessRequestedEvent | ChangeProposalEvent | ChangeApprovedEvent | ChangeRejectedEvent;
type ReduceResult = Result<GraphSnapshot, DomainError>;

function commit(
  snapshot: GraphSnapshot,
  event: GodViewEvent,
  mutation: Partial<Pick<GraphSnapshot, 'annotations' | 'writeAccessRequests' | 'changeProposals'>>,
): GraphSnapshot {
  return {
    ...snapshot,
    ...mutation,
    revision: snapshot.revision + 1,
    lastEventSeq: snapshot.lastEventSeq + 1,
    appliedEventIds: new Set([...snapshot.appliedEventIds, event.eventId]),
  };
}

function requestAccess(snapshot: GraphSnapshot, event: WriteAccessRequestedEvent): ReduceResult {
  const request = event.payload.request;
  const annotation = snapshot.annotations.get(request.annotationId);
  if (event.actor?.kind !== 'agent') {
    return err(domainError(errorCodes.UNSUPPORTED, '只有 Agent 可以请求写入入口', request.id));
  }
  if (annotation === undefined) {
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `标注 ${request.annotationId} 不存在`,
        request.annotationId,
      ),
    );
  }
  if (!['sent', 'answered', 'needs_clarification'].includes(annotation.status)) {
    return err(
      domainError(
        errorCodes.SCHEMA_VIOLATION,
        `标注 ${annotation.id} 当前不能请求写入`,
        annotation.id,
      ),
    );
  }
  if (request.status !== 'requested') {
    return err(
      domainError(
        errorCodes.SCHEMA_VIOLATION,
        'Agent 只能创建 requested 状态的写入请求',
        request.id,
      ),
    );
  }
  if (snapshot.writeAccessRequests.has(request.id)) {
    return err(
      domainError(errorCodes.STABLE_ID_VIOLATION, `写入请求 ${request.id} 已存在`, request.id),
    );
  }
  const requests = new Map(snapshot.writeAccessRequests);
  requests.set(request.id, { ...request, expectedScope: [...request.expectedScope].sort() });
  const annotations = new Map(snapshot.annotations);
  annotations.set(annotation.id, { ...annotation, status: 'write_requested' });
  return ok(commit(snapshot, event, { annotations, writeAccessRequests: requests }));
}

function propose(snapshot: GraphSnapshot, event: ChangeProposalEvent): ReduceResult {
  const proposal = event.payload.proposal;
  const request = snapshot.writeAccessRequests.get(proposal.requestId);
  if (event.actor?.kind !== 'agent')
    return err(domainError(errorCodes.UNSUPPORTED, '只有 Agent 可以提交修改方案', proposal.id));
  if (request?.annotationId !== proposal.annotationId)
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `写入请求 ${proposal.requestId} 不存在或不属于该标注`,
        proposal.requestId,
      ),
    );
  if (request.status !== 'requested' || proposal.status !== 'proposed')
    return err(
      domainError(
        errorCodes.SCHEMA_VIOLATION,
        '只有 requested 请求能转换为 proposed 方案',
        proposal.id,
      ),
    );
  if (
    proposal.branchKey !== snapshot.branchKey ||
    proposal.baseMapRevision !== snapshot.revision ||
    proposal.baseGitRevision !== snapshot.baseGitRevision
  )
    return err(
      domainError(
        errorCodes.STALE_MAP_REVISION,
        '方案基线与当前地图、分支或 Git revision 不一致',
        proposal.id,
      ),
    );
  if (proposal.plannedFiles.some((path) => !request.expectedScope.includes(path)))
    return err(
      domainError(errorCodes.SCOPE_VIOLATION, '方案文件超出 Agent 请求的预期范围', proposal.id),
    );
  const proposals = new Map(snapshot.changeProposals);
  proposals.set(proposal.id, { ...proposal, plannedFiles: [...proposal.plannedFiles].sort() });
  const requests = new Map(snapshot.writeAccessRequests);
  requests.set(request.id, { ...request, status: 'converted' });
  const annotation = snapshot.annotations.get(proposal.annotationId);
  const annotations = new Map(snapshot.annotations);
  if (annotation !== undefined)
    annotations.set(annotation.id, { ...annotation, status: 'plan_proposed' });
  return ok(
    commit(snapshot, event, {
      annotations,
      writeAccessRequests: requests,
      changeProposals: proposals,
    }),
  );
}

function approve(snapshot: GraphSnapshot, event: ChangeApprovedEvent): ReduceResult {
  const proposal = snapshot.changeProposals.get(event.payload.proposalId);
  const approval = event.payload.approval;
  if (event.actor?.kind !== 'user')
    return err(
      domainError(errorCodes.UNSUPPORTED, '只有用户可以批准修改方案', event.payload.proposalId),
    );
  if (proposal === undefined)
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `方案 ${event.payload.proposalId} 不存在`,
        event.payload.proposalId,
      ),
    );
  if (proposal.status !== 'proposed' && !canRetryApproval(snapshot, proposal, event.timestamp))
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, `方案 ${proposal.id} 当前不能重新批准`, proposal.id),
    );
  if (
    approval.branchKey !== snapshot.branchKey ||
    approval.mapRevision !== snapshot.revision ||
    approval.gitRevision !== snapshot.baseGitRevision
  )
    return err(domainError(errorCodes.STALE_MAP_REVISION, '批准令牌基线已过期', proposal.id));
  if (approval.approvedScope.some((path) => !proposal.plannedFiles.includes(path)))
    return err(
      domainError(errorCodes.SCOPE_VIOLATION, '批准范围必须是方案文件范围的子集', proposal.id),
    );
  if (Date.parse(approval.expiresAt) <= Date.parse(event.timestamp))
    return err(domainError(errorCodes.CANCELLED, '批准令牌在签发时已经过期', proposal.id));
  const proposals = new Map(snapshot.changeProposals);
  proposals.set(proposal.id, { ...proposal, status: 'approved', approval });
  const annotation = snapshot.annotations.get(proposal.annotationId);
  const annotations = new Map(snapshot.annotations);
  if (annotation !== undefined)
    annotations.set(annotation.id, { ...annotation, status: 'approved' });
  return ok(commit(snapshot, event, { annotations, changeProposals: proposals }));
}

function canRetryApproval(
  snapshot: GraphSnapshot,
  proposal: ChangeProposal,
  timestamp: string,
): boolean {
  if (proposal.status !== 'approved' || proposal.approval === undefined) return false;
  if ([...snapshot.activeChanges.values()].some((change) => change.proposalId === proposal.id)) {
    return false;
  }
  const completed = [...snapshot.completedChanges.values()]
    .filter((change) => change.proposalId === proposal.id)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
  if (completed !== undefined) return ['failed', 'interrupted'].includes(completed.status);
  return (
    proposal.approval.mapRevision + 1 !== snapshot.revision ||
    Date.parse(proposal.approval.expiresAt) <= Date.parse(timestamp)
  );
}

function reject(snapshot: GraphSnapshot, event: ChangeRejectedEvent): ReduceResult {
  const proposal = snapshot.changeProposals.get(event.payload.proposalId);
  if (event.actor?.kind !== 'user')
    return err(
      domainError(errorCodes.UNSUPPORTED, '只有用户可以拒绝修改方案', event.payload.proposalId),
    );
  if (proposal === undefined)
    return err(
      domainError(
        errorCodes.UNKNOWN_ENTITY,
        `方案 ${event.payload.proposalId} 不存在`,
        event.payload.proposalId,
      ),
    );
  if (proposal.status !== 'proposed')
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, `方案 ${proposal.id} 当前不能拒绝`, proposal.id),
    );
  const proposals = new Map(snapshot.changeProposals);
  proposals.set(proposal.id, { ...proposal, status: 'rejected' });
  const annotation = snapshot.annotations.get(proposal.annotationId);
  const annotations = new Map(snapshot.annotations);
  if (annotation !== undefined)
    annotations.set(annotation.id, { ...annotation, status: 'rejected' });
  return ok(commit(snapshot, event, { annotations, changeProposals: proposals }));
}

export function reduceProposal(snapshot: GraphSnapshot, event: ProposalEvent): ReduceResult {
  switch (event.type) {
    case 'write_access_requested':
      return requestAccess(snapshot, event);
    case 'change_proposal':
      return propose(snapshot, event);
    case 'change_approved':
      return approve(snapshot, event);
    case 'change_rejected':
      return reject(snapshot, event);
  }
}
