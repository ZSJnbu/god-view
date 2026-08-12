import { randomBytes } from 'node:crypto';
import type { ChangeProposal } from '@god-view/protocol';
import {
  commands,
  env,
  Range,
  Selection,
  Uri,
  ViewColumn,
  window,
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
import { resolveWorkspacePath } from '../workspace/workspace-identity.js';
import { routeMapUpdate } from './map-update-event.js';
import { commandIds } from '../constants.js';
import { formatAnnotationTask } from '../engine/annotation-context.js';
import { layoutStateKey } from '../workspace-data.js';

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
  readonly #disposables: { dispose(): void }[] = [];

  private constructor(
    panel: WebviewPanel,
    context: ExtensionContext,
    service: MapService,
    logger: Logger,
  ) {
    this.#panel = panel;
    this.#context = context;
    this.#service = service;
    this.#logger = logger;

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

  static show(context: ExtensionContext, service: MapService, logger: Logger): MapPanel {
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
    const created = new MapPanel(panel, context, service, logger);
    MapPanel.#current = created;
    return created;
  }

  /** 窗口重载后复用 VS Code 恢复的 panel，并重新接上线与资源。 */
  static restore(
    panel: WebviewPanel,
    context: ExtensionContext,
    service: MapService,
    logger: Logger,
  ): MapPanel {
    const existing = MapPanel.#current;
    if (existing !== undefined && existing.#panel !== panel) {
      existing.dispose();
    }
    const restored = new MapPanel(panel, context, service, logger);
    MapPanel.#current = restored;
    return restored;
  }

  /** 数据清理或会话切换时关闭仍绑定旧服务的面板。 */
  static closeCurrent(): void {
    const current = MapPanel.#current;
    if (current !== undefined) current.#panel.dispose();
  }

  /** 让 Webview 聚焦到某个节点，用于「Reveal in God View」。 */
  focusNode(nodeId: string): void {
    this.#panel.reveal(ViewColumn.Active);
    this.#post({ type: 'status', state: 'idle', detail: `focus:${nodeId}` });
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
      return;
    }
    if (isChangeCommand(parsed.value)) {
      await this.#handleChangeCommand(parsed.value);
      return;
    }
    switch (parsed.value.type) {
      case 'openSource':
        await this.#handleFileCommand(parsed.value);
        return;
      case 'saveLayout':
        // 用户布局按 workspace + branch 保存，Agent 更新语义时不得覆盖它。
        await this.#context.workspaceState.update(
          this.#layoutKey(),
          parsed.value.positions satisfies LayoutPositions,
        );
        return;
      case 'generateAgentTask':
        await commands.executeCommand(commandIds.generateAgentTask);
        return;
      case 'copyAgentSetup':
        await commands.executeCommand(commandIds.copyAgentSetup);
        return;
      case 'configureAgent':
        await commands.executeCommand(commandIds.configureAgent, parsed.value.agent);
        return;
      case 'createAnnotation':
      case 'resolveAnnotation':
      case 'copyAnnotationTask':
        await this.#handleAnnotationCommand(parsed.value);
        return;
      case 'approveProposal':
      case 'rejectProposal':
      case 'copyApprovedChangeTask':
        await this.#handleProposalCommand(parsed.value);
        return;
    }
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

  #sendSnapshot(): void {
    const layout = this.#context.workspaceState.get<LayoutPositions>(this.#layoutKey());
    const coverage = this.#service.coverage;
    this.#post({
      type: 'map/snapshot',
      document: this.#service.toDocument(),
      capabilities: this.#service.capabilities,
      factsRevision: this.#service.factsRevision,
      drift: this.#service.drift,
      ...(coverage === undefined ? {} : { coverage }),
      ...(layout === undefined ? {} : { layout }),
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
    <div id="root" data-worker-src="${layoutWorker.toString()}"></div>
    <script type="module" nonce="${nonce}" src="${script.toString()}"></script>
  </body>
</html>`;
  }
}

function isSnapshotCommand(
  command: WebviewCommand,
): command is Extract<WebviewCommand, { type: 'ready' | 'requestSnapshot' }> {
  return command.type === 'ready' || command.type === 'requestSnapshot';
}

function isChangeCommand(
  command: WebviewCommand,
): command is Extract<WebviewCommand, { type: 'openDiff' | 'reviewChange' | 'interruptChange' }> {
  return ['openDiff', 'reviewChange', 'interruptChange'].includes(command.type);
}

function formatApprovedChangeTask(proposal: ChangeProposal): string {
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
