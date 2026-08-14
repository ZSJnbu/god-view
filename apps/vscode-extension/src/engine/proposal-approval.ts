import type { ChangeProposal, Identifier, WorkspacePath } from '@god-view/protocol';
import type { GraphSnapshot } from '@god-view/graph-core';
import type { GitState } from '../workspace/git-adapter.js';

export interface ApprovalFailure {
  readonly ok: false;
  readonly reason: string;
  readonly overlappingChanges?: readonly string[];
}

export interface PreparedApproval {
  readonly proposal: ChangeProposal;
  readonly scope: readonly WorkspacePath[];
  readonly gitRevision: string;
  readonly preexistingChanges: readonly string[];
  readonly overlappingChanges: readonly string[];
}

/** 纯校验：签发 token 和事件仍由 Extension Host 完成。 */
// eslint-disable-next-line complexity -- 首次批准与失败后重批共享同一组 Git/范围安全门。
export function prepareApproval(input: {
  readonly snapshot: GraphSnapshot;
  readonly gitState: GitState;
  readonly proposalId: Identifier;
  readonly approvedScope: readonly WorkspacePath[];
  readonly acknowledgePreexistingChanges: boolean;
  readonly now: string;
}): PreparedApproval | ApprovalFailure {
  const proposal = input.snapshot.changeProposals.get(input.proposalId);
  if (proposal === undefined || !['proposed', 'approved'].includes(proposal.status))
    return { ok: false, reason: '方案不存在、已处理或状态已过期' };
  if (proposal.status === 'approved') {
    const retryFailure = retryApprovalFailure(input.snapshot, proposal, input.now);
    if (retryFailure !== undefined) return retryFailure;
  }
  const gitRevision = input.gitState.headRevision;
  if (!input.gitState.hasGit || gitRevision === undefined)
    return { ok: false, reason: '无 Git 工作区不能获得写入批准' };
  const scope = [...new Set(input.approvedScope)].sort();
  if (scope.length === 0 || scope.some((path) => !proposal.plannedFiles.includes(path)))
    return { ok: false, reason: '批准范围必须是方案文件的非空子集' };
  const proposalRevisionMatches =
    proposal.status === 'approved' || proposal.baseMapRevision + 1 === input.snapshot.revision;
  if (
    proposal.branchKey !== input.gitState.branchKey ||
    !proposalRevisionMatches ||
    proposal.baseGitRevision !== gitRevision ||
    input.snapshot.baseGitRevision !== gitRevision
  )
    return { ok: false, reason: '分支、地图或 Git 基线已经变化，请让 Agent 重新提交方案' };
  const overlappingChanges = scope.filter((path) =>
    input.gitState.preexistingChanges.includes(path),
  );
  if (overlappingChanges.length > 0 && !input.acknowledgePreexistingChanges)
    return {
      ok: false,
      reason: '批准范围与任务前已有未提交改动重叠，需要二次确认',
      overlappingChanges,
    };
  return {
    proposal,
    scope,
    gitRevision,
    preexistingChanges: [...input.gitState.preexistingChanges].sort(),
    overlappingChanges,
  };
}

function retryApprovalFailure(
  snapshot: GraphSnapshot,
  proposal: ChangeProposal,
  now: string,
): ApprovalFailure | undefined {
  if ([...snapshot.activeChanges.values()].some((change) => change.proposalId === proposal.id)) {
    return { ok: false, reason: '该方案已有正在执行的 ChangeSet，不能重复启动' };
  }
  const completed = [...snapshot.completedChanges.values()]
    .filter((change) => change.proposalId === proposal.id)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
  if (completed !== undefined && !['failed', 'interrupted'].includes(completed.status)) {
    return { ok: false, reason: '该方案已经执行成功，请直接查看并验收 Diff' };
  }
  const approval = proposal.approval;
  const stale =
    approval === undefined ||
    approval.mapRevision + 1 !== snapshot.revision ||
    Date.parse(approval.expiresAt) <= Date.parse(now);
  if (completed === undefined && !stale) {
    return { ok: false, reason: '当前批准仍然有效，无需重新签发；请直接启动 Agent' };
  }
  return undefined;
}

export function isApprovalFailure(
  result: PreparedApproval | ApprovalFailure,
): result is ApprovalFailure {
  return 'ok' in result && !result.ok;
}
