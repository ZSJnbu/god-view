import { describe, expect, it } from 'vitest';
import { errorCodes } from '@god-view/protocol';
import { FileFactValidator } from './file-fact-validator.js';
import { aggregateOutcomes, detectDrift } from './aggregate.js';
import type { ValidationOutcome, ValidationTarget, WorkspaceProbe } from './ports.js';

const checkedAt = '2026-08-07T10:00:00.000Z';

function probeWith(existing: readonly string[]): WorkspaceProbe {
  return {
    exists: (path) => Promise.resolve(existing.includes(path)),
    readText: () => Promise.resolve(undefined),
    listFirstPartyFiles: () => Promise.resolve(existing),
  };
}

function target(overrides: Partial<ValidationTarget> = {}): ValidationTarget {
  return {
    kind: 'node',
    id: 'module.orders',
    paths: ['src/orders/index.ts'],
    locations: [],
    ...overrides,
  };
}

describe('L0 文件事实校验', () => {
  it('全部路径存在时标记为 verified 并附带文件证据', async () => {
    const validator = new FileFactValidator(probeWith(['src/orders/index.ts']));
    const result = await validator.validate(target(), { checkedAt });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('verified');
      expect(result.value.level).toBe('L0');
      expect(result.value.evidence).toEqual([
        { kind: 'file_exists', location: { path: 'src/orders/index.ts' } },
      ]);
    }
  });

  it('路径缺失时标记为 drifted，并保留已验证部分的证据', async () => {
    const validator = new FileFactValidator(probeWith(['src/orders/index.ts']));
    const result = await validator.validate(
      target({ paths: ['src/orders/index.ts', 'src/orders/deleted.ts'] }),
      { checkedAt },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('drifted');
      expect(result.value.evidence).toHaveLength(1);
      expect(result.value.detail).toContain('src/orders/deleted.ts');
    }
  });

  it('没有路径声明的分组节点返回 unsupported，不伪装成验证通过', async () => {
    const validator = new FileFactValidator(probeWith([]));
    const result = await validator.validate(target({ paths: [], locations: [] }), { checkedAt });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('unsupported');
    }
  });

  it('代码位置中的路径同样参与校验', async () => {
    const validator = new FileFactValidator(probeWith([]));
    const result = await validator.validate(
      target({ paths: [], locations: [{ path: 'src/orders/index.ts', startLine: 1 }] }),
      { checkedAt },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('drifted');
    }
  });

  it('取消不是错误结果，而是明确的 CANCELLED', async () => {
    const controller = new AbortController();
    controller.abort();
    const validator = new FileFactValidator(probeWith(['src/orders/index.ts']));
    const result = await validator.validate(target(), { checkedAt, signal: controller.signal });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(errorCodes.CANCELLED);
    }
  });

  it('supports 反映是否具备可校验的路径证据', () => {
    const validator = new FileFactValidator(probeWith([]));
    expect(validator.supports(target())).toBe(true);
    expect(validator.supports(target({ paths: [], locations: [] }))).toBe(false);
  });
});

describe('结论聚合', () => {
  function outcome(overrides: Partial<ValidationOutcome>): ValidationOutcome {
    return {
      targetId: 'module.orders',
      status: 'verified',
      level: 'L0',
      validator: 'god-view.file-fact',
      evidence: [],
      checkedAt,
      ...overrides,
    };
  }

  it('没有任何结论时返回 undefined，而不是编造 unverified', () => {
    expect(aggregateOutcomes([])).toBeUndefined();
  });

  it('漂移结论优先于通过结论，避免掩盖不一致', () => {
    const state = aggregateOutcomes([
      outcome({ status: 'verified' }),
      outcome({ status: 'drifted', validator: 'ts', level: 'L1', detail: 'import 已不存在' }),
    ]);
    expect(state?.status).toBe('drifted');
  });

  it('失败结论优先于漂移', () => {
    const state = aggregateOutcomes([
      outcome({ status: 'drifted' }),
      outcome({ status: 'failed', detail: '解析失败' }),
    ]);
    expect(state?.status).toBe('failed');
  });

  it('同为通过时采用更高等级的证据来源', () => {
    const state = aggregateOutcomes([
      outcome({ status: 'verified', level: 'L0', validator: 'god-view.file-fact' }),
      outcome({ status: 'verified', level: 'L1', validator: 'god-view.typescript' }),
    ]);
    expect(state?.level).toBe('L1');
    expect(state?.validator).toBe('god-view.typescript');
  });

  it('合并全部证据并拼接说明', () => {
    const state = aggregateOutcomes([
      outcome({
        status: 'verified',
        evidence: [{ kind: 'file_exists', location: { path: 'a.ts' } }],
        detail: '路径存在',
      }),
      outcome({
        status: 'verified',
        level: 'L1',
        evidence: [{ kind: 'explicit_import', location: { path: 'a.ts', startLine: 3 } }],
        detail: '显式 import 成立',
      }),
    ]);
    expect(state?.evidence).toHaveLength(2);
    expect(state?.detail).toBe('显式 import 成立；路径存在');
  });

  it('全部不支持时保持 unsupported', () => {
    expect(aggregateOutcomes([outcome({ status: 'unsupported' })])?.status).toBe('unsupported');
  });
});

describe('漂移检测', () => {
  it('声明的文件不存在时报告缺失', () => {
    const findings = detectDrift({
      outcomes: [
        {
          targetId: 'module.orders',
          status: 'drifted',
          level: 'L0',
          validator: 'god-view.file-fact',
          evidence: [],
          checkedAt,
          detail: 'src/orders/deleted.ts 不存在',
        },
      ],
      declaredPaths: ['src/orders'],
      firstPartyFiles: [],
    });

    expect(findings).toEqual([
      {
        kind: 'missing_file',
        targetId: 'module.orders',
        detail: 'src/orders/deleted.ts 不存在',
      },
    ]);
  });

  it('仓库中未归属的第一方文件被报告为未分类', () => {
    const findings = detectDrift({
      outcomes: [],
      declaredPaths: ['src/orders'],
      firstPartyFiles: ['src/orders/index.ts', 'src/new-feature/index.ts'],
    });

    expect(findings).toEqual([
      {
        kind: 'unclassified_file',
        path: 'src/new-feature/index.ts',
        detail: '第一方文件尚未归属任何模块或分组',
      },
    ]);
  });

  it('目录前缀不会误覆盖兄弟目录', () => {
    const findings = detectDrift({
      outcomes: [],
      declaredPaths: ['src/orders'],
      firstPartyFiles: ['src/orders-legacy/index.ts'],
    });
    expect(findings).toHaveLength(1);
  });

  it('归一化 ./ 与反斜杠后仍视为已覆盖', () => {
    const findings = detectDrift({
      outcomes: [],
      declaredPaths: ['./src/orders/'],
      firstPartyFiles: ['src\\orders\\index.ts'],
    });
    expect(findings).toEqual([]);
  });

  it('没有缺失也没有未分类时不报告漂移', () => {
    expect(
      detectDrift({ outcomes: [], declaredPaths: ['src'], firstPartyFiles: ['src/a.ts'] }),
    ).toEqual([]);
  });

  it('缺少说明时给出默认原因，不留空', () => {
    const findings = detectDrift({
      outcomes: [
        {
          targetId: 'edge-1',
          status: 'failed',
          level: 'L1',
          validator: 'god-view.typescript',
          evidence: [],
          checkedAt,
        },
      ],
      declaredPaths: [],
      firstPartyFiles: [],
    });
    expect(findings[0]?.detail).toBe('声明与代码事实不一致');
  });
});
