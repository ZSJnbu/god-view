import type { ErrorCode, Identifier } from '@god-view/protocol';

/**
 * 领域错误：输入合法但违反了图状态的不变量。
 *
 * 与 ValidationError（不符合 Schema）和 InfrastructureError（文件/进程失败）分开，
 * 便于 UI 与 Agent 分别处理（CODING_STANDARDS.md §7.1）。
 */
export interface DomainError {
  readonly code: ErrorCode;
  readonly message: string;
  /** 出错实体的 ID，便于 UI 定位与 Agent 修正。 */
  readonly entityId?: Identifier;
}

export function domainError(code: ErrorCode, message: string, entityId?: Identifier): DomainError {
  return entityId === undefined ? { code, message } : { code, message, entityId };
}
