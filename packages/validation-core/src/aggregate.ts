import type {
  CodeValidationState,
  CodeValidationStatus,
  DriftFinding,
  Evidence,
  ValidationLevel,
  WorkspacePath,
} from '@god-view/protocol';
import type { ValidationOutcome } from './ports.js';

/** 等级越高证据越强：L1 显式语法优于 L0 文件存在。 */
const levelRank: Record<ValidationLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

/**
 * 状态优先级：负面结论优先。
 *
 * 一个 Validator 报告漂移、另一个报告通过时必须显示漂移，
 * 否则会把「地图与代码不一致」掩盖成已验证。
 */
const statusPriority: Record<CodeValidationStatus, number> = {
  failed: 0,
  drifted: 1,
  verified: 2,
  unsupported: 3,
  unverified: 4,
};

/**
 * 合并同一实体的多个校验结论。
 *
 * L2（Agent 声明）与 L3（系统推断）不会在这里被转换成 L0/L1 事实：
 * 本函数只接收 Validator 产出的结论，UI 另行展示声明来源。
 */
export function aggregateOutcomes(
  outcomes: readonly ValidationOutcome[],
): CodeValidationState | undefined {
  if (outcomes.length === 0) {
    return undefined;
  }
  const sorted = [...outcomes].sort(
    (left, right) =>
      statusPriority[left.status] - statusPriority[right.status] ||
      levelRank[right.level] - levelRank[left.level],
  );
  const primary = sorted[0];
  if (primary === undefined) {
    return undefined;
  }
  const evidence: Evidence[] = sorted.flatMap((outcome) => [...outcome.evidence]);
  const details = sorted
    .map((outcome) => outcome.detail)
    .filter((detail): detail is string => detail !== undefined);

  return {
    status: primary.status,
    level: primary.level,
    validator: primary.validator,
    checkedAt: primary.checkedAt,
    ...(evidence.length === 0 ? {} : { evidence }),
    ...(details.length === 0 ? {} : { detail: details.join('；').slice(0, 500) }),
  };
}

function normalize(path: string): string {
  return path.replace(/^\.\//u, '').replace(/\\/gu, '/');
}

function isCovered(declaredPaths: readonly string[], filePath: string): boolean {
  const file = normalize(filePath);
  return declaredPaths.some((declared) => {
    const base = normalize(declared).replace(/\/$/u, '');
    return file === base || file.startsWith(`${base}/`);
  });
}

export interface DriftInput {
  readonly outcomes: readonly ValidationOutcome[];
  /** 当前地图中所有仍然有效的路径声明。 */
  readonly declaredPaths: readonly WorkspacePath[];
  /** 纳入范围的第一方文件清单。 */
  readonly firstPartyFiles: readonly WorkspacePath[];
}

/**
 * 发现地图与仓库之间的漂移。
 *
 * 两个方向都要检查：地图声明的文件不存在（Agent 漏报删除），
 * 以及仓库中存在但没有任何节点归属的第一方文件（Agent 漏报新增）。
 */
export function detectDrift(input: DriftInput): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const outcome of input.outcomes) {
    if (outcome.status === 'drifted' || outcome.status === 'failed') {
      findings.push({
        kind: outcome.driftKind ?? 'missing_file',
        targetId: outcome.targetId,
        detail: outcome.detail ?? '声明与代码事实不一致',
      });
    }
  }

  for (const file of input.firstPartyFiles) {
    if (!isCovered(input.declaredPaths, file)) {
      findings.push({
        kind: 'unclassified_file',
        path: file,
        detail: '第一方文件尚未归属任何模块或分组',
      });
    }
  }

  return findings;
}
