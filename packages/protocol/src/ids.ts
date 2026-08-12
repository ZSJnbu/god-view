import type { Identifier } from './generated/protocol-types.js';
import { err, ok, type Result } from './result.js';
import { errorCodes, protocolError, type ProtocolError } from './error-codes.js';

/**
 * 实体 ID 使用 branded type，避免 NodeId、EdgeId、SessionId 在函数签名中互相混用
 * （CODING_STANDARDS.md §4.1）。
 */
declare const brand: unique symbol;

type Branded<TBrand extends string> = Identifier & { readonly [brand]: TBrand };

export type NodeId = Branded<'NodeId'>;
export type EdgeId = Branded<'EdgeId'>;
export type SessionId = Branded<'SessionId'>;
export type EventId = Branded<'EventId'>;
export type ChangeSetId = Branded<'ChangeSetId'>;
export type WorkspaceId = Branded<'WorkspaceId'>;
export type BranchKey = Branded<'BranchKey'>;

/** 与 common.schema.json#/$defs/Identifier 保持一致。修改任一处都必须同步另一处的测试。 */
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const maxIdentifierLength = 200;

function parseIdentifier<T extends Identifier>(
  value: string,
  kind: string,
): Result<T, ProtocolError> {
  if (value.length === 0 || value.length > maxIdentifierLength) {
    return err(
      protocolError(
        errorCodes.SCHEMA_VIOLATION,
        `${kind} 长度必须在 1..${String(maxIdentifierLength)} 之间`,
      ),
    );
  }
  if (!identifierPattern.test(value)) {
    return err(protocolError(errorCodes.SCHEMA_VIOLATION, `${kind} 含有不允许的字符：${value}`));
  }
  return ok(value as T);
}

export const parseNodeId = (value: string): Result<NodeId, ProtocolError> =>
  parseIdentifier<NodeId>(value, 'NodeId');
export const parseEdgeId = (value: string): Result<EdgeId, ProtocolError> =>
  parseIdentifier<EdgeId>(value, 'EdgeId');
export const parseSessionId = (value: string): Result<SessionId, ProtocolError> =>
  parseIdentifier<SessionId>(value, 'SessionId');
export const parseEventId = (value: string): Result<EventId, ProtocolError> =>
  parseIdentifier<EventId>(value, 'EventId');
export const parseChangeSetId = (value: string): Result<ChangeSetId, ProtocolError> =>
  parseIdentifier<ChangeSetId>(value, 'ChangeSetId');
export const parseWorkspaceId = (value: string): Result<WorkspaceId, ProtocolError> =>
  parseIdentifier<WorkspaceId>(value, 'WorkspaceId');
export const parseBranchKey = (value: string): Result<BranchKey, ProtocolError> =>
  parseIdentifier<BranchKey>(value, 'BranchKey');

/**
 * 无 Git 工作区使用的固定 branch key。
 * 该分支只开放建图、浏览和解释，不得获得写权限（TECHNICAL_ARCHITECTURE.md §8.4）。
 */
export const noGitBranchKey = 'no-git' as BranchKey;
