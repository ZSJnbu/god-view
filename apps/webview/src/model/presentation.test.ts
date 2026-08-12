import { describe, expect, it } from 'vitest';
import { badgesFor, countCodeEvidence, isFailed, isInProgress } from './presentation.js';
import { makeEdge, makeNode } from './fixtures.test-utils.js';

describe('countCodeEvidence', () => {
  it('不把 Agent 自述算成代码证据', () => {
    const count = countCodeEvidence([
      { kind: 'agent_claim', detail: '我觉得是这样' },
      { kind: 'file_exists', location: { path: 'src/a.ts' } },
      { kind: 'explicit_import', location: { path: 'src/a.ts' } },
    ]);

    expect(count).toBe(2);
  });

  it('没有证据时为 0', () => {
    expect(countCodeEvidence(undefined)).toBe(0);
  });
});

describe('badgesFor', () => {
  it('verified 才算代码可证实', () => {
    const badges = badgesFor(
      makeNode('a', { codeValidation: { status: 'verified', level: 'L0' } }),
    );

    expect(badges.trust).toBe('code-verified');
    expect(badges.level).toBe('L0');
    expect(badges.validationLabel).toBe('代码可证实');
  });

  it('未校验的节点停留在声明层，即使来源是用户', () => {
    const badges = badgesFor(
      makeNode('a', {
        source: {
          kind: 'user_created',
          actor: { kind: 'user' },
          declaredAt: '2026-08-07T10:00:00.000Z',
        },
      }),
    );

    expect(badges.trust).toBe('declared');
    expect(badges.sourceLabel).toBe('用户创建');
  });

  it('漂移与校验失败都标为冲突', () => {
    expect(badgesFor(makeNode('a', { codeValidation: { status: 'drifted' } })).trust).toBe(
      'conflicting',
    );
    expect(badgesFor(makeNode('b', { codeValidation: { status: 'failed' } })).trust).toBe(
      'conflicting',
    );
  });

  it('被用户否决的声明标为冲突', () => {
    const badges = badgesFor(makeNode('a', { userConfirmation: { status: 'rejected' } }));

    expect(badges.trust).toBe('conflicting');
    expect(badges.confirmationLabel).toBe('已否决');
  });

  it('缺省层级按 L2 展示，不冒充代码事实', () => {
    expect(badgesFor(makeNode('a')).level).toBe('L2');
  });

  it('对关系同样适用', () => {
    const badges = badgesFor(
      makeEdge('e1', 'a', 'b', {
        codeValidation: {
          status: 'verified',
          level: 'L1',
          evidence: [{ kind: 'explicit_import', location: { path: 'src/a.ts' } }],
        },
        declaredEvidence: [{ kind: 'agent_claim' }],
      }),
    );

    expect(badges.trust).toBe('code-verified');
    expect(badges.codeEvidenceCount).toBe(1);
  });
});

describe('生命周期', () => {
  it('planned 与 in_progress 都是未完成状态', () => {
    expect(isInProgress(makeNode('a', { lifecycle: { status: 'planned' } }))).toBe(true);
    expect(isInProgress(makeNode('b', { lifecycle: { status: 'in_progress' } }))).toBe(true);
    expect(isInProgress(makeNode('c'))).toBe(false);
  });

  it('failed 单独标记', () => {
    expect(isFailed(makeNode('a', { lifecycle: { status: 'failed' } }))).toBe(true);
    expect(isFailed(makeNode('b'))).toBe(false);
  });
});
