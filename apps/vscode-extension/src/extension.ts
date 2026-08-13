import {
  Disposable,
  commands,
  env,
  Uri,
  window,
  workspace,
  type ExtensionContext,
  type WebviewPanel,
} from 'vscode';
import { findNodesByPath, listNodes } from '@god-view/graph-core';
import { currentProtocolVersion, type Identifier } from '@god-view/protocol';
import { commandIds, configKeys, configSection, outputChannelName, viewIds } from './constants.js';
import { systemClock } from './clock.js';
import { AsyncLock } from './async-lock.js';
import { inspectAgentMcpConfiguration, type ConfigurableAgent } from './agent-mcp-configuration.js';
import {
  acceptAgentDataBoundary,
  configureAgent,
  copyAgentSetup,
  publishAgentStatus,
  showAgentAdapters,
} from './agent-controller.js';
import { buildAgentTask } from './agent-task.js';
import { AgentInitializationRunner } from './agent-initialization-runner.js';
import { ProjectMemory } from './project-memory.js';
import type { AgentRunPurpose } from './agent-initialization-runner.js';
import { mapExportFileName, serializeMapExport } from './map-export.js';
import { createLogger, type Logger } from './logger.js';
import { installRuntimeAssets, type RuntimeAssetState } from './runtime-assets.js';
import { MapService } from './engine/map-service.js';
import { formatAnnotationTask } from './engine/annotation-context.js';
import { MapPanel } from './view/map-panel.js';
import { formatApprovedChangeTask } from './view/map-panel-commands.js';
import { parseMapPanelState } from './view/map-panel-state.js';
import { StructureTreeProvider } from './view/structure-tree.js';
import {
  agentDataBoundaryKey,
  agentPaneHeightKey,
  isWorkspaceLayoutKey,
  workspaceStorageSegment,
} from './workspace-data.js';
import {
  identityForRoot,
  listWorkspaceIdentities,
  type WorkspaceIdentity,
} from './workspace/workspace-identity.js';

/**
 * 扩展组合根。
 *
 * 唯一装配依赖的位置：MapService、Webview 与树视图都在这里创建并注册到统一
 * 生命周期容器。激活路径不做全仓扫描，重活留给命令触发（§9.1）。
 */

let session: Session | undefined;
let runtimeAssets: RuntimeAssetState | undefined;
const sessionLock = new AsyncLock();

interface Session {
  readonly identity: WorkspaceIdentity;
  readonly service: MapService;
  readonly tree: StructureTreeProvider;
  readonly agentRunner: AgentInitializationRunner;
  readonly projectMemory: ProjectMemory;
  readonly disposables: Disposable[];
}

export async function activate(context: ExtensionContext): Promise<void> {
  const channel = window.createOutputChannel(outputChannelName);
  const logger = createLogger(channel, systemClock);
  context.subscriptions.push(channel);

  const extensionVersion = readExtensionVersion(context);
  try {
    runtimeAssets = await installRuntimeAssets({
      sourceGateway: Uri.joinPath(context.extensionUri, 'dist', 'gateway', 'god-view.mjs').fsPath,
      globalStorageRoot: context.globalStorageUri.fsPath,
      extensionVersion,
      protocolVersion: currentProtocolVersion,
    });
    logger.info('runtime.ready', {
      extensionVersion,
      protocolVersion: currentProtocolVersion,
      upgradedFrom: runtimeAssets.upgradedFrom,
    });
  } catch (error) {
    runtimeAssets = undefined;
    logger.error('runtime.install.failed', { errorCode: describeError(error) });
  }

  context.subscriptions.push(
    commands.registerCommand(commandIds.openProjectMap, async (nodeId?: unknown) => {
      await openProjectMap(context, logger, typeof nodeId === 'string' ? nodeId : undefined);
    }),
    commands.registerCommand(commandIds.revealInGodView, async () => {
      await revealActiveFile(context, logger);
    }),
    commands.registerCommand(commandIds.generateAgentTask, async () => {
      await generateAgentTask(logger);
    }),
    commands.registerCommand(commandIds.copyAgentSetup, async () => {
      await copyAgentSetup(context, logger, await ensureSession(context, logger), runtimeAssets);
    }),
    commands.registerCommand(commandIds.configureAgent, async (agent?: unknown) => {
      await configureAgent(
        context,
        logger,
        await ensureSession(context, logger),
        runtimeAssets,
        agent === 'codex' || agent === 'claude-code' ? agent : undefined,
      );
    }),
    commands.registerCommand(commandIds.showAgentAdapters, async () => {
      await showAgentAdapters(logger);
    }),
    commands.registerCommand(commandIds.showDiagnostics, () => {
      showDiagnostics(channel, logger);
    }),
    commands.registerCommand(commandIds.clearWorkspaceData, async () => {
      await clearWorkspaceData(context, logger);
    }),
    commands.registerCommand(commandIds.exportMapSnapshot, async () => {
      await exportMapSnapshot(context, logger);
    }),
    window.registerWebviewPanelSerializer(MapPanel.viewType, {
      deserializeWebviewPanel: async (panel, state) => {
        try {
          await restoreMapPanel(context, logger, panel, state);
        } catch (error) {
          logger.error('webview.restore.failed', { errorCode: describeError(error) });
          panel.dispose();
          const action = await window.showErrorMessage(
            'God View 地图恢复失败。可以重新打开地图；详细原因已写入 God View 输出日志。',
            '重新打开地图',
            '查看诊断',
          );
          if (action === '重新打开地图') {
            await commands.executeCommand(commandIds.openProjectMap);
          } else if (action === '查看诊断') {
            showDiagnostics(channel, logger);
          }
        }
      },
    }),
    new Disposable(() => {
      disposeSession();
    }),
  );

  const identities = listWorkspaceIdentities();
  // 只有单根工作区才自动启动：多根时必须由用户显式选择，不默认取第一个（§11）。
  if (identities.length === 1 && identities[0] !== undefined) {
    await ensureSession(context, logger, identities[0]);
  }
  logger.info('extension.activated', { roots: identities.length });
}

