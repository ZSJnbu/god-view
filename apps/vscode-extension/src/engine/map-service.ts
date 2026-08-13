import { randomBytes } from 'node:crypto';
import { EventEmitter, RelativePattern, Uri, workspace } from 'vscode';
import {
  computeCoverage,
  type GraphSnapshot,
  type RepositoryInventory,
} from '@god-view/graph-core';
import {
  createProtocolValidator,
  currentProtocolVersion,
  type AnnotationThread,
  type CoverageReport,
  type DriftFinding,
  type GodViewEvent,
  type GraphSnapshotDocument,
  type Identifier,
  type ToolResult,
  type WorkspacePath,
} from '@god-view/protocol';
import { writeFileAtomic } from '@god-view/storage';
import { detectDrift, type ValidationOutcome } from '@god-view/validation-core';
import type { ViewCapabilities } from '@god-view/webview-bridge';
import { GitAdapter, type GitState } from '../workspace/git-adapter.js';
import { InventoryBuilder } from '../workspace/inventory-builder.js';
import { VsCodeWorkspaceProbe } from '../workspace/workspace-probe.js';
import { BranchBinding } from './branch-binding.js';
import { InboxWatcher } from './inbox-watcher.js';
import { OperationQueue } from './operation-queue.js';
import { affectedNodeIds } from './path-impact.js';
import { diffSnapshots, isEmptyPatch } from './map-patch.js';
import { buildAnnotationContext } from './annotation-context.js';
import { isApprovalFailure, prepareApproval, type ApprovalFailure } from './proposal-approval.js';
import type { MapServiceOptions, MapUpdate } from './map-service-types.js';
import { rejectProposalEvent, reviewChangeEvent } from './user-events.js';
import { validateEntities } from './entity-validation.js';
import { interruptActiveChange } from './change-interruption.js';
import { watchSourceChanges } from './source-change-watcher.js';
import { acceptedEvent, rejectedEvent, unavailableRepository } from './event-acknowledgement.js';
import { declaredPaths, publicDocument, readReducedMotion } from './map-service-helpers.js';
export type { MapServiceOptions, MapUpdate } from './map-service-types.js';
const runtimeDirectoryName = '.godview';
const approvalLifetimeMs = 15 * 60 * 1000;
export class MapService {
  readonly #options: MapServiceOptions;
  readonly #validator = createProtocolValidator();
  readonly #git: GitAdapter;
  readonly #runtimeDir: Uri;
  readonly #updates = new EventEmitter<MapUpdate>();
  readonly #binding: BranchBinding;
  readonly #disposables: { dispose(): void }[] = [];
  #watcher: InboxWatcher | undefined;
  #gitState: GitState | undefined;
  readonly #queue: OperationQueue;
  #inventory: RepositoryInventory = { included: [], excluded: [], failed: [] };
  #coverage: CoverageReport | undefined;
  #drift: readonly DriftFinding[] = [];
  readonly #outcomes = new Map<Identifier, ValidationOutcome>();
  #factsRevision = 0;
  #userEventSequence = 0;

  readonly onDidUpdate = this.#updates.event;

