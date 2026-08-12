import { join } from 'node:path';
import {
  createProtocolValidator,
  currentProtocolVersion,
  errorCodes,
  isProtocolVersionSupported,
  type GetMapResult,
  type GodViewEvent,
  type GraphSnapshotDocument,
  type Actor,
  type Identifier,
  type ProtocolValidator,
  type SessionScopedInput,
  type ToolError,
  type ToolInputByName,
  type ToolResult,
} from '@god-view/protocol';
import { readTextFile, writeFileAtomic } from '@god-view/storage';
import { resolveWorkspaceRuntime, type WorkspaceRuntimeLayout } from './runtime-layout.js';
import { readSessionDescriptor } from './session-descriptor.js';

export interface GatewayOptions {
  readonly workspaceRoot: string;
  readonly workspaceId: Identifier;
  readonly branchKey: Identifier;
  /** 时间来源显式注入，便于测试与回放。 */
  readonly now: () => string;
  readonly adapterId?: Identifier;
  readonly validator?: ProtocolValidator;
}

/** 除 get_map 外的写工具。 */
type WriteToolName = Exclude<keyof ToolInputByName, 'get_map'>;

/** 由 Gateway 填充的事件信封公共字段。事件类型与 payload 由各工具补齐。 */
interface EventEnvelopeBase {
  readonly version: string;
  readonly workspaceId: Identifier;
  readonly branchKey: Identifier;
  readonly sessionId: Identifier;
  readonly eventId: Identifier;
  readonly timestamp: string;
  readonly actor: Actor;
  readonly baseMapRevision?: number;
}

/** 只有 remove_node / remove_edge 需要区分实体类型，其余工具与协议事件一一对应。 */
export type GatewayToolName =
  | 'get_map'
  | 'begin_change'
  | 'upsert_node'
  | 'upsert_edge'
  | 'upsert_story'
  | 'answer_annotation'
  | 'request_write_access'
  | 'propose_change'
  | 'start_approved_change'
  | 'remove_node'
  | 'remove_edge'
  | 'complete_change';

const identifierUnsafe = /[^A-Za-z0-9._:/-]/gu;

/**
 * 由 sessionId 与幂等 key 推导事件 ID。
 *
 * 事件 ID 决定幂等性：Agent 用同一个 key 重试时必须得到同一个 ID，
 * 状态引擎才能识别为重复事件而不是新节点。
 */
function deriveEventId(sessionId: string, idempotencyKey: string): Identifier {
  return `${sessionId}.${idempotencyKey}`.replace(identifierUnsafe, '-').slice(0, 200);
}

function toToolErrors(
  errors: readonly { code: string; message: string; path?: string }[],
): ToolError[] {
  return errors.map((error) => ({
    code: error.code,
    message: error.message,
    ...(error.path === undefined ? {} : { path: error.path }),
  }));
}

/**
 * Agent 工具会话。
 *
 * Gateway 不持有图状态：它把事件原子地写入收件箱，由扩展侧的单写者状态引擎归约。
 * 这样 Agent、CLI 和扩展三方不会并发写同一份日志。
 */
export class GatewaySession {
  readonly #options: GatewayOptions;
  readonly #layout: WorkspaceRuntimeLayout;
  readonly #validator: ProtocolValidator;
  /**
   * 当前分支。
   *
   * **不能**在构造时定死：`god-view serve` 是长期进程，用户随时可能 checkout。
   * 固定住启动时的值会让切换之后的事件继续盖旧分支标签，被状态引擎拒绝，
   * 或者在竞态下落到旧分支的日志里——两种结果都是静默的数据归属错误。
   */
  #branchKey: Identifier;
  #sequence = 0;

  constructor(options: GatewayOptions) {
    this.#options = options;
    this.#layout = resolveWorkspaceRuntime(options.workspaceRoot);
    this.#validator = options.validator ?? createProtocolValidator();
    this.#branchKey = options.branchKey;
  }

  /** 扩展当前绑定的分支。每次工具调用都会重新读取。 */
  get branchKey(): Identifier {
    return this.#branchKey;
  }