/** VS Code 窗口重载后恢复地图面板，并重新绑定它原来所属的工作区。 */
async function restoreMapPanel(
  context: ExtensionContext,
  logger: Logger,
  panel: WebviewPanel,
  state: unknown,
): Promise<void> {
  const persisted = parseMapPanelState(state);
  const identities = listWorkspaceIdentities();
  const target =
    persisted === undefined
      ? undefined
      : identities.find((identity) => identity.id === persisted.workspaceId);
  if (persisted !== undefined && target === undefined) {
    logger.warn('webview.restore.rejected', {
      reason: 'workspace-missing',
      workspaceId: persisted.workspaceId,
    });
    panel.dispose();
    await window.showWarningMessage('God View 无法恢复：原工作区已不在当前窗口中。');
    return;
  }
  const current = await ensureSession(context, logger, target);
  if (current === undefined) {
    panel.dispose();
    return;
  }
  await current.service.syncBranch();
  MapPanel.restore(
    panel,
    context,
    current.service,
    logger.child('webview'),
    current.agentRunner,
    () => publishAgentStatus(context, logger, current, runtimeAssets),
  );
  logger.info('webview.restored', { workspaceId: current.identity.id });
}

export async function deactivate(): Promise<void> {
  // 停用时刷写已接受事件，再释放监听器与子进程。
  await session?.service.flush();
  disposeSession();
}

/** 打开或复用当前会话，必要时让用户选择工作区根。 */
async function ensureSession(
  context: ExtensionContext,
  logger: Logger,
  identity?: WorkspaceIdentity,
): Promise<Session | undefined> {
  return sessionLock.run(() => ensureSessionUnlocked(context, logger, identity));
}

