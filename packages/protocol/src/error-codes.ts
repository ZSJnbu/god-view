/**
 * 稳定错误码。
 *
 * 错误码属于协议兼容面：新增属于 minor 兼容变更，删除或改变语义属于 major 变更
 * （见 TECHNICAL_ARCHITECTURE.md §6.2、CODING_STANDARDS.md §7.2）。
 */
export const errorCodes = {
  /** 入站数据不符合 JSON Schema。 */
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  /** 协议 major 版本不受支持。 */
  UNSUPPORTED_PROTOCOL_VERSION: 'UNSUPPORTED_PROTOCOL_VERSION',
  /** 事件类型已在协议中保留，但当前实现尚未支持。 */
  UNSUPPORTED_EVENT_TYPE: 'UNSUPPORTED_EVENT_TYPE',
  /** 事件基于过期的地图版本。 */
  STALE_MAP_REVISION: 'STALE_MAP_REVISION',
  /** 引用了地图中不存在的节点或边。 */
  UNKNOWN_ENTITY: 'UNKNOWN_ENTITY',
  /** 关系两端必须先存在。 */
  DANGLING_EDGE_ENDPOINT: 'DANGLING_EDGE_ENDPOINT',
  /** 引用了不存在或已结束的 ChangeSet。 */
  UNKNOWN_CHANGE_SET: 'UNKNOWN_CHANGE_SET',
  /** 同一 workspace 同时只允许一个可写 ChangeSet。 */
  CONCURRENT_CHANGE_SET: 'CONCURRENT_CHANGE_SET',
  /** 事件属于其它 workspace 或分支。 */
  WORKSPACE_MISMATCH: 'WORKSPACE_MISMATCH',
  /** 路径超出工作区，或包含 .. 穿越、符号链接逃逸。 */
  PATH_OUT_OF_SCOPE: 'PATH_OUT_OF_SCOPE',
  /** Agent 写入超出批准作用域。 */
  SCOPE_VIOLATION: 'SCOPE_VIOLATION',
  /** 批准前发生写入。 */
  UNEXPECTED_WRITE: 'UNEXPECTED_WRITE',
  /** 已确认的稳定实体不能被改名事件删除重建。 */
  STABLE_ID_VIOLATION: 'STABLE_ID_VIOLATION',
  /** 事件日志或快照损坏。 */
  CORRUPT_RECORD: 'CORRUPT_RECORD',
  /** 快照 schema 版本无法迁移到当前版本。 */
  UNSUPPORTED_SNAPSHOT_VERSION: 'UNSUPPORTED_SNAPSHOT_VERSION',
  /** 当前 Adapter 或 Validator 明确不支持该能力。 */
  UNSUPPORTED: 'UNSUPPORTED',
  /** 用户或系统取消。取消不是错误级别日志。 */
  CANCELLED: 'CANCELLED',
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];

export interface ProtocolError {
  readonly code: ErrorCode;
  readonly message: string;
  /** 出错字段的 JSON Pointer，便于 Agent 精确修正。 */
  readonly path?: string;
}

export function protocolError(code: ErrorCode, message: string, path?: string): ProtocolError {
  return path === undefined ? { code, message } : { code, message, path };
}
