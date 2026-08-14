import type { ChangeProposal, GraphNode, Identifier } from '@god-view/protocol';
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
        idempotencyKey: `start-${proposal.id}`,
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