  /**
   * 从会话描述同步分支。
   *
   * 描述缺失或属于另一个工作区时保持现有绑定：宁可让状态引擎以
   * WORKSPACE_MISMATCH 明确拒绝，也不要静默改写归属。
   */
  async #syncBranch(): Promise<{
    branchKey: Identifier;
    changed: boolean;
    incompatibleVersion?: string;
  }> {
    const descriptor = await readSessionDescriptor(this.#layout.sessionFile);
    if (descriptor?.workspaceId !== this.#options.workspaceId) {
      return { branchKey: this.#branchKey, changed: false };
    }
    if (!isProtocolVersionSupported(descriptor.protocolVersion)) {
      return {
        branchKey: this.#branchKey,
        changed: false,
        incompatibleVersion: descriptor.protocolVersion,
      };
    }
    const changed = descriptor.branchKey !== this.#branchKey;
    this.#branchKey = descriptor.branchKey;
    return { branchKey: this.#branchKey, changed };
  }

  /**
   * 读取扩展发布的地图读模型。
   *
   * 读模型可能略滞后于最新事件，返回的 `mapRevision` 让 Agent 能判断自己
   * 是否基于过期基线继续声明。
   */
  async getMap(input: unknown): Promise<GetMapResult | ToolResult> {
    const parsed = this.#validator.validateToolInput('get_map', input);
    if (!parsed.ok) {
      return this.#rejected(toToolErrors(parsed.error), 0);
    }
    const branch = await this.#syncBranch();
    if (branch.incompatibleVersion !== undefined) {
      return this.#unsupportedProtocol(branch.incompatibleVersion, 0);
    }
    const document = await this.#readMap();
    if (document === undefined) {
      return {
        mapRevision: 0,
        branchKey: branch.branchKey,
        nodes: [],
        edges: [],
        stories: [],
        annotations: [],
        writeAccessRequests: [],
        changeProposals: [],
      };
    }
    const nodeIds = parsed.value.nodeIds;
    const nodes =
      nodeIds === undefined
        ? document.nodes
        : document.nodes.filter((node) => nodeIds.includes(node.id));
    return {
      mapRevision: document.revision,
      branchKey: document.branchKey,
      nodes,
      edges: document.edges,
      stories: document.stories ?? [],
      annotations: document.annotations ?? [],
      writeAccessRequests: document.writeAccessRequests ?? [],
      changeProposals: document.changeProposals ?? [],
      ...(parsed.value.includeCoverage === false || document.coverage === undefined
        ? {}
        : { coverage: document.coverage }),
    };
  }

  beginChange(input: unknown): Promise<ToolResult> {
    return this.#submit('begin_change', input, (parsed, envelope) => ({
      ...envelope,
      type: 'change_start',
      payload: {
        changeSetId: parsed.changeSetId ?? envelope.eventId,
        intent: parsed.intent,
        ...(parsed.plannedFiles === undefined ? {} : { plannedFiles: parsed.plannedFiles }),
      },
    }));
  }

  upsertNode(input: unknown): Promise<ToolResult> {
    return this.#submit('upsert_node', input, (parsed, envelope) => ({
      ...envelope,
      type: 'node_upsert',
      payload: {
        node: parsed.node,
        ...(parsed.changeSetId === undefined ? {} : { changeSetId: parsed.changeSetId }),
      },
    }));
  }

  upsertEdge(input: unknown): Promise<ToolResult> {
    return this.#submit('upsert_edge', input, (parsed, envelope) => ({
      ...envelope,
      type: 'edge_upsert',
      payload: {
        edge: parsed.edge,
        ...(parsed.changeSetId === undefined ? {} : { changeSetId: parsed.changeSetId }),
      },
    }));
  }

  upsertStory(input: unknown): Promise<ToolResult> {
    return this.#submit('upsert_story', input, (parsed, envelope) => ({
      ...envelope,
      type: 'story_upsert',
      payload: { story: parsed.story },
    }));
  }

  answerAnnotation(input: unknown): Promise<ToolResult> {
    return this.#submit('answer_annotation', input, (parsed, envelope) => ({
      ...envelope,
      type: 'annotation_answer',
      payload: {
        annotationId: parsed.annotationId,
        message: {
          id: `${envelope.eventId}.message`.slice(0, 200),
          author: 'agent',
          body: parsed.summary,
          ...(parsed.detail === undefined ? {} : { detail: parsed.detail }),
          ...(parsed.evidence === undefined ? {} : { evidence: parsed.evidence }),
          ...(parsed.uncertain === undefined ? {} : { uncertain: parsed.uncertain }),
          createdAt: envelope.timestamp,
        },
        ...(parsed.story === undefined ? {} : { story: parsed.story }),
      },
    }));
  }

  requestWriteAccess(input: unknown): Promise<ToolResult> {
    return this.#submit('request_write_access', input, (parsed, envelope) => ({
      ...envelope,
      type: 'write_access_requested',
      payload: {
        request: {
          id: `${envelope.eventId}.request`.slice(0, 200),
          annotationId: parsed.annotationId,
          status: 'requested',
          reason: parsed.reason,
          expectedScope: [...parsed.expectedScope].sort(),
          requestedAt: envelope.timestamp,
        },
      },
    }));
  }

  proposeChange(input: unknown): Promise<ToolResult> {
    return this.#submit('propose_change', input, (parsed, envelope) => ({
      ...envelope,
      type: 'change_proposal',
      payload: {
        proposal: {
          id: `${envelope.eventId}.proposal`.slice(0, 200),
          annotationId: parsed.annotationId,
          requestId: parsed.requestId,
          status: 'proposed',
          summary: parsed.summary,
          plannedFiles: [...parsed.plannedFiles].sort(),
          structuralChanges: parsed.structuralChanges,
          risks: parsed.risks,
          validationPlan: parsed.validationPlan,
          branchKey: envelope.branchKey,
          baseMapRevision: parsed.baseMapRevision,
          ...(parsed.baseGitRevision === undefined
            ? {}
            : { baseGitRevision: parsed.baseGitRevision }),
          createdAt: envelope.timestamp,
        },
      },
    }));
  }

  async startApprovedChange(input: unknown): Promise<ToolResult> {
    const parsed = this.#validator.validateToolInput('start_approved_change', input);
    if (!parsed.ok)
      return this.#rejected(toToolErrors(parsed.error), await this.#currentRevision());
    const branch = await this.#syncBranch();
    if (branch.incompatibleVersion !== undefined)
      return this.#unsupportedProtocol(branch.incompatibleVersion, await this.#currentRevision());
    const document = await this.#readMap();
    const proposal = document?.changeProposals?.find((item) => item.id === parsed.value.proposalId);
    const approval = proposal?.approval;
    if (
      document === undefined ||
      proposal?.status !== 'approved' ||
      approval?.token !== parsed.value.approvalToken
    ) {
      return this.#rejected(
        [{ code: errorCodes.CANCELLED, message: '方案不存在、尚未批准或批准令牌不匹配' }],
        document?.revision ?? 0,
      );
    }
    if (!isApprovalCurrent(document, approval, this.#options.now())) {
      return this.#rejected(
        [
          {
            code: errorCodes.STALE_MAP_REVISION,
            message: '批准令牌已过期，或地图、分支、Git 基线已经变化',
          },
        ],
        document.revision,
      );
    }
    return this.#submit(
      'start_approved_change',
      { ...parsed.value, baseMapRevision: approval.mapRevision },
      (start, envelope) => ({
        ...envelope,
        type: 'change_start',
        payload: {
          changeSetId: `${envelope.eventId}.change`.slice(0, 200),
          intent: proposal.summary,
          plannedFiles: approval.approvedScope,
          proposalId: start.proposalId,
          approvalToken: start.approvalToken,
        },
      }),
    );
  }

  removeNode(input: unknown): Promise<ToolResult> {
    return this.#submit('remove_entity', input, (parsed, envelope) => ({
      ...envelope,
      type: 'node_remove',
      payload: {
        nodeId: parsed.entityId,
        reason: parsed.reason,
        ...(parsed.changeSetId === undefined ? {} : { changeSetId: parsed.changeSetId }),
      },
    }));
  }

  removeEdge(input: unknown): Promise<ToolResult> {
    return this.#submit('remove_entity', input, (parsed, envelope) => ({
      ...envelope,
      type: 'edge_remove',
      payload: {
        edgeId: parsed.entityId,
        reason: parsed.reason,
        ...(parsed.changeSetId === undefined ? {} : { changeSetId: parsed.changeSetId }),
      },
    }));
  }

  completeChange(input: unknown): Promise<ToolResult> {
    return this.#submit('complete_change', input, (parsed, envelope) => ({
      ...envelope,
      type: 'change_complete',
      payload: {
        changeSetId: parsed.changeSetId,
        status: parsed.status,
        ...(parsed.actualFiles === undefined ? {} : { actualFiles: parsed.actualFiles }),
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
      },
    }));
  }

  /** 直接投递一条已构造好的事件，供 CLI 兜底路径使用。 */
  async submitRawEvent(input: unknown): Promise<ToolResult> {
    const branch = await this.#syncBranch();
    if (branch.incompatibleVersion !== undefined) {
      return this.#unsupportedProtocol(branch.incompatibleVersion, await this.#currentRevision());
    }
    const parsed = this.#validator.validateEvent(input);
    if (!parsed.ok) {
      return this.#rejected(toToolErrors(parsed.error), await this.#currentRevision());
    }
    if (parsed.value.actor?.kind === 'user' || parsed.value.actor?.kind === 'system') {
      return this.#rejected(
        [
          {
            code: errorCodes.UNSUPPORTED,
            message: '事件文件入口只能提交 Agent/未知来源声明，不能冒充用户批准、验收或系统观察',
          },
        ],
        await this.#currentRevision(),
      );
    }
    if (
      parsed.value.workspaceId !== this.#options.workspaceId ||
      parsed.value.branchKey !== branch.branchKey
    ) {
      return this.#rejected(
        [
          {
            code: errorCodes.WORKSPACE_MISMATCH,
            message: `事件属于 ${parsed.value.workspaceId}/${parsed.value.branchKey}，当前会话为 ${this.#options.workspaceId}/${branch.branchKey}`,
          },
        ],
        await this.#currentRevision(),
      );
    }
    const event: GodViewEvent = {
      ...parsed.value,
      actor: {
        kind: 'agent',
        ...(this.#options.adapterId === undefined ? {} : { adapterId: this.#options.adapterId }),
      },
    };
    await this.#deliver(event);
    return {
      accepted: true,
      mapRevision: await this.#currentRevision(),
      eventId: event.eventId,
      errors: [],
    };
  }

  async #submit<K extends WriteToolName>(
    tool: K,
    input: unknown,
    build: (parsed: ToolInputByName[K], envelope: EventEnvelopeBase) => GodViewEvent,
  ): Promise<ToolResult> {
    // 先同步分支再取版本号：两者必须来自同一次读取，否则会用旧分支的版本
    // 去校验新分支的基线。
    const branch = await this.#syncBranch();
    if (branch.incompatibleVersion !== undefined) {
      return this.#unsupportedProtocol(branch.incompatibleVersion, await this.#currentRevision());
    }
    const warnings = branch.changed
      ? {
          warnings: [
            `工作区已切换到分支 ${branch.branchKey}，本次事件记入该分支。请重新调用 get_map 获取新分支的地图。`,
          ],
        }
      : {};
    const revision = await this.#currentRevision();
    const parsed = this.#validator.validateToolInput(tool, input);
    if (!parsed.ok) {
      return { ...this.#rejected(toToolErrors(parsed.error), revision), ...warnings };
    }
    const scoped: SessionScopedInput = parsed.value;
    const envelope: EventEnvelopeBase = {
      version: currentProtocolVersion,
      workspaceId: this.#options.workspaceId,
      branchKey: branch.branchKey,
      sessionId: scoped.sessionId,
      eventId: deriveEventId(scoped.sessionId, scoped.idempotencyKey),
      timestamp: this.#options.now(),
      actor: {
        kind: 'agent',
        ...(this.#options.adapterId === undefined ? {} : { adapterId: this.#options.adapterId }),
      },
      ...(scoped.baseMapRevision === undefined ? {} : { baseMapRevision: scoped.baseMapRevision }),
    };
    const event = build(parsed.value, envelope);
    const validated = this.#validator.validateEvent(event);
    if (!validated.ok) {
      return { ...this.#rejected(toToolErrors(validated.error), revision), ...warnings };
    }
    await this.#deliver(validated.value);
    return {
      accepted: true,
      mapRevision: revision,
      eventId: validated.value.eventId,
      errors: [],
      ...warnings,
    };
  }

  /**
   * 原子投递：先写临时文件并 fsync，再 rename 为正式事件文件。
   *
   * 扩展只会看到完整文件，不会读到半写内容（TECHNICAL_ARCHITECTURE.md §7.2）。
   */
  async #deliver(event: GodViewEvent): Promise<void> {
    this.#sequence += 1;
    const fileName = `${String(this.#sequence).padStart(6, '0')}-${event.eventId.replace(identifierUnsafe, '-')}.json`;
    await writeFileAtomic(join(this.#layout.inboxDir, fileName), JSON.stringify(event));
  }

  async #readMap(): Promise<GraphSnapshotDocument | undefined> {
    const contents = await readTextFile(this.#layout.mapFile);
    if (contents === undefined) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      return undefined;
    }
    const validated = this.#validator.validateSnapshot(parsed);
    return validated.ok ? validated.value : undefined;
  }

  async #currentRevision(): Promise<number> {
    return (await this.#readMap())?.revision ?? 0;
  }

  #rejected(errors: readonly ToolError[], mapRevision: number): ToolResult {
    return { accepted: false, mapRevision, errors: [...errors] };
  }

  #unsupportedProtocol(version: string, mapRevision: number): ToolResult {
    return this.#rejected(
      [
        {
          code: errorCodes.UNSUPPORTED_PROTOCOL_VERSION,
          message: `扩展会话协议为 ${version}，当前 Gateway 支持 ${currentProtocolVersion}。请重新复制 Agent 接入配置并重启 MCP 连接。`,
          path: '/protocolVersion',
        },
      ],
      mapRevision,
    );
  }
}

function isApprovalCurrent(
  document: GraphSnapshotDocument,
  approval: NonNullable<NonNullable<GraphSnapshotDocument['changeProposals']>[number]['approval']>,
  now: string,
): boolean {
  return (
    document.branchKey === approval.branchKey &&
    document.baseGitRevision === approval.gitRevision &&
    document.revision === approval.mapRevision + 1 &&
    Date.parse(approval.expiresAt) > Date.parse(now)
  );
}
