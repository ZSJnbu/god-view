import { describe, expect, it } from 'vitest';
import {
  noGitBranchKey,
  parseBranchKey,
  parseChangeSetId,
  parseEdgeId,
  parseEventId,
  parseNodeId,
  parseSessionId,
  parseWorkspaceId,
} from './ids.js';
import { errorCodes } from './error-codes.js';

const parsers = [
  ['NodeId', parseNodeId],
  ['EdgeId', parseEdgeId],
  ['SessionId', parseSessionId],
  ['EventId', parseEventId],
  ['ChangeSetId', parseChangeSetId],
  ['WorkspaceId', parseWorkspaceId],
  ['BranchKey', parseBranchKey],
] as const;

describe('实体 ID 解析', () => {
  it.each(parsers)('%s 接受合法标识符', (_kind, parse) => {
    const result = parse('module.orders/v2');
    expect(result.ok).toBe(true);
  });

  it.each(parsers)('%s 拒绝空字符串', (_kind, parse) => {
    expect(parse('').ok).toBe(false);
  });

  it.each(parsers)('%s 拒绝超长标识符', (_kind, parse) => {
    expect(parse('a'.repeat(201)).ok).toBe(false);
  });

  it.each([' leading-space', 'has space', '.starts-with-dot', 'emoji✅', 'back\\slash'])(
    '拒绝非法字符：%s',
    (value) => {
      const result = parseNodeId(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(errorCodes.SCHEMA_VIOLATION);
      }
    },
  );

  it('长度恰好 200 时接受', () => {
    expect(parseNodeId('a'.repeat(200)).ok).toBe(true);
  });

  it('无 Git 工作区使用固定 branch key', () => {
    expect(noGitBranchKey).toBe('no-git');
    expect(parseBranchKey(noGitBranchKey).ok).toBe(true);
  });
});
