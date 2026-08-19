/* eslint-disable max-lines -- VS Code webview host keeps command authorization and panel lifecycle together. */
import { randomBytes } from 'node:crypto';
import {
  commands,
  env,
  FileType,
  Range,
  Selection,
  Uri,
  ViewColumn,
  window,
  workspace,
  type ExtensionContext,
  type Webview,
  type WebviewPanel,
} from 'vscode';
import {
  parseWebviewCommand,
  type ExtensionEvent,
  type WebviewCommand,
} from '@god-view/webview-bridge';
import type { Logger } from '../logger.js';
import type { MapService } from '../engine/map-service.js';
import type { NativeAgentHost } from '../native-agent-host.js';
import { resolveWorkspacePath } from '../workspace/workspace-identity.js';
import { routeMapUpdate } from './map-update-event.js';
import { commandIds } from '../constants.js';
import { formatAnnotationTask } from '../engine/annotation-context.js';
import { agentPaneHeightKey, agentPaneViewKey, layoutStateKey } from '../workspace-data.js';
import { purposeForCommand } from './agent-command-purpose.js';
import {
  formatApprovedChangeTask,
  approvedChangeStartIssue,
  isAgentCommand,
  isAnnotationOrProposalCommand,
  isChangeCommand,
  isHostCommand,
  isSnapshotCommand,
  projectChangeContextNodeIds,
} from './map-panel-commands.js';

type LayoutPositions = Record<string, { x: number; y: number }>;

/**
 * 项目地图 Webview 宿主。
 *
 * 只加载扩展打包资源，配置严格 CSP 与 nonce，绝不执行仓库内脚本
 * （TECHNICAL_ARCHITECTURE.md §9.3）。
 */
export class MapPanel {
  static readonly viewType = 'godView.map';
  static #current: MapPanel | undefined;

  readonly #panel: WebviewPanel;
  readonly #context: ExtensionContext;
  readonly #service: MapService;
  readonly #logger: Logger;
  readonly #agentHost: NativeAgentHost;
  readonly #refreshAgentStatus: () => Promise<void>;
  readonly #disposables: { dispose(): void }[] = [];

