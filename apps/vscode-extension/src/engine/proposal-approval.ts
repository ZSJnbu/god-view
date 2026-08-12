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
export function prepareApproval(input: {
  readonly snapshot: GraphSnapshot;
  readonly gitState: GitState;
  readonly proposalId: Identifier;
  readonly approvedScope: readonly WorkspacePath[];
  readonly acknowledgePreexistingChanges: boolean;
}): PreparedApproval | ApprovalFailure {
  const proposal = input.snapshot.changeProposals.get(input.proposalId);
  if (proposal?.status !== 'proposed')
    return { ok: false, reason: '方案不存在、已处理或状态已过期' };
  const gitRevision = input.gitState.headRevision;
  if (!input.gitState.hasGit || gitRevision === undefined)
    return { ok: false, reason: '无 Git 工作区不能获得写入批准' };
  const scope = [...new Set(input.approvedScope)].sort();
  if (scope.length === 0 || scope.some((path) => !proposal.plannedFiles.includes(path)))
    return { ok: false, reason: '批准范围必须是方案文件的非空子集' };
  if (
    proposal.branchKey !== input.gitState.branchKey ||
    proposal.baseMapRevision + 1 !== input.snapshot.revision ||
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

export function isApprovalFailure(
  result: PreparedApproval | ApprovalFailure,
): result is ApprovalFailure {
  return 'ok' in result && !result.ok;
}