/** sessionLock 内执行的实际会话切换；禁止从锁外直接调用。 */
async function ensureSessionUnlocked(
  context: ExtensionContext,
  logger: Logger,
  identity?: WorkspaceIdentity,
): Promise<Session | undefined> {
  const existing = session;
  if (existing !== undefined && (identity === undefined || existing.identity.id === identity.id)) {
    return existing;
  }
  const target = identity ?? (await pickIdentity());
  if (target === undefined) {
    return undefined;
  }
  disposeSession();

  const service = new MapService({
    identity: target,
    storageRoot: context.globalStorageUri,
    logger: logger.child('map'),
    now: systemClock,
    extraExcludes: readExtraExcludes(target.root),
  });
  await workspace.fs.createDirectory(context.globalStorageUri);
  await service.open();

  const tree = new StructureTreeProvider(service);
  const taskModeByPurpose: Record<
    AgentRunPurpose,
    'automatic' | 'reinitialize' | 'complete_groups' | 'complete_files'
  > = {
    initialization: 'automatic',
    reinitialization: 'reinitialize',
    group_completion: 'complete_groups',
    file_completion: 'complete_files',
    project_chat: 'automatic',
    annotation_answer: 'automatic',
    approved_change: 'automatic',
  };
  const projectMemory = new ProjectMemory(target.root.fsPath);
  const restoredConversation = await projectMemory.load();
  const withProjectMemory = (task: string): string =>
    projectMemory.context === ''
      ? task
      : [
          task,
          '',
          '以下是 God View 在上次会话结束时保存的项目记忆。它只用于恢复上下文；代码与最新 get_map 仍是权威真相：',
          projectMemory.context,
        ].join('\n');
  const agentRunner = new AgentInitializationRunner({
    workspaceRoot: target.root.fsPath,
    now: systemClock,
    task: (purpose) =>
      withProjectMemory(buildCurrentAgentTask(service, taskModeByPurpose[purpose])),
    ...(restoredConversation === undefined ? {} : { initialConversation: restoredConversation }),
    projectChatTask: (message) =>
      withProjectMemory(
        [
          '你正在 God View 插件内部与用户持续对话。',
          `当前权威地图：r${String(service.snapshot.revision)}，${String(service.snapshot.nodes.size)} 个节点，${String(service.snapshot.edges.size)} 条关系。`,
          '先调用 get_map 获取最新地图，再用自然语言直接回答用户。可以只读检查仓库以给出有证据的答案。',
          '本轮是只读对话：不得修改文件，不得 begin_change，不得申请或假定写入授权。',
          '如果用户表达修改意图，请说明影响与建议范围，并提示他在对话框勾选“作为修改请求”后发送；不要自行编辑。',
          '不要输出机器 JSON，也不要让用户复制到外部；答案会直接实时显示在插件对话里。',
          '',
          `用户：${message}`,
        ].join('\n'),
      ),
    annotationTask: (annotationId) => {
      const task = formatAnnotationTask(annotationId, service.snapshot);
      return task === undefined ? undefined : withProjectMemory(task);
    },
    annotationAnswered: (annotationId) => {
      const annotation = service.snapshot.annotations.get(annotationId);
      const answered = annotation?.messages.some((message) => message.author === 'agent') === true;
      return annotation?.type === 'change'
        ? answered &&
            [...service.snapshot.changeProposals.values()].some(
              (proposal) => proposal.annotationId === annotationId,
            )
        : answered;
    },
    approvedChangeTask: (proposalId) => {
      const proposal = service.snapshot.changeProposals.get(proposalId);
      return proposal?.status === 'approved' ? formatApprovedChangeTask(proposal) : undefined;
    },
    approvedChangeCompleted: (proposalId) =>
      [...service.snapshot.completedChanges.values()].some(
        (change) =>
          change.proposalId === proposalId &&
          change.status === 'pending_review' &&
          ((change.touchedNodeIds?.length ?? 0) > 0 || (change.touchedEdgeIds?.length ?? 0) > 0),
      ),
    authorize: async (agent) =>
      (await acceptAgentDataBoundary(context, logger, target.id)) &&
      (await isAgentReady(agent, target, runtimeAssets)),
    onUpdate: (run) => {
      MapPanel.postToCurrent({ type: 'agent/run', run });
    },
    onConversationUpdate: (conversation) => {
      projectMemory.persist(conversation, service.snapshot);
      MapPanel.postToCurrent({ type: 'agent/conversation', conversation });
    },
  });
  const disposables: Disposable[] = [
    service,
    new Disposable(() => {
      agentRunner.dispose();
      void projectMemory.flush();
    }),
    window.createTreeView(viewIds.structure, { treeDataProvider: tree, showCollapseAll: true }),
    service.onDidUpdate(() => {
      tree.refresh();
    }),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(configSection)) {
        void service.refreshFacts();
      }
    }),
  ];

  session = { identity: target, service, tree, agentRunner, projectMemory, disposables };
  return session;
}

function disposeSession(): void {
  const current = session;
  session = undefined;
  for (const disposable of current?.disposables ?? []) {
    disposable.dispose();
  }
}

/**
 * 删除当前工作区的 God View 本地状态。
 *
 * 作用域刻意排除源码、`.git` 与共享基线；只有扩展全局存储、工作区 `.godview`
 * 运行时目录和 VS Code workspaceState 中的布局会被清除。
 */
