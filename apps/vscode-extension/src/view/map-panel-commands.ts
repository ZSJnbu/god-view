import type { ChangeProposal, GraphNode, Identifier } from '@god-view/protocol';
import type { GraphSnapshot } from '@god-view/graph-core';
import type { WebviewCommand } from '@god-view/webview-bridge';

const maximumProjectChangeContextNodes = 20;

/**
 * 项目级修改没有显式选中节点时，优先选择活跃的顶层语义节点。
 * 不把所有 file 节点塞进提示；若地图没有正常根节点，再回退到非文件节点和任意活跃节点。
 */
export function projectChangeContextNodeIds(
  nodes: ReadonlyMap<Identifier, GraphNode>,
): readonly Identifier[] {
  const active = [...nodes.values()].filter((node) => node.lifecycle.status === 'active');
  const semantic = active.filter((node) => node.type !== 'file');
  const roots = semantic.filter((node) => node.parentId === undefined);
  const candidates = roots.length > 0 ? roots : semantic.length > 0 ? semantic : active;
  return candidates
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maximumProjectChangeContextNodes);
}

export function isSnapshotCommand(
  command: WebviewCommand,
): command is Extract<WebviewCommand, { type: 'ready' | 'requestSnapshot' }> {
  return command.type === 'ready' || command.type === 'requestSnapshot';
}

export function isChangeCommand(
  command: WebviewCommand,
): command is Extract<WebviewCommand, { type: 'openDiff' | 'reviewChange' | 'interruptChange' }> {
  return ['openDiff', 'reviewChange', 'interruptChange'].includes(command.type);
}

export function isAgentCommand(command: WebviewCommand): command is Extract<
  WebviewCommand,
  {
    type:
      | 'refreshAgentStatus'
      | 'startInitialization'
      | 'startReinitialization'
      | 'startMapCompletion'
      | 'startAnnotationAnswer'
      | 'startApprovedChange'
      | 'answerAgentQuestion'
      | 'decideScopeExpansion'
      | 'cancelAgentRun'
      | 'sendAgentMessage';
  }
> {
  return [
    'refreshAgentStatus',
    'startInitialization',
    'startReinitialization',
    'startMapCompletion',
    'startAnnotationAnswer',
    'startApprovedChange',
    'answerAgentQuestion',
    'decideScopeExpansion',
    'cancelAgentRun',
    'sendAgentMessage',
  ].includes(command.type);
}

export function isAnnotationOrProposalCommand(command: WebviewCommand): command is Extract<
  WebviewCommand,
  {
    type:
      | 'createAnnotation'
      | 'resolveAnnotation'
      | 'copyAnnotationTask'
      | 'approveProposal'
      | 'rejectProposal'
      | 'copyApprovedChangeTask';
  }
> {
  return [
    'createAnnotation',
    'resolveAnnotation',
    'copyAnnotationTask',
    'approveProposal',
    'rejectProposal',
    'copyApprovedChangeTask',
  ].includes(command.type);
}

export function isHostCommand(
  command: WebviewCommand,
): command is Extract<
  WebviewCommand,
  { type: 'generateAgentTask' | 'copyAgentSetup' | 'configureAgent' | 'exportAgentConversation' }
> {
  return [
    'generateAgentTask',
    'copyAgentSetup',
    'configureAgent',
    'exportAgentConversation',
  ].includes(command.type);
}

export function formatApprovedChangeTask(proposal: ChangeProposal): string {
  const approval = proposal.approval;
  if (approval === undefined) return '';
  return [
    '在执行任何文件修改前，先调用 God View MCP 工具 start_approved_change：',
    JSON.stringify(
      {
        sessionId: 'god-view-approved-change',
        // 每次重新批准都有新 token，也必须产生新的 change_start 事件；不能复用旧方案键。
        idempotencyKey: `start-${approval.token}`,
        proposalId: proposal.id,
        approvalToken: approval.token,
      },
      null,
      2,
    ),
    '',
    `方案：${proposal.summary}`,
    `仅允许修改：${approval.approvedScope.join(', ')}`,
    `授权模式：${approval.permissionMode}（God View 监控越界，但不能强制阻止外部进程写文件）`,
    `授权到期：${approval.expiresAt}`,
    '启动成功后，在所有地图写事件中携带返回的 changeSetId；不要修改批准范围外的文件。',
  ].join('\n');
}

export interface ApprovedChangeStartIssue {
  readonly code:
    | 'PROPOSAL_NOT_APPROVED'
    | 'CHANGE_SET_ACTIVE'
    | 'PROPOSAL_REAPPROVAL_REQUIRED'
    | 'PROPOSAL_ALREADY_EXECUTED';
  readonly message: string;
}

export function approvedChangeStartIssue(
  snapshot: Pick<
    GraphSnapshot,
    | 'revision'
    | 'branchKey'
    | 'baseGitRevision'
    | 'changeProposals'
    | 'activeChanges'
    | 'completedChanges'
  >,
  proposalId: Identifier,
  now: string,
): ApprovedChangeStartIssue | undefined {
  const proposal = snapshot.changeProposals.get(proposalId);
  if (proposal?.status !== 'approved' || proposal.approval === undefined) {
    return {
      code: 'PROPOSAL_NOT_APPROVED',
      message: '方案尚未批准、已经失效或授权已被使用。',
    };
  }
  const approval = proposal.approval;
  const active = [...snapshot.activeChanges.values()].find(
    (change) => change.proposalId === proposalId,
  );
  if (active !== undefined) {
    return {
      code: 'CHANGE_SET_ACTIVE',
      message: `该方案已经在执行（${active.changeSetId}），不能重复启动。`,
    };
  }
  const completed = [...snapshot.completedChanges.values()]
    .filter(
      (change) => change.proposalId === proposalId && change.completedAt >= approval.approvedAt,
    )
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
  if (completed !== undefined) {
    return ['failed', 'interrupted'].includes(completed.status)
      ? {
          code: 'PROPOSAL_REAPPROVAL_REQUIRED',
          message: '上次执行失败或已中断。请点击“重新批准并重试”，签发新令牌后再执行。',
        }
      : {
          code: 'PROPOSAL_ALREADY_EXECUTED',
          message: '该方案已经执行完成，请查看并验收 Diff，不能重复启动。',
        };
  }
  if (
    approval.branchKey !== snapshot.branchKey ||
    approval.gitRevision !== snapshot.baseGitRevision ||
    approval.mapRevision + 1 !== snapshot.revision ||
    Date.parse(approval.expiresAt) <= Date.parse(now)
  ) {
    return {
      code: 'PROPOSAL_REAPPROVAL_REQUIRED',
      message: '批准令牌已过期或基线已经变化。请点击“重新批准并开始”签发新令牌。',
    };
  }
  return undefined;
}
