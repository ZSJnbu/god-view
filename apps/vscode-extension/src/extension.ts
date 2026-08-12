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
import { buildAgentSetup } from './agent-setup.js';
import { describeAdapter, detectAgentAdapters } from './agent-adapters.js';
import {
  configureAgentMcp,
  inspectAgentMcpConfiguration,
  type ConfigurableAgent,
} from './agent-mcp-configuration.js';
import { buildAgentTask } from './agent-task.js';
import { mapExportFileName, serializeMapExport } from './map-export.js';
import { createLogger, type Logger } from './logger.js';
import { installRuntimeAssets, type RuntimeAssetState } from './runtime-assets.js';
import { MapService } from './engine/map-service.js';
import { MapPanel } from './view/map-panel.js';
import { parseMapPanelState } from './view/map-panel-state.js';
import { StructureTreeProvider } from './view/structure-tree.js';
import {
  agentDataBoundaryKey,
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
      await copyAgentSetup(context, logger);
    }),
    commands.registerCommand(commandIds.configureAgent, async (agent?: unknown) => {
      await configureAgent(
        context,
        logger,
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
  MapPanel.restore(panel, context, current.service, logger.child('webview'));
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
  const disposables: Disposable[] = [
    service,
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

  session = { identity: target, service, tree, disposables };
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
    if (isWorkspaceLayoutKey(key, identity.id) || key === agentDataBoundaryKey(identity.id)) {
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
  const panel = MapPanel.show(context, current.service, logger.child('webview'));
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
  MapPanel.show(context, current.service, logger.child('webview')).focusNode(first.id);
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

/** 复制工作区专属 MCP 配置；不代替用户修改任何 Agent 全局配置。 */
async function copyAgentSetup(context: ExtensionContext, logger: Logger): Promise<void> {
  const assets = runtimeAssets;
  if (assets === undefined) {
    await window.showErrorMessage(
      'God View Gateway 未能安装到运行时目录。请执行「God View: Show Diagnostics」查看原因。',
    );
    return;
  }
  const current = await ensureSession(context, logger);
  if (current === undefined) {
    return;
  }
  if (!(await acceptAgentDataBoundary(context, logger, current.identity.id))) return;
  await env.clipboard.writeText(
    buildAgentSetup({
      // Electron 在该环境变量下以普通 Node runtime 运行，避免要求用户另装 Node。
      runtimeExecutable: process.execPath,
      gatewayEntry: assets.gatewayEntry,
      workspaceRoot: current.identity.root.fsPath,
      platform: process.platform,
    }),
  );
  logger.info('agentSetup.copied', { workspaceId: current.identity.id });
  await window.showInformationMessage('Codex、Claude Code 与通用 MCP 接入配置已复制。');
}

async function configureAgent(
  context: ExtensionContext,
  logger: Logger,
  requested?: ConfigurableAgent,
): Promise<void> {
  const assets = runtimeAssets;
  if (assets === undefined) {
    await window.showErrorMessage('God View Gateway 尚未就绪，请先查看诊断。');
    return;
  }
  const current = await ensureSession(context, logger);
  if (current === undefined) return;
  const agent = requested ?? (await pickConfigurableAgent());
  if (agent === undefined) return;
  if (!(await acceptAgentDataBoundary(context, logger, current.identity.id))) return;

  const options = {
    agent,
    runtimeExecutable: process.execPath,
    gatewayEntry: assets.gatewayEntry,
    workspaceRoot: current.identity.root.fsPath,
  } as const;
  const status = await inspectAgentMcpConfiguration(options);
  if (status.state === 'current') {
    await showAgentRestartInstruction(agent, false);
    return;
  }
  const displayName = agent === 'codex' ? 'Codex' : 'Claude Code';
  const action = await window.showWarningMessage(
    [
      `${displayName} 尚未接入当前工作区的 God View MCP。`,
      status.state === 'conflict'
        ? '已存在同名但指向其他 runtime/workspace 的配置，将先移除再替换。'
        : '将写入 Agent 自己的 MCP 配置；不会读取登录态或密钥。',
      `工作区：${current.identity.root.fsPath}`,
      '现有 Agent 会话不会热加载新工具，配置成功后必须退出并在这个目录重开。',
    ].join('\n'),
    { modal: true },
    status.state === 'conflict' ? '替换并验证' : '配置并验证',
  );
  if (action === undefined) return;
  try {
    await configureAgentMcp(options, status.state === 'conflict');
    logger.info('agentMcp.configured', {
      workspaceId: current.identity.id,
      agent,
      replaced: status.state === 'conflict',
    });
    await showAgentRestartInstruction(agent, true);
  } catch (error) {
    logger.error('agentMcp.configure.failed', {
      workspaceId: current.identity.id,
      agent,
      errorCode: describeError(error),
    });
    const fallback = await window.showErrorMessage(
      `${displayName} MCP 配置或复验失败。可以复制手动命令，并在终端执行后重开 Agent 会话。`,
      '复制手动命令',
      '查看诊断',
    );
    if (fallback === '复制手动命令') await copyAgentSetup(context, logger);
    else if (fallback === '查看诊断') await commands.executeCommand(commandIds.showDiagnostics);
  }
}

async function acceptAgentDataBoundary(
  context: ExtensionContext,
  logger: Logger,
  workspaceId: string,
): Promise<boolean> {
  const boundaryKey = agentDataBoundaryKey(workspaceId);
  if (context.workspaceState.get<boolean>(boundaryKey) === true) return true;
  const accepted = await window.showWarningMessage(
    [
      'Codex、Claude Code 或其他 MCP Agent 可能把其读取的工作区代码发送到云端。',
      '数据保留、费用和训练政策由所选 Agent 决定，God View 无法预估；God View 不读取或保存 Agent 密钥。',
      '当前接入是 monitored 模式：插件能观察 Git Diff，但不能强制 Agent 只读或阻止越界写入。',
    ].join('\n'),
    { modal: true },
    '理解并继续',
  );
  if (accepted !== '理解并继续') {
    logger.info('agentSetup.cancelled', { workspaceId, reason: 'data-boundary-not-accepted' });
    return false;
  }
  await context.workspaceState.update(boundaryKey, true);
  return true;
}

async function pickConfigurableAgent(): Promise<ConfigurableAgent | undefined> {
  const statuses = await detectAgentAdapters();
  const picked = await window.showQuickPick(
    statuses.map((status) => ({
      label: status.displayName,
      description: status.installed ? (status.version ?? '已安装') : '未检测到 CLI',
      agent: status.id,
    })),
    { title: '选择要接入当前工作区的 Agent' },
  );
  if (picked === undefined) return undefined;
  if (picked.description === '未检测到 CLI') {
    await window.showErrorMessage(`${picked.label} CLI 未安装或不在 PATH 中。`);
    return undefined;
  }
  return picked.agent;
}

async function showAgentRestartInstruction(
  agent: ConfigurableAgent,
  newlyConfigured: boolean,
): Promise<void> {
  const name = agent === 'codex' ? 'Codex' : 'Claude Code';
  await window.showInformationMessage(
    `${name} MCP ${newlyConfigured ? '已配置并通过复验' : '配置已与当前工作区一致'}。请退出当前 ${name} 会话，在这个工作区目录重新启动，然后先让 Agent 调用 get_map；旧会话不会获得新工具。`,
    { modal: true },
  );
}

/** 检测本地 CLI 并展示显式能力；只执行 --version，不探测登录态或密钥。 */
async function showAgentAdapters(logger: Logger): Promise<void> {
  const statuses = await detectAgentAdapters();
  logger.info('adapters.detected', {
    codex: statuses.find((status) => status.id === 'codex')?.installed,
    claudeCode: statuses.find((status) => status.id === 'claude-code')?.installed,
  });
  const picked = await window.showQuickPick(
    statuses.map((status) => ({
      label: `${status.installed ? '$(check)' : '$(circle-slash)'} ${status.displayName}`,
      description: status.installed ? (status.version ?? '已检测到') : '未检测到可执行文件',
      detail: describeAdapter(status),
      status,
    })),
    {
      title: 'God View Agent Adapters（只读检测）',
      placeHolder: '选择一个 Adapter 查看接入能力；不会修改配置',
    },
  );
  if (picked !== undefined) {
    await window.showInformationMessage(describeAdapter(picked.status), { modal: true });
  }
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