async function clearWorkspaceData(context: ExtensionContext, logger: Logger): Promise<void> {
  const current = await ensureSession(context, logger);
  if (current === undefined) return;
  const confirmed = await window.showWarningMessage(
    [
      `将清除“${current.identity.name}”的全部 God View 本地地图、事件、标注、Diff 元数据和布局。`,
      '源码、Git 历史、暂存区和工作区文件不会被修改。此操作不可撤销。',
    ].join('\n'),
    { modal: true },
    '清除本地数据',
  );
  if (confirmed !== '清除本地数据') return;

  const identity = current.identity;
  await current.service.flush();
  MapPanel.closeCurrent();
  disposeSession();

  const storageDirectory = Uri.joinPath(
    context.globalStorageUri,
    workspaceStorageSegment(identity.id),
  );
  await deleteIfPresent(storageDirectory);
  await deleteIfPresent(Uri.joinPath(identity.root, '.godview'));
  for (const key of context.workspaceState.keys()) {
    if (
      isWorkspaceLayoutKey(key, identity.id) ||
      key === agentDataBoundaryKey(identity.id) ||
      key === agentPaneHeightKey(identity.id)
    ) {
      await context.workspaceState.update(key, undefined);
    }
  }
  logger.info('workspaceData.cleared', { workspaceId: identity.id });
  await window.showInformationMessage(
    'God View：当前工作区本地数据已清除。重新打开地图会创建空白基线。',
  );
}

async function exportMapSnapshot(context: ExtensionContext, logger: Logger): Promise<void> {
  const current = await ensureSession(context, logger);
  if (current === undefined) return;
  await current.service.flush();
  const target = await window.showSaveDialog({
    title: '导出 God View 地图快照',
    defaultUri: Uri.joinPath(
      current.identity.root,
      mapExportFileName(current.service.snapshot.branchKey),
    ),
    filters: { JSON: ['json'] },
    saveLabel: '导出地图',
  });
  if (target === undefined) return;
  await workspace.fs.writeFile(
    target,
    Buffer.from(serializeMapExport(current.service.toDocument()), 'utf8'),
  );
  logger.info('map.exported', {
    workspaceId: current.identity.id,
    branchKey: current.service.snapshot.branchKey,
  });
  await window.showInformationMessage('God View：地图快照已导出；未执行 Git add、commit 或 push。');
}

async function deleteIfPresent(target: Uri): Promise<void> {
  try {
    await workspace.fs.delete(target, { recursive: true });
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    (error.code === 'FileNotFound' || error.code === 'ENOENT')
  );
}

/**
 * 多根工作区中选择一个根。
 *
 * 每个根有独立的地图、覆盖率和分支状态，因此必须由用户指明目标。
 */
async function pickIdentity(): Promise<WorkspaceIdentity | undefined> {
  const identities = listWorkspaceIdentities();
  if (identities.length === 0) {
    await window.showWarningMessage('God View 需要先打开一个文件夹。');
    return undefined;
  }
  if (identities.length === 1) {
    return identities[0];
  }
  const picked = await window.showQuickPick(
    identities.map((identity) => ({ label: identity.name, description: identity.root.fsPath })),
    { title: 'God View：选择工作区根', placeHolder: '每个根维护独立的项目地图' },
  );
  if (picked === undefined) {
    return undefined;
  }
  const folder = (workspace.workspaceFolders ?? []).find(
    (candidate) => candidate.uri.fsPath === picked.description,
  );
  return folder === undefined ? undefined : identityForRoot(folder.uri, folder.name);
}

function readExtraExcludes(root: Uri): readonly string[] {
  return workspace
    .getConfiguration(configSection, root)
    .get<string[]>(configKeys.exclude, [])
    .filter((pattern) => pattern.trim() !== '');
}

async function openProjectMap(
  context: ExtensionContext,
  logger: Logger,
  nodeId?: Identifier,
): Promise<void> {
  const current = await ensureSession(context, logger);
  if (current === undefined) {
    return;
  }
  // `.git/HEAD` 监听覆盖不到 worktree 与 submodule，这里主动补一次；
  // 分支没变时 BranchBinding 会短路，代价只有一次 git 查询。
  await current.service.syncBranch();
  const panel = MapPanel.show(
    context,
    current.service,
    logger.child('webview'),
    current.agentRunner,
    () => publishAgentStatus(context, logger, current, runtimeAssets),
  );
  if (nodeId !== undefined) {
    panel.focusNode(nodeId);
  }
}