  constructor(options: MapServiceOptions) {
    this.#options = options;
    this.#git = new GitAdapter(options.identity.root.fsPath);
    this.#runtimeDir = Uri.joinPath(options.identity.root, runtimeDirectoryName);
    this.#binding = new BranchBinding({
      workspaceId: options.identity.id,
      storageRoot: options.storageRoot.fsPath,
      runtimeDir: this.#runtimeDir.fsPath,
      validator: this.#validator,
      now: options.now,
    });
    this.#queue = new OperationQueue({
      onError: (operation, error) => {
        options.logger.error('operation.failed', {
          operation,
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  get snapshot(): GraphSnapshot {
    return this.#binding.repository.snapshot;
  }

  get snapshotOrUndefined(): GraphSnapshot | undefined {
    return this.#binding.repositoryOrUndefined?.snapshot;
  }

  get root(): Uri {
    return this.#options.identity.root;
  }

  get coverage(): CoverageReport | undefined {
    return this.#coverage;
  }

  get drift(): readonly DriftFinding[] {
    return this.#drift;
  }

  get factsRevision(): number {
    return this.#factsRevision;
  }

  get capabilities(): ViewCapabilities {
    return {
      hasGit: this.#gitState?.hasGit ?? false,
      canExecuteChanges: false,
      reducedMotion: readReducedMotion(),
      branchKey: this.#binding.branchKey ?? this.#gitState?.branchKey ?? 'no-git',
    };
  }

  async open(): Promise<void> {
    await this.#bindCurrentBranch();
    await this.#refreshFactsNow();

    const watcher = new InboxWatcher({
      inboxDir: Uri.joinPath(this.#runtimeDir, 'inbox'),
      acknowledgementsDir: Uri.joinPath(this.#runtimeDir, 'acknowledgements'),
      validator: this.#validator,
      logger: this.#options.logger.child('inbox'),
      onEvent: async ({ event, fileName }) => {
        let outcome: ToolResult = {
          accepted: false,
          mapRevision: this.#binding.repositoryOrUndefined?.snapshot.revision ?? 0,
          errors: [{ code: 'CANCELLED', message: '事件处理队列未返回结果' }],
        };
        await this.#queue.run('event.apply', async () => {
          outcome = await this.#applyEvent(event, fileName);
        });
        return outcome;
      },
    });
    await watcher.start();
    this.#watcher = watcher;
    this.#watchBranchChanges();
    this.#disposables.push(
      watchSourceChanges({
        root: this.#options.identity.root,
        runtimeDirectoryName,
        debounceMs: 750,
        refresh: (paths) => void this.refreshFacts(paths),
      }),
    );
  }

  async syncBranch(): Promise<void> {
    await this.#queue.run('branch.sync', async () => {
      const previous = this.#binding.branchKey;
      const gitState = await this.#git.read();
      if (previous !== undefined && gitState.branchKey !== previous) {
        await this.#interruptActiveChange(
          `检测到 Git 分支从 ${previous} 切换到 ${gitState.branchKey}；保留切换前最后一次已观察 Diff`,
          false,
        );
      }
      await this.#bindCurrentBranch(gitState);
      if (this.#binding.branchKey === previous) {
        return;
      }
      this.#outcomes.clear();
      this.#factsRevision = 0;
      await this.#refreshFactsNow(undefined, 'reload');
    });
  }

  async #bindCurrentBranch(knownGitState?: GitState): Promise<void> {
    const gitState = knownGitState ?? (await this.#git.read());
    this.#gitState = gitState;
    const result = await this.#binding.bind({
      branchKey: gitState.branchKey,
      ...(gitState.headRevision === undefined ? {} : { baseGitRevision: gitState.headRevision }),
    });
    if (!result.changed) return;
    this.#options.logger.info('map.restored', {
      restoredFrom: result.report?.restoredFrom,
      replayedEvents: result.report?.replayedEvents,
      rejected: result.report?.rejected.length,
      quarantined: result.report?.quarantined.length,
      branchKey: result.branchKey,
      hasGit: gitState.hasGit,
      preexistingChanges: gitState.preexistingChanges.length,
      prunedEvents: result.retention?.prunedEvents,
      redactedAnnotations: result.retention?.redactedAnnotations,
    });
  }

  #watchBranchChanges(): void {
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(this.#options.identity.root, '.git/HEAD'),
    );
    const onChange = (): void => {
      void this.syncBranch();
    };
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    this.#disposables.push(watcher);
  }

  async refreshFacts(changedPaths?: readonly string[]): Promise<void> {
    await this.#queue.run('facts.refresh', () => this.#refreshFactsNow(changedPaths));
  }

  async createAnnotation(input: {
    readonly annotationType: 'note' | 'explain' | 'risk' | 'change';
    readonly body: string;
    readonly nodeIds: readonly Identifier[];
    readonly excludedPaths?: readonly WorkspacePath[];
  }): Promise<Identifier | undefined> {
    let createdId: Identifier | undefined;
    await this.#queue.run('annotation.create', async () => {
      const repository = this.#binding.repositoryOrUndefined;
      if (repository === undefined) return;
      const context = buildAnnotationContext(
        repository.snapshot,
        input.nodeIds,
        input.excludedPaths ?? [],
      );
      if (context === undefined) return;
      const stamp = this.#nextUserEventId('annotation');
      const timestamp = this.#options.now();
      const annotation: AnnotationThread = {
        id: stamp,
        type: input.annotationType,
        status: 'sent',
        target: context.target,
        messages: [
          {
            id: `${stamp}.question`,
            author: 'user',
            body: input.body.trim(),
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
      };
      const event: GodViewEvent = {
        version: currentProtocolVersion,
        workspaceId: repository.snapshot.workspaceId,
        branchKey: repository.snapshot.branchKey,
        sessionId: 'god-view.user',
        eventId: `${stamp}.create`,
        timestamp,
        actor: { kind: 'user', displayName: 'VS Code user' },
        type: 'annotation_create',
        payload: { annotation },
      };
      await this.#applyEvent(event, 'webview:createAnnotation');
      if (repository.snapshot.annotations.has(stamp)) createdId = stamp;
    });
    return createdId;
  }

  async resolveAnnotation(annotationId: Identifier): Promise<boolean> {
    let resolved = false;
    await this.#queue.run('annotation.resolve', async () => {
      const repository = this.#binding.repositoryOrUndefined;
      if (!repository?.snapshot.annotations.has(annotationId)) return;
      const timestamp = this.#options.now();
      const eventId = this.#nextUserEventId('resolve');
      const event: GodViewEvent = {
        version: currentProtocolVersion,
        workspaceId: repository.snapshot.workspaceId,
        branchKey: repository.snapshot.branchKey,
        sessionId: 'god-view.user',
        eventId,
        timestamp,
        actor: { kind: 'user', displayName: 'VS Code user' },
        type: 'annotation_resolve',
        payload: { annotationId },
      };
      await this.#applyEvent(event, 'webview:resolveAnnotation');
      resolved = repository.snapshot.annotations.get(annotationId)?.status === 'resolved';
    });
    return resolved;
  }

  async approveProposal(
    proposalId: Identifier,
    approvedScope: readonly WorkspacePath[],
    acknowledgePreexistingChanges = false,
  ): Promise<
    | ApprovalFailure
    | {
        readonly ok: true;
        readonly token: Identifier;
        readonly overlappingChanges: readonly string[];
      }
  > {
    let outcome:
      | ApprovalFailure
      | {
          readonly ok: true;
          readonly token: Identifier;
          readonly overlappingChanges: readonly string[];
        } = { ok: false, reason: '地图尚未就绪' };
    await this.#queue.run('proposal.approve', async () => {
      const repository = this.#binding.repositoryOrUndefined;
      if (repository === undefined) return;
      const gitState = await this.#git.read();
      this.#gitState = gitState;
      const prepared = prepareApproval({
        snapshot: repository.snapshot,
        gitState,
        proposalId,
        approvedScope,
        acknowledgePreexistingChanges,
      });
      if (isApprovalFailure(prepared)) {
        outcome = prepared;
        return;
      }
      const approvedAt = this.#options.now();
      const token = `approval.${randomBytes(16).toString('hex')}`.slice(0, 200);
      const event: GodViewEvent = {
        version: currentProtocolVersion,
        workspaceId: repository.snapshot.workspaceId,
        branchKey: repository.snapshot.branchKey,
        sessionId: 'god-view.user',
        eventId: this.#nextUserEventId('approve'),
        timestamp: approvedAt,
        actor: { kind: 'user', displayName: 'VS Code user' },
        type: 'change_approved',
        payload: {
          proposalId,
          approval: {
            token,
            approvedScope: [...prepared.scope],
            permissionMode: 'monitored',
            approvedAt,
            expiresAt: new Date(Date.parse(approvedAt) + approvalLifetimeMs).toISOString(),
            branchKey: repository.snapshot.branchKey,
            mapRevision: repository.snapshot.revision,
            gitRevision: prepared.gitRevision,
            preexistingChanges: [...prepared.preexistingChanges],
          },
        },
      };
      await this.#applyEvent(event, 'webview:approveProposal');
      if (repository.snapshot.changeProposals.get(proposalId)?.status === 'approved') {
        outcome = { ok: true, token, overlappingChanges: prepared.overlappingChanges };
      } else {
        outcome = { ok: false, reason: '批准事件被领域规则拒绝' };
      }
    });
    return outcome;
  }

  async rejectProposal(proposalId: Identifier): Promise<boolean> {
    let rejected = false;
    await this.#queue.run('proposal.reject', async () => {
      const repository = this.#binding.repositoryOrUndefined;
      if (repository?.snapshot.changeProposals.get(proposalId)?.status !== 'proposed') return;
      const event = rejectProposalEvent(
        {
          snapshot: repository.snapshot,
          eventId: this.#nextUserEventId('reject'),
          timestamp: this.#options.now(),
        },
        proposalId,
      );
      await this.#applyEvent(event, 'webview:rejectProposal');
      rejected = repository.snapshot.changeProposals.get(proposalId)?.status === 'rejected';
    });
    return rejected;
  }

  async reviewChange(
    changeSetId: Identifier,
    status: 'accepted' | 'accepted_with_issues',
    note?: string,
  ): Promise<boolean> {
    let reviewed = false;
    await this.#queue.run('change.review', async () => {
      const repository = this.#binding.repositoryOrUndefined;
      if (repository?.snapshot.completedChanges.get(changeSetId)?.status !== 'pending_review')
        return;
      const event = reviewChangeEvent(
        {
          snapshot: repository.snapshot,
          eventId: this.#nextUserEventId('review'),
          timestamp: this.#options.now(),
        },
        { changeSetId, status, ...(note === undefined ? {} : { note }) },
      );
      await this.#applyEvent(event, 'webview:reviewChange');
      reviewed = repository.snapshot.completedChanges.get(changeSetId)?.status === status;
    });
    return reviewed;
  }

  async interruptChange(changeSetId: Identifier): Promise<boolean> {
    let interrupted = false;
    await this.#queue.run('change.interrupt', async () => {
      const active = this.#binding.repositoryOrUndefined?.snapshot.activeChanges.get(changeSetId);
      if (active === undefined) return;
      const interruptedId = await this.#interruptActiveChange(
        '用户停止了 ChangeSet；已产生的文件修改保留供审查',
        true,
      );
      // 未关联 proposal 或尚无 Diff 的 legacy ChangeSet 不会生成 CompletedChange，
      // 但只要领域归约已删除目标活动项，中断就确实成功，不能向 UI 假报失败。
      interrupted =
        interruptedId === changeSetId &&
        !this.#binding.repositoryOrUndefined?.snapshot.activeChanges.has(changeSetId);
    });
    return interrupted;
  }

  async #interruptActiveChange(
    reason: string,
    observeCurrentGit: boolean,
  ): Promise<Identifier | undefined> {
    return interruptActiveChange(
      {
        repository: () => this.#binding.repositoryOrUndefined,
        ...(observeCurrentGit
          ? {
              observe: (snapshot: GraphSnapshot) => this.#observeActiveChange(snapshot),
              apply: async (event: GodViewEvent) => {
                await this.#applyEvent(event, 'webview:interruptChange');
              },
            }
          : {}),
        nextEventId: () => this.#nextUserEventId('interrupt'),
        now: this.#options.now,
        actor: observeCurrentGit ? 'user' : 'system',
      },
      reason,
    );
  }

  #nextUserEventId(kind: string): Identifier {
    this.#userEventSequence += 1;
    const safeTime = this.#options.now().replace(/[^A-Za-z0-9]/gu, '-');
    return `user.${kind}.${safeTime}.${String(this.#userEventSequence)}`.slice(0, 200);
  }

  async #refreshFactsNow(
    changedPaths?: readonly string[],
    kind: MapUpdate['kind'] = 'facts',
  ): Promise<void> {
    const repository = this.#binding.repositoryOrUndefined;
    if (repository === undefined) {
      return;
    }
    const inventoryBuilder = new InventoryBuilder(this.#git, {
      extraExcludes: this.#options.extraExcludes,
    });
    this.#inventory = await inventoryBuilder.build(await this.#fallbackFileList());

    const { report } = computeCoverage(this.#inventory, repository.snapshot, this.#options.now());
    this.#coverage = report;

    const affected =
      changedPaths === undefined ? undefined : affectedNodeIds(repository.snapshot, changedPaths);
    if (changedPaths !== undefined) {
      this.#options.logger.debug('facts.incremental', {
        changedPaths: changedPaths.length,
        affectedIds: affected?.length ?? 0,
        sample: changedPaths.slice(0, 3).join(', '),
      });
    }
    await this.#revalidate(repository.snapshot, affected);
    await this.#observeActiveChange(repository.snapshot);

    await this.#publishReadModel(repository.snapshot);
    this.#updates.fire({
      kind,
      revision: repository.snapshot.revision,
      factsRevision: this.#factsRevision,
      patch: { upsertedNodes: [], upsertedEdges: [], removedNodeIds: [], removedEdgeIds: [] },
      drift: this.#drift,
      coverage: report,
    });
  }

  async #observeActiveChange(snapshot: GraphSnapshot): Promise<void> {
    const [change] = [...snapshot.activeChanges.values()];
    if (change?.approvedScope === undefined) return;
    const timestamp = this.#options.now();
    const diff = await this.#git.diffSummary({
      approvedScope: change.approvedScope,
      preexistingChanges: change.preexistingChanges ?? [],
      computedAt: timestamp,
    });
    if (diff === undefined) return;
    const executionStatus = diff.files.some((file) => file.scopeStatus === 'outside_scope')
      ? 'scope_violation'
      : 'in_progress';
    if (change.executionStatus === executionStatus && change.diff?.contentHash === diff.contentHash)
      return;
    const event: GodViewEvent = {
      version: currentProtocolVersion,
      workspaceId: snapshot.workspaceId,
      branchKey: snapshot.branchKey,
      sessionId: 'god-view.system',
      eventId: this.#nextUserEventId('observe'),
      timestamp,
      actor: { kind: 'system', displayName: 'God View validation' },
      type: 'change_observed',
      payload: { changeSetId: change.changeSetId, executionStatus, diff },
    };
    await this.#applyEvent(event, 'system:observeChange');
  }

  async #revalidate(snapshot: GraphSnapshot, changedIds?: readonly Identifier[]): Promise<void> {
    const validationIds =
      changedIds === undefined
        ? undefined
        : [
            ...changedIds,
            ...[...snapshot.edges.values()]
              .filter((edge) => changedIds.includes(edge.from) || changedIds.includes(edge.to))
              .map((edge) => edge.id),
          ];
    if (validationIds === undefined) {
      this.#outcomes.clear();
    } else {
      for (const id of validationIds) {
        this.#outcomes.delete(id);
      }
    }
    const probe = new VsCodeWorkspaceProbe(this.#options.identity.root, () =>
      Promise.resolve(this.#inventory.included.map((entry) => entry.path)),
    );
    const outcomes = await validateEntities({
      snapshot,
      probe,
      checkedAt: this.#options.now,
      ...(validationIds === undefined ? {} : { changedIds: validationIds }),
    });
    for (const outcome of outcomes) {
      this.#outcomes.set(outcome.targetId, outcome);
    }
    for (const id of [...this.#outcomes.keys()]) {
      if (!snapshot.nodes.has(id) && !snapshot.edges.has(id)) {
        this.#outcomes.delete(id);
      }
    }
    this.#drift = detectDrift({
      outcomes: [...this.#outcomes.values()],
      declaredPaths: declaredPaths(snapshot),
      firstPartyFiles: this.#inventory.included.map((entry) => entry.path),
    });
    this.#factsRevision += 1;
  }

  async flush(): Promise<void> {
    await this.#queue.drain();
    await this.#binding.flush();
  }

  dispose(): void {
    this.#watcher?.dispose();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables.length = 0;
    this.#updates.dispose();
  }

  async #applyEvent(event: GodViewEvent, fileName: string): Promise<ToolResult> {
    let repository = this.#binding.repositoryOrUndefined;
    if (repository === undefined) return unavailableRepository();
    if (event.type === 'change_complete') {
      await this.#observeActiveChange(repository.snapshot);
      repository = this.#binding.repositoryOrUndefined;
      if (repository === undefined) return unavailableRepository();
    }
    const before = repository.snapshot;
    const result = await repository.append(event);
    if (!result.ok) {
      this.#options.logger.warn('event.rejected', {
        fileName,
        type: event.type,
        code: result.error.code,
        entityId: result.error.entityId,
      });
      return rejectedEvent(event, repository.snapshot, result.error);
    }
    const patch = diffSnapshots(before, result.value);
    if (isEmptyPatch(patch)) {
      return acceptedEvent(event, result.value);
    }
    const { report } = computeCoverage(this.#inventory, result.value, this.#options.now());
    this.#coverage = report;

    await this.#revalidate(result.value, [
      ...patch.upsertedNodes.map((node) => node.id),
      ...patch.upsertedEdges.map((edge) => edge.id),
    ]);

    await this.#publishReadModel(result.value);
    this.#options.logger.info('event.applied', {
      type: event.type,
      revision: result.value.revision,
      upsertedNodes: patch.upsertedNodes.length,
      upsertedEdges: patch.upsertedEdges.length,
    });
    this.#updates.fire({
      kind: 'patch',
      revision: result.value.revision,
      factsRevision: this.#factsRevision,
      patch,
      drift: this.#drift,
      coverage: report,
    });
    return acceptedEvent(event, result.value);
  }

  async #publishReadModel(snapshot: GraphSnapshot): Promise<void> {
    const document = publicDocument(snapshot, this.#coverage, [...this.#outcomes.values()]);
    await writeFileAtomic(
      Uri.joinPath(this.#runtimeDir, 'map.json').fsPath,
      JSON.stringify(document),
    );
  }

  async #fallbackFileList(): Promise<readonly string[]> {
    const found = await workspace.findFiles(
      new RelativePattern(this.#options.identity.root, '**/*'),
      undefined,
      20000,
    );
    const rootPath = this.#options.identity.root.fsPath;
    return found.map((uri) => uri.fsPath.slice(rootPath.length + 1).replace(/\\/gu, '/'));
  }

  toDocument(): GraphSnapshotDocument {
    return publicDocument(this.snapshot, this.#coverage, [...this.#outcomes.values()]);
  }
}