  private constructor(
    panel: WebviewPanel,
    context: ExtensionContext,
    service: MapService,
    logger: Logger,
    agentHost: NativeAgentHost,
    refreshAgentStatus: () => Promise<void>,
  ) {
    this.#panel = panel;
    this.#context = context;
    this.#service = service;
    this.#logger = logger;
    this.#agentHost = agentHost;
    this.#refreshAgentStatus = refreshAgentStatus;

    this.#panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    };
    this.#panel.webview.html = this.#renderHtml(this.#panel.webview);
    this.#disposables.push(
      this.#panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.#handleMessage(message);
      }),
      this.#service.onDidUpdate((update) => {
        const delivery = routeMapUpdate(update);
        if (delivery.kind === 'snapshot') {
          this.#sendSnapshot();
          return;
        }
        this.#post(delivery.event);
      }),
    );
    this.#panel.onDidDispose(() => {
      this.dispose();
    });
  }

  static show(
    context: ExtensionContext,
    service: MapService,
    logger: Logger,
    agentHost: NativeAgentHost,
    refreshAgentStatus: () => Promise<void>,
  ): MapPanel {
    const existing = MapPanel.#current;
    if (existing !== undefined) {
      existing.#panel.reveal(ViewColumn.Active);
      return existing;
    }
    const panel = window.createWebviewPanel(MapPanel.viewType, 'God View', ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    });
    const created = new MapPanel(panel, context, service, logger, agentHost, refreshAgentStatus);
    MapPanel.#current = created;
    return created;
  }

  /** 窗口重载后复用 VS Code 恢复的 panel，并重新接上线与资源。 */
  static restore(
    panel: WebviewPanel,
    context: ExtensionContext,
    service: MapService,
    logger: Logger,
    agentHost: NativeAgentHost,
    refreshAgentStatus: () => Promise<void>,
  ): MapPanel {
    const existing = MapPanel.#current;
    if (existing !== undefined && existing.#panel !== panel) {
      existing.dispose();
    }
    const restored = new MapPanel(panel, context, service, logger, agentHost, refreshAgentStatus);
    MapPanel.#current = restored;
    return restored;
  }

  /** 数据清理或会话切换时关闭仍绑定旧服务的面板。 */
  static closeCurrent(): void {
    const current = MapPanel.#current;
    if (current !== undefined) current.#panel.dispose();
  }

  /** 向当前地图面板推送扩展侧状态；面板未打开时安全忽略。 */
  static postToCurrent(event: ExtensionEvent): void {
    MapPanel.#current?.post(event);
  }

  /** 让 Webview 聚焦到某个节点，用于「Reveal in God View」。 */
  focusNode(nodeId: string): void {
    this.#panel.reveal(ViewColumn.Active);
    this.#post({ type: 'status', state: 'idle', detail: `focus:${nodeId}` });
  }

  post(event: ExtensionEvent): void {
    this.#post(event);
  }

  dispose(): void {
    MapPanel.#current = undefined;
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables.length = 0;
    this.#panel.dispose();
  }

  async #handleMessage(message: unknown): Promise<void> {
    const parsed = parseWebviewCommand(message);
    if (!parsed.ok) {
      this.#logger.warn('webview.command.rejected', {
        code: parsed.error.code,
        path: parsed.error.path,
      });
      return;
    }
    if (isSnapshotCommand(parsed.value)) {
      this.#sendSnapshot();
      await this.#refreshAgentStatus();
      return;
    }
    if (parsed.value.type === 'requestHistoryTimeline') {
      await this.#sendHistoryTimeline();
      return;
    }
    if (isChangeCommand(parsed.value)) {
      await this.#handleChangeCommand(parsed.value);
      return;
    }
    if (isAgentCommand(parsed.value)) {
      await this.#handleAgentCommand(parsed.value);
      return;
    }
    if (isAnnotationOrProposalCommand(parsed.value)) {
      await this.#handleAnnotationOrProposalCommand(parsed.value);
      return;
    }
    if (isHostCommand(parsed.value)) {
      await this.#handleHostCommand(parsed.value);
      return;
    }
    if (parsed.value.type === 'openSource') return this.#handleFileCommand(parsed.value);
    if (parsed.value.type === 'saveAgentPaneHeight') {
      await this.#context.workspaceState.update(
        agentPaneHeightKey(this.#service.snapshot.workspaceId),
        parsed.value.height,
      );
      return;
    }
    if (parsed.value.type === 'saveAgentPaneView') {
      await this.#context.workspaceState.update(
        agentPaneViewKey(this.#service.snapshot.workspaceId),
        parsed.value.view,
      );
      return;
    }
    await this.#context.workspaceState.update(
      this.#layoutKey(),
      parsed.value.positions satisfies LayoutPositions,
    );
  }

  async #handleAnnotationOrProposalCommand(
    command: Extract<
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
    >,
  ): Promise<void> {
    if (['createAnnotation', 'resolveAnnotation', 'copyAnnotationTask'].includes(command.type)) {
      return this.#handleAnnotationCommand(
        command as Extract<
          WebviewCommand,
          { type: 'createAnnotation' | 'resolveAnnotation' | 'copyAnnotationTask' }
        >,
      );
    }
    return this.#handleProposalCommand(
      command as Extract<
        WebviewCommand,
        { type: 'approveProposal' | 'rejectProposal' | 'copyApprovedChangeTask' }
      >,
    );
  }

  async #handleHostCommand(
    command: Extract<
      WebviewCommand,
      {
        type: 'generateAgentTask' | 'copyAgentSetup' | 'configureAgent';
      }
    >,
  ): Promise<void> {
    if (command.type === 'configureAgent') {
      await commands.executeCommand(commandIds.configureAgent, command.agent);
      return;
    }
    await commands.executeCommand(
      command.type === 'generateAgentTask'
        ? commandIds.generateAgentTask
        : commandIds.copyAgentSetup,
    );
  }

  async #handleAgentCommand(
    command: Extract<
      WebviewCommand,
      {
        type:
          | 'refreshAgentStatus'
          | 'openAgentTerminal'
          | 'startInitialization'
          | 'startReinitialization'
          | 'startMapCompletion'
          | 'startAnnotationAnswer'
          | 'startApprovedChange'
          | 'decideScopeExpansion'
          | 'sendAgentMessage';
      }
    >,
  ): Promise<void> {
    if (command.type === 'refreshAgentStatus') return this.#refreshAgentStatus();
    if (command.type === 'openAgentTerminal') {
      const opened = await this.#agentHost.open(command.agent);
      if (opened !== 'opened') {
        this.#post({
          type: 'error',
          code: 'AGENT_NOT_READY',
          message: 'Agent 的 MCP 或上下文 hook 尚未配置完成。',
        });
      }
      return;
    }
    if (command.type === 'sendAgentMessage') {
      return this.#handleConversationMessage(command);
    }
    if (command.type === 'decideScopeExpansion') {
      const decided = await this.#service.decideScopeExpansion(
        command.changeSetId,
        command.requestId,
        command.decision,
      );
      if (!decided) {
        this.#post({
          type: 'error',
          code: 'SCOPE_EXPANSION_REJECTED',
          message:
            command.decision === 'approved'
              ? '无法批准：申请已失效，或 Agent 已经先写入了范围外文件'
              : '无法拒绝：申请已失效',
        });
        return;
      }
      this.#agentHost.continueAfterScopeDecision(command.requestId, command.decision);
      this.#post({
        type: 'status',
        state: 'idle',
        detail: `scope-expansion-${command.decision}:${command.requestId}`,
      });
      return;
    }
    if (command.type === 'startAnnotationAnswer') {
      await this.#startAnnotationAnswer(command.agent, command.annotationId);
      return;
    }
    if (command.type === 'startApprovedChange') {
      await this.#startApprovedChange(command.agent, command.proposalId);
      return;
    }
    const purpose = purposeForCommand(command);
    if (purpose !== 'initialization' && !this.#canStartExistingMapTask()) return;
    if (purpose === 'reinitialization' && !(await this.#confirmReinitialization())) return;
    const started = await this.#agentHost.start(command.agent, purpose);
    if (started === 'opened') return;
    this.#post({
      type: 'error',
      code: 'AGENT_NOT_READY',
      message: 'Agent 的 MCP 或上下文 hook 尚未通过当前工作区复验，请刷新或重新配置',
    });
  }

  async #handleConversationMessage(
    command: Extract<WebviewCommand, { type: 'sendAgentMessage' }>,
  ): Promise<void> {
    if (command.mode === 'change') {
      const explicitNodeIds =
        command.nodeIds?.filter((id) => this.#service.snapshot.nodes.has(id)) ?? [];
      const nodeIds =
        explicitNodeIds.length > 0
          ? explicitNodeIds
          : projectChangeContextNodeIds(this.#service.snapshot.nodes);
      if (nodeIds.length === 0) {
        this.#post({
          type: 'error',
          code: 'CHANGE_CONTEXT_REQUIRED',
          message: '当前地图没有可用的项目模块，暂时无法建立修改上下文。',
        });
        return;
      }
      const id = await this.#service.createAnnotation({
        annotationType: 'change',
        body: command.message,
        nodeIds,
      });
      if (id === undefined) {
        this.#post({ type: 'error', code: 'ANNOTATION_REJECTED', message: '无法创建修改请求' });
        return;
      }
      await this.#startAnnotationAnswer(command.agent, id);
      return;
    }
    const started = await this.#agentHost.sendMessage(command.agent, command.message);
    if (started !== 'opened') {
      this.#post({
        type: 'error',
        code: 'AGENT_NOT_READY',
        message: 'Agent 的 MCP 或上下文 hook 尚未配置完成。',
      });
    }
  }

  async #startAnnotationAnswer(
    agent: 'codex' | 'claude-code',
    annotationId: string,
  ): Promise<void> {
    if (!this.#service.snapshot.annotations.has(annotationId)) {
      this.#post({ type: 'error', code: 'ANNOTATION_NOT_FOUND', message: '找不到该标注' });
      return;
    }
    const started = await this.#agentHost.start(agent, 'annotation_answer', annotationId);
    if (started === 'opened') return;
    this.#post({
      type: 'error',
      code: 'AGENT_NOT_READY',
      message: '无法打开原生 Agent；请刷新 Agent 配置，或复制手动任务',
    });
  }

  async #startApprovedChange(agent: 'codex' | 'claude-code', proposalId: string): Promise<void> {
    const issue = approvedChangeStartIssue(
      this.#service.snapshot,
      proposalId,
      this.#agentHost.timestamp(),
    );
    if (issue !== undefined) {
      this.#post({ type: 'error', ...issue });
      return;
    }
    const started = await this.#agentHost.start(agent, 'approved_change', proposalId);
    if (started === 'opened') return;
    this.#post({
      type: 'error',
      code: 'AGENT_NOT_READY',
      message: '无法打开原生 Agent；请刷新 Agent 配置，或使用手动任务兜底',
    });
  }

  async #confirmReinitialization(): Promise<boolean> {
    const confirmed = await window.showWarningMessage(
      [
        '将根据当前仓库状态重新分析并完整重绘项目地图。',
        '旧地图会一直保留到新的 ChangeSet 完成；过时节点和关系可能被移除，但不会修改用户源码。',
        `当前地图：r${String(this.#service.snapshot.revision)}，${String(this.#service.snapshot.nodes.size)} 个节点。`,
      ].join('\n'),
      { modal: true },
      '重新初始化',
    );
    return confirmed === '重新初始化';
  }

  #canStartExistingMapTask(): boolean {
    if (this.#service.snapshot.activeChanges.size > 0) {
      this.#post({
        type: 'error',
        code: 'CHANGE_SET_ACTIVE',
        message: '已有进行中的 ChangeSet，请先完成或停止它，再启动地图任务。',
      });
      return false;
    }
    if (this.#service.snapshot.nodes.size === 0) {
      this.#post({
        type: 'error',
        code: 'MAP_EMPTY',
        message: '当前地图为空，请使用首次建图。',
      });
      return false;
    }
    return true;
  }

  async #handleChangeCommand(
    command: Extract<WebviewCommand, { type: 'openDiff' | 'reviewChange' | 'interruptChange' }>,
  ): Promise<void> {
    if (command.type === 'openDiff') {
      await this.#handleFileCommand(command);
    } else if (command.type === 'reviewChange') {
      await this.#handleReviewCommand(command);
    } else if (!(await this.#service.interruptChange(command.changeSetId))) {
      this.#post({
        type: 'error',
        code: 'CHANGE_INTERRUPT_REJECTED',
        message: 'ChangeSet 已结束或无法停止',
      });
    }
  }

  async #handleFileCommand(
    command: Extract<WebviewCommand, { type: 'openSource' | 'openDiff' }>,
  ): Promise<void> {
    if (command.type === 'openDiff') await this.#openDiff(command.path);
    else await this.#openSource(command.path, command.startLine);
  }

  async #handleReviewCommand(
    command: Extract<WebviewCommand, { type: 'reviewChange' }>,
  ): Promise<void> {
    if (await this.#service.reviewChange(command.changeSetId, command.status, command.note)) return;
    this.#post({
      type: 'error',
      code: 'CHANGE_REVIEW_REJECTED',
      message: 'ChangeSet 不在待审查状态，或存在必须显式带问题接受的越界文件',
    });
  }

  async #handleAnnotationCommand(
    command: Extract<
      WebviewCommand,
      { type: 'createAnnotation' | 'resolveAnnotation' | 'copyAnnotationTask' }
    >,
  ): Promise<void> {
    if (command.type === 'createAnnotation') {
      const id = await this.#service.createAnnotation(command);
      this.#post(
        id === undefined
          ? {
              type: 'error',
              code: 'ANNOTATION_REJECTED',
              message: '标注目标已失效，请刷新后重试',
            }
          : { type: 'status', state: 'idle', detail: `annotation-created:${id}` },
      );
      if (id !== undefined && command.autoAnswerAgent !== undefined) {
        await this.#startAnnotationAnswer(command.autoAnswerAgent, id);
      }
      return;
    }
    if (command.type === 'resolveAnnotation') {
      if (!(await this.#service.resolveAnnotation(command.annotationId))) {
        this.#post({
          type: 'error',
          code: 'ANNOTATION_REJECTED',
          message: '标注无法解决或已经处于终态',
        });
      }
      return;
    }
    const task = formatAnnotationTask(command.annotationId, this.#service.snapshot);
    if (task === undefined) {
      this.#post({ type: 'error', code: 'ANNOTATION_NOT_FOUND', message: '找不到该标注' });
      return;
    }
    await env.clipboard.writeText(task);
    void window.showInformationMessage('God View：解释任务已复制；请交给已接入的 Agent。');
  }

  async #handleProposalCommand(
    command: Extract<
      WebviewCommand,
      { type: 'approveProposal' | 'rejectProposal' | 'copyApprovedChangeTask' }
    >,
  ): Promise<void> {
    if (command.type === 'approveProposal') {
      await this.#approveAndMaybeStart(command);
      return;
    }
    if (command.type === 'rejectProposal') {
      if (!(await this.#service.rejectProposal(command.proposalId))) {
        this.#post({
          type: 'error',
          code: 'PROPOSAL_REJECTED',
          message: '方案无法拒绝或已被处理',
        });
      }
      return;
    }
    const proposal = this.#service.snapshot.changeProposals.get(command.proposalId);
    if (proposal?.status !== 'approved' || proposal.approval === undefined) {
      this.#post({
        type: 'error',
        code: 'PROPOSAL_NOT_APPROVED',
        message: '方案尚未批准或已失效',
      });
      return;
    }
    await env.clipboard.writeText(formatApprovedChangeTask(proposal));
    void window.showInformationMessage('God View：已批准的修改任务已复制；令牌 15 分钟内有效。');
  }

  async #approveAndMaybeStart(
    command: Extract<WebviewCommand, { type: 'approveProposal' }>,
  ): Promise<void> {
    let result = await this.#service.approveProposal(command.proposalId, command.approvedScope);
    if (!result.ok && (result.overlappingChanges?.length ?? 0) > 0) {
      const confirmed = await window.showWarningMessage(
        `批准范围与已有未提交改动重叠：${result.overlappingChanges?.join(', ') ?? ''}。God View 不会覆盖或回滚这些改动，仍要批准吗？`,
        { modal: true },
        '仍然批准',
      );
      if (confirmed === '仍然批准') {
        result = await this.#service.approveProposal(
          command.proposalId,
          command.approvedScope,
          true,
        );
      }
    }
    if (!result.ok) {
      this.#post({ type: 'error', code: 'PROPOSAL_REJECTED', message: result.reason });
      return;
    }
    this.#post({
      type: 'status',
      state: 'idle',
      detail: `proposal-approved:${command.proposalId}`,
    });
    if (command.autoStartAgent !== undefined) {
      await this.#startApprovedChange(command.autoStartAgent, command.proposalId);
    }
  }

  /**
   * 读取 Git 历史并推送回放时间线。
   *
   * 读不到时如实报错：宁可告诉用户「这个工作区没有可回放的 Git 历史」，
   * 也不推一条空时间线让 UI 显示成「项目从零开始且什么都没发生」。
   */
  async #sendHistoryTimeline(): Promise<void> {
    this.#post({ type: 'status', state: 'receiving', detail: 'history-loading' });
    const timeline = await this.#service.readHistoryTimeline();
    if (timeline === undefined) {
      this.#post({
        type: 'error',
        code: 'HISTORY_UNAVAILABLE',
        message: '当前工作区没有可回放的 Git 历史（无 Git 仓库、无提交，或提交只涉及被排除的文件）',
      });
      return;
    }
    this.#logger.info('history.timeline.sent', {
      frames: timeline.frames.length,
      nodes: timeline.nodes.length,
      derivedNodes: timeline.derivedNodeCount,
      truncatedCommits: timeline.truncatedCommits,
    });
    this.#post({ type: 'history/timeline', timeline });
  }

  #sendSnapshot(): void {
    const layout = this.#context.workspaceState.get<LayoutPositions>(this.#layoutKey());
    const agentPaneHeight = this.#context.workspaceState.get<number>(
      agentPaneHeightKey(this.#service.snapshot.workspaceId),
    );
    const coverage = this.#service.coverage;
    const agentPaneView = this.#context.workspaceState.get<
      Extract<ExtensionEvent, { type: 'map/snapshot' }>['agentPaneView']
    >(agentPaneViewKey(this.#service.snapshot.workspaceId));
    this.#post({
      type: 'map/snapshot',
      document: this.#service.toDocument(),
      capabilities: this.#service.capabilities,
      factsRevision: this.#service.factsRevision,
      drift: this.#service.drift,
      ...(coverage === undefined ? {} : { coverage }),
      ...(layout === undefined ? {} : { layout }),
      ...(agentPaneHeight === undefined ? {} : { agentPaneHeight }),
      ...(agentPaneView === undefined ? {} : { agentPaneView }),
    });
  }

  async #openSource(path: string, startLine?: number): Promise<void> {
    // Webview 提供的路径重新解析，拒绝工作区外目标。
    const uri = resolveWorkspacePath(this.#service.root, path);
    if (uri === undefined) {
      this.#logger.warn('webview.openSource.rejected', { reason: 'path-out-of-scope' });
      this.#post({ type: 'error', code: 'PATH_OUT_OF_SCOPE', message: '目标路径不在工作区内' });
      return;
    }
    try {
      const stat = await workspace.fs.stat(uri);
      if ((stat.type & FileType.Directory) !== 0) {
        await commands.executeCommand('revealInExplorer', uri);
        return;
      }
      const editor = await window.showTextDocument(uri, { preview: true });
      if (startLine !== undefined) {
        const position = new Range(startLine - 1, 0, startLine - 1, 0);
        editor.selection = new Selection(position.start, position.start);
        editor.revealRange(position);
      }
    } catch {
      this.#post({ type: 'error', code: 'FILE_NOT_FOUND', message: `无法打开 ${path}` });
    }
  }

  async #openDiff(path: string): Promise<void> {
    const uri = resolveWorkspacePath(this.#service.root, path);
    if (uri === undefined) {
      this.#post({ type: 'error', code: 'PATH_OUT_OF_SCOPE', message: 'Diff 路径不在工作区内' });
      return;
    }
    await commands.executeCommand('git.openChange', uri);
  }

  #layoutKey(): string {
    return layoutStateKey(this.#service.snapshot.workspaceId, this.#service.capabilities.branchKey);
  }

  #post(event: ExtensionEvent): void {
    void this.#panel.webview.postMessage(event);
  }

  #renderHtml(webview: Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const base = Uri.joinPath(this.#context.extensionUri, 'dist', 'webview');
    const script = webview.asWebviewUri(Uri.joinPath(base, 'index.js'));
    const style = webview.asWebviewUri(Uri.joinPath(base, 'index.css'));
    const layoutWorker = webview.asWebviewUri(Uri.joinPath(base, 'layout-worker.js'));
    const packageJson = this.#context.extension.packageJSON as unknown;
    const rawExtensionVersion =
      typeof packageJson === 'object' && packageJson !== null
        ? (packageJson as Record<string, unknown>)['version']
        : undefined;
    const extensionVersion =
      typeof rawExtensionVersion === 'string' && rawExtensionVersion !== ''
        ? rawExtensionVersion
        : 'unknown';
    const layoutWorkerVersioned = `${layoutWorker.toString()}?v=${encodeURIComponent(extensionVersion)}`;
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      // Worker 无法携带 nonce，只能按来源放行；只授权扩展自己的资源目录。
      `worker-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style.toString()}" />
    <title>God View</title>
  </head>
  <body>
    <div id="root" data-worker-src="${layoutWorkerVersioned}"></div>
    <script type="module" nonce="${nonce}" src="${script.toString()}"></script>
  </body>
</html>`;
  }
}
