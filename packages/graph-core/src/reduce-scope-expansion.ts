import {
  err,
  errorCodes,
  ok,
  type Result,
  type ScopeExpansionDecidedEvent,
  type ScopeExpansionRequestedEvent,
} from '@god-view/protocol';
import { domainError, type DomainError } from './domain-error.js';
import type { GraphSnapshot } from './snapshot.js';

type ScopeExpansionEvent = ScopeExpansionRequestedEvent | ScopeExpansionDecidedEvent;
type ReduceResult = Result<GraphSnapshot, DomainError>;

function commit(
  snapshot: GraphSnapshot,
  event: ScopeExpansionEvent,
  activeChanges: GraphSnapshot['activeChanges'],
): GraphSnapshot {
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    lastEventSeq: snapshot.lastEventSeq + 1,
    activeChanges,
    appliedEventIds: new Set([...snapshot.appliedEventIds, event.eventId]),
  };
}

// eslint-disable-next-line complexity -- 权限、基线、会话、并发与路径边界必须在一个原子状态转换中共同验证。
function requestExpansion(
  snapshot: GraphSnapshot,
  event: ScopeExpansionRequestedEvent,
): ReduceResult {
  const request = event.payload.request;
  const change = snapshot.activeChanges.get(request.changeSetId);
  if (event.actor?.kind !== 'agent') {
    return err(domainError(errorCodes.UNSUPPORTED, '只有 Agent 可以提出扩围申请', request.id));
  }
  if (change === undefined) {
    return err(
      domainError(
        errorCodes.UNKNOWN_CHANGE_SET,
        `变更 ${request.changeSetId} 不存在或已结束`,
        request.changeSetId,
      ),
    );
  }
  if (change.approvedScope === undefined || change.permissionMode === undefined) {
    return err(
      domainError(
        errorCodes.UNSUPPORTED,
        '只有用户批准后启动的 ChangeSet 可以申请扩围',
        request.id,
      ),
    );
  }
  if (change.sessionId !== event.sessionId || request.sessionId !== event.sessionId) {
    return err(
      domainError(errorCodes.WORKSPACE_MISMATCH, '扩围申请不属于当前 ChangeSet 会话', request.id),
    );
  }
  if (event.baseMapRevision !== snapshot.revision) {
    return err(
      domainError(
        errorCodes.STALE_MAP_REVISION,
        `扩围申请基于 r${String(event.baseMapRevision ?? 'unknown')}，当前地图为 r${String(snapshot.revision)}`,
        request.id,
      ),
    );
  }
  if (request.status !== 'pending' || request.decidedAt !== undefined) {
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, 'Agent 只能创建 pending 扩围申请', request.id),
    );
  }
  const requests = change.scopeExpansionRequests ?? [];
  if (requests.length >= 50) {
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, '单个 ChangeSet 的扩围审计记录已达上限', request.id),
    );
  }
  if (requests.some((item) => item.id === request.id)) {
    return err(
      domainError(errorCodes.STABLE_ID_VIOLATION, `扩围申请 ${request.id} 已存在`, request.id),
    );
  }
  if (requests.some((item) => item.status === 'pending')) {
    return err(
      domainError(errorCodes.CONCURRENT_CHANGE_SET, '当前已有待用户决定的扩围申请', request.id),
    );
  }
  if (change.executionStatus === 'scope_violation') {
    return err(
      domainError(errorCodes.SCOPE_VIOLATION, '已经发生越界写入，不能再补办事前审批', request.id),
    );
  }
  if (request.requestedFiles.some((path) => isWithinScope(path, change.approvedScope ?? []))) {
    return err(
      domainError(errorCodes.SCHEMA_VIOLATION, '扩围申请只能包含当前尚未批准的文件', request.id),
    );
  }
  const activeChanges = new Map(snapshot.activeChanges);
  activeChanges.set(change.changeSetId, {
    ...change,
    scopeExpansionRequests: [
      ...requests,
      { ...request, requestedFiles: [...request.requestedFiles].sort() },
    ],
  });
  return ok(commit(snapshot, event, activeChanges));
}

// eslint-disable-next-line complexity -- 审批归约同时维护审计、范围、计划与已观察 Diff 的一致性。
function decideExpansion(snapshot: GraphSnapshot, event: ScopeExpansionDecidedEvent): ReduceResult {
  const { changeSetId, requestId, decision } = event.payload;
  const change = snapshot.activeChanges.get(changeSetId);
  if (event.actor?.kind !== 'user') {
    return err(domainError(errorCodes.UNSUPPORTED, '只有用户可以决定扩围申请', requestId));
  }
  if (change === undefined) {
    return err(
      domainError(errorCodes.UNKNOWN_CHANGE_SET, `变更 ${changeSetId} 不存在或已结束`, changeSetId),
    );
  }
  const requests = change.scopeExpansionRequests ?? [];
  const request = requests.find((item) => item.id === requestId);
  if (request?.status !== 'pending') {
    return err(
      domainError(errorCodes.UNKNOWN_ENTITY, `扩围申请 ${requestId} 不存在或已决定`, requestId),
    );
  }
  if (decision === 'approved' && change.executionStatus === 'scope_violation') {
    return err(
      domainError(
        errorCodes.SCOPE_VIOLATION,
        '申请文件已经被写入，不能用事后批准消除越界',
        requestId,
      ),
    );
  }
  const nextRequests = requests.map((item) =>
    item.id === requestId ? { ...item, status: decision, decidedAt: event.timestamp } : item,
  );
  const approvedScope =
    decision === 'approved'
      ? [...new Set([...(change.approvedScope ?? []), ...request.requestedFiles])].sort()
      : change.approvedScope;
  const plannedFiles =
    decision === 'approved'
      ? [...new Set([...(change.plannedFiles ?? []), ...request.requestedFiles])].sort()
      : change.plannedFiles;
  const diff =
    decision === 'approved' && change.diff !== undefined
      ? {
          ...change.diff,
          files: change.diff.files.map((file) =>
            isWithinScope(file.path, approvedScope ?? [])
              ? { ...file, scopeStatus: 'approved' as const }
              : file,
          ),
        }
      : change.diff;
  const activeChanges = new Map(snapshot.activeChanges);
  activeChanges.set(changeSetId, {
    ...change,
    scopeExpansionRequests: nextRequests,
    ...(approvedScope === undefined ? {} : { approvedScope }),
    ...(plannedFiles === undefined ? {} : { plannedFiles }),
    ...(diff === undefined ? {} : { diff }),
  });
  return ok(commit(snapshot, event, activeChanges));
}

function isWithinScope(path: string, scope: readonly string[]): boolean {
  return scope.some(
    (allowed) => path === allowed || path.startsWith(`${allowed.replace(/\/$/u, '')}/`),
  );
}

export function reduceScopeExpansion(
  snapshot: GraphSnapshot,
  event: ScopeExpansionEvent,
): ReduceResult {
  return event.type === 'scope_expansion_requested'
    ? requestExpansion(snapshot, event)
    : decideExpansion(snapshot, event);
}