/**
 * 从当前编辑器定位地图节点。
 *
 * 找不到对应节点时说明该文件尚未归属任何模块，这本身是有价值的信息，
 * 因此明确告知而不是静默无反应。
 */
async function revealActiveFile(context: ExtensionContext, logger: Logger): Promise<void> {
  const editor = window.activeTextEditor;
  if (editor === undefined) {
    return;
  }
  const current = await ensureSession(context, logger);
  if (current === undefined) {
    return;
  }
  const relative = workspace.asRelativePath(editor.document.uri, false);
  const matches = findNodesByPath(current.service.snapshot, relative);
  const first = matches[0];
  if (first === undefined) {
    await window.showInformationMessage(`${relative} 还没有归属任何节点，可以让 Agent 补充。`);
    return;
  }
  MapPanel.show(context, current.service, logger.child('webview'), current.agentRunner, () =>
    publishAgentStatus(context, logger, current, runtimeAssets),
  ).focusNode(first.id);
}

/**
 * 生成交给 Agent 的任务描述。
 *
 * 扩展不直接调用 Agent，也不猜测它的能力：这里只产出一段可粘贴的文本，
 * 由用户决定交给谁执行。
 */
async function generateAgentTask(logger: Logger): Promise<void> {
  const current = session;
  if (current === undefined) {
    await window.showInformationMessage('请先打开项目地图。');
    return;
  }
  const snapshot = current.service.snapshot;
  const coverage = current.service.coverage;
  const drift = current.service.drift;
  await env.clipboard.writeText(
    buildAgentTask({
      revision: snapshot.revision,
      nodeCount: listNodes(snapshot).length,
      coverage,
      drift,
    }),
  );
  logger.info('agentTask.generated', {
    mode: listNodes(snapshot).length === 0 ? 'initialize' : 'maintain',
    unclassified: coverage?.unclassified ?? 0,
    drift: drift.length,
  });
  await window.showInformationMessage('Agent 任务已复制到剪贴板。');
}

function buildCurrentAgentTask(
  service: MapService,
  mode: 'automatic' | 'reinitialize' | 'complete_groups' | 'complete_files' = 'automatic',
): string {
  const snapshot = service.snapshot;
  return buildAgentTask(
    {
      revision: snapshot.revision,
      nodeCount: listNodes(snapshot).length,
      coverage: service.coverage,
      drift: service.drift,
    },
    mode,
  );
}

async function isAgentReady(
  agent: ConfigurableAgent,
  identity: WorkspaceIdentity,
  assets: RuntimeAssetState | undefined,
): Promise<boolean> {
  if (assets === undefined) return false;
  const status = await inspectAgentMcpConfiguration({
    agent,
    runtimeExecutable: process.execPath,
    gatewayEntry: assets.gatewayEntry,
    workspaceRoot: identity.root.fsPath,
  });
  return status.state === 'current';
}

function readExtensionVersion(context: ExtensionContext): string {
  const packageJSON = context.extension.packageJSON as unknown;
  if (typeof packageJSON !== 'object' || packageJSON === null) {
    return 'unknown';
  }
  const version = (packageJSON as Record<string, unknown>)['version'];
  return typeof version === 'string' && version !== '' ? version : 'unknown';
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') {
      return error.code;
    }
    if ('name' in error && typeof error.name === 'string') {
      return error.name;
    }
  }
  return typeof error;
}

function showDiagnostics(channel: { show(preserveFocus?: boolean): void }, logger: Logger): void {
  const current = session;
  channel.show(true);
  if (current === undefined) {
    logger.info('diagnostics', {
      state: 'no-session',
      protocolVersion: currentProtocolVersion,
      runtimeGateway: runtimeAssets === undefined ? 'unavailable' : 'ready',
      runtimeVersion: runtimeAssets?.extensionVersion,
    });
    return;
  }
  const snapshot = current.service.snapshot;
  logger.info('diagnostics', {
    workspaceId: current.identity.id,
    revision: snapshot.revision,
    nodes: listNodes(snapshot).length,
    edges: current.service.snapshot.edges.size,
    drift: current.service.drift.length,
    unclassified: current.service.coverage?.unclassified ?? 0,
    protocolVersion: currentProtocolVersion,
    runtimeGateway: runtimeAssets === undefined ? 'unavailable' : 'ready',
    runtimeVersion: runtimeAssets?.extensionVersion,
  });
}
