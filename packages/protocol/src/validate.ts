import {
  Ajv2020,
  type ErrorObject,
  type SchemaObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { runtimeSchemas } from './generated/schemas.js';
import type {
  AnswerAnnotationInput,
  AdapterCapabilities,
  BeginChangeInput,
  CompleteChangeInput,
  GetMapInput,
  GodViewEvent,
  GraphSnapshotDocument,
  RemoveEntityInput,
  ProposeChangeInput,
  RequestWriteAccessInput,
  StartApprovedChangeInput,
  ToolResult,
  UpsertStoryInput,
  UpsertEdgeInput,
  UpsertNodeInput,
} from './generated/protocol-types.js';
import { errorCodes, protocolError, type ProtocolError } from './error-codes.js';
import { err, ok, type Result } from './result.js';
import { isProtocolVersionSupported } from './version.js';

/** 当前实现会归约进图状态的事件类型。 */
export const supportedEventTypes = [
  'session_start',
  'change_start',
  'node_upsert',
  'node_remove',
  'edge_upsert',
  'edge_remove',
  'change_complete',
  'session_end',
  'story_upsert',
  'annotation_create',
  'annotation_answer',
  'annotation_resolve',
  'write_access_requested',
  'change_proposal',
  'change_approved',
  'change_rejected',
  'change_observed',
  'change_reviewed',
] as const;

export type SupportedEventType = (typeof supportedEventTypes)[number];

/** 协议已保留但当前实现拒绝的独立异常/取消事件类型。 */
export const reservedEventTypes = [
  'change_accepted',
  'unexpected_write',
  'scope_violation',
  'change_interrupted',
  'change_conflicted',
  'change_cancelled',
  'change_failed',
] as const;

export type ReservedEventTypeName = (typeof reservedEventTypes)[number];

const eventDefinitionByType: Record<SupportedEventType, string> = {
  session_start: 'SessionStartEvent',
  change_start: 'ChangeStartEvent',
  node_upsert: 'NodeUpsertEvent',
  node_remove: 'NodeRemoveEvent',
  edge_upsert: 'EdgeUpsertEvent',
  edge_remove: 'EdgeRemoveEvent',
  change_complete: 'ChangeCompleteEvent',
  session_end: 'SessionEndEvent',
  story_upsert: 'StoryUpsertEvent',
  annotation_create: 'AnnotationCreateEvent',
  annotation_answer: 'AnnotationAnswerEvent',
  annotation_resolve: 'AnnotationResolveEvent',
  write_access_requested: 'WriteAccessRequestedEvent',
  change_proposal: 'ChangeProposalEvent',
  change_approved: 'ChangeApprovedEvent',
  change_rejected: 'ChangeRejectedEvent',
  change_observed: 'ChangeObservedEvent',
  change_reviewed: 'ChangeReviewedEvent',
};

export interface ToolInputByName {
  readonly get_map: GetMapInput;
  readonly begin_change: BeginChangeInput;
  readonly upsert_node: UpsertNodeInput;
  readonly upsert_edge: UpsertEdgeInput;
  readonly remove_entity: RemoveEntityInput;
  readonly complete_change: CompleteChangeInput;
  readonly upsert_story: UpsertStoryInput;
  readonly answer_annotation: AnswerAnnotationInput;
  readonly request_write_access: RequestWriteAccessInput;
  readonly propose_change: ProposeChangeInput;
  readonly start_approved_change: StartApprovedChangeInput;
}

export type ToolName = keyof ToolInputByName;

const toolDefinitionByName: Record<ToolName, string> = {
  get_map: 'GetMapInput',
  begin_change: 'BeginChangeInput',
  upsert_node: 'UpsertNodeInput',
  upsert_edge: 'UpsertEdgeInput',
  remove_entity: 'RemoveEntityInput',
  complete_change: 'CompleteChangeInput',
  upsert_story: 'UpsertStoryInput',
  answer_annotation: 'AnswerAnnotationInput',
  request_write_access: 'RequestWriteAccessInput',
  propose_change: 'ProposeChangeInput',
  start_approved_change: 'StartApprovedChangeInput',
};

function toProtocolErrors(errors: readonly ErrorObject[] | null | undefined): ProtocolError[] {
  /* v8 ignore next 3 -- Ajv 在 validate 返回 false 时必然填充 errors；此分支只防止 Ajv 行为变化后返回空错误列表。 */
  if (errors == null || errors.length === 0) {
    return [protocolError(errorCodes.SCHEMA_VIOLATION, '数据不符合协议 Schema')];
  }
  return errors.map((error) =>
    protocolError(
      errorCodes.SCHEMA_VIOLATION,
      `${error.instancePath === '' ? '(root)' : error.instancePath} ${error.message ?? '校验失败'}`,
      error.instancePath === '' ? undefined : error.instancePath,
    ),
  );
}

function readEventType(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const candidate: unknown = (input as Record<string, unknown>)['type'];
  return typeof candidate === 'string' ? candidate : undefined;
}

export interface ProtocolValidator {
  /**
   * 校验一条 Agent 事件。
   *
   * 先按 `type` 分派到具体分支再校验，而不是直接跑 oneOf：Agent 需要的是
   * 「哪个字段错了」，oneOf 的九组错误无法直接用于修正。
   */
  validateEvent(input: unknown): Result<GodViewEvent, ProtocolError[]>;
  validateSnapshot(input: unknown): Result<GraphSnapshotDocument, ProtocolError[]>;
  validateAdapterCapabilities(input: unknown): Result<AdapterCapabilities, ProtocolError[]>;
  validateToolResult(input: unknown): Result<ToolResult, ProtocolError[]>;
  validateToolInput<K extends ToolName>(
    name: K,
    input: unknown,
  ): Result<ToolInputByName[K], ProtocolError[]>;
}

class AjvProtocolValidator implements ProtocolValidator {
  readonly #ajv: Ajv2020;

  constructor(schemas: readonly SchemaObject[]) {
    this.#ajv = new Ajv2020({ allErrors: true, strictSchema: true, allowUnionTypes: true });
    addFormats.default(this.#ajv);
    for (const schema of schemas) {
      this.#ajv.addSchema(schema);
    }
  }

  #compiled(schemaId: string, definition: string): ValidateFunction {
    const ref = `${schemaId}#/$defs/${definition}`;
    const validate = this.#ajv.getSchema(ref);
    /* v8 ignore next 4 -- Schema 与代码不同步属于构建期缺陷，由 CI 的 generated-files-check 与协议契约测试拦截，不是运行时可恢复路径。 */
    if (validate === undefined) {
      throw new Error(`协议 Schema 缺少定义：${ref}`);
    }
    return validate;
  }

  validateEvent(input: unknown): Result<GodViewEvent, ProtocolError[]> {
    const type = readEventType(input);
    if (type === undefined) {
      return err([protocolError(errorCodes.SCHEMA_VIOLATION, '事件缺少 type 字段', '/type')]);
    }
    if ((reservedEventTypes as readonly string[]).includes(type)) {
      return err([
        protocolError(
          errorCodes.UNSUPPORTED_EVENT_TYPE,
          `事件类型 ${type} 已在协议中保留，但当前版本尚未实现`,
          '/type',
        ),
      ]);
    }
    const definition = eventDefinitionByType[type as SupportedEventType] as string | undefined;
    if (definition === undefined) {
      return err([protocolError(errorCodes.SCHEMA_VIOLATION, `未知事件类型：${type}`, '/type')]);
    }
    const validate = this.#compiled('events.schema.json', definition);
    if (!validate(input)) {
      return err(toProtocolErrors(validate.errors));
    }
    const version = (input as { version: string }).version;
    if (!isProtocolVersionSupported(version)) {
      return err([
        protocolError(
          errorCodes.UNSUPPORTED_PROTOCOL_VERSION,
          `事件协议版本 ${version} 不受当前实现支持`,
          '/version',
        ),
      ]);
    }
    return ok(input as GodViewEvent);
  }

  validateSnapshot(input: unknown): Result<GraphSnapshotDocument, ProtocolError[]> {
    const validate = this.#compiled('graph.schema.json', 'GraphSnapshotDocument');
    if (!validate(input)) {
      return err(toProtocolErrors(validate.errors));
    }
    const schemaVersion = (input as { schemaVersion: string }).schemaVersion;
    if (!isProtocolVersionSupported(schemaVersion)) {
      return err([
        protocolError(
          errorCodes.UNSUPPORTED_SNAPSHOT_VERSION,
          `快照 Schema 版本 ${schemaVersion} 无法由当前实现读取`,
          '/schemaVersion',
        ),
      ]);
    }
    return ok(input as GraphSnapshotDocument);
  }

  validateAdapterCapabilities(input: unknown): Result<AdapterCapabilities, ProtocolError[]> {
    const validate = this.#compiled('tools.schema.json', 'AdapterCapabilities');
    return validate(input)
      ? ok(input as AdapterCapabilities)
      : err(toProtocolErrors(validate.errors));
  }

  validateToolResult(input: unknown): Result<ToolResult, ProtocolError[]> {
    const validate = this.#compiled('tools.schema.json', 'ToolResult');
    return validate(input) ? ok(input as ToolResult) : err(toProtocolErrors(validate.errors));
  }

  validateToolInput<K extends ToolName>(
    name: K,
    input: unknown,
  ): Result<ToolInputByName[K], ProtocolError[]> {
    const validate = this.#compiled('tools.schema.json', toolDefinitionByName[name]);
    if (!validate(input)) {
      return err(toProtocolErrors(validate.errors));
    }
    return ok(input as ToolInputByName[K]);
  }
}

let sharedValidator: ProtocolValidator | undefined;

/** 编译一次 Ajv 实例的开销较大，进程内复用同一个只读校验器。 */
export function createProtocolValidator(): ProtocolValidator {
  sharedValidator ??= new AjvProtocolValidator(runtimeSchemas);
  return sharedValidator;
}
