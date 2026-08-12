import type {
  CodeValidationState,
  Evidence,
  GraphEdge,
  GraphNode,
  NodeType,
  Provenance,
} from '@god-view/protocol';

/**
 * 可信度分级。
 *
 * 三条独立的轴不可互相冒充（TECHNICAL_ARCHITECTURE.md §11）：
 * 声明来源（谁说的）、代码校验（能否被文件事实证实）、用户确认（人是否认可）。
 * UI 必须分别呈现，尤其不得把 `agent_claim` 证据渲染成代码事实。
 */
export type TrustTier = 'code-verified' | 'declared' | 'conflicting' | 'unknown';

export interface EntityBadges {
  readonly trust: TrustTier;
  /** 校验层级：L0 文件事实、L1 显式语法、L2 Agent 声明、L3 系统推断。 */
  readonly level: string;
  readonly validationLabel: string;
  readonly sourceLabel: string;
  readonly confirmationLabel: string;
  /** 有真实代码证据支撑的条数，`agent_claim` 不计入。 */
  readonly codeEvidenceCount: number;
}

const validationLabels: Record<CodeValidationState['status'], string> = {
  verified: '代码可证实',
  unverified: '未校验',
  failed: '校验失败',
  unsupported: '不支持校验',
  drifted: '已漂移',
};

const sourceLabels: Record<Provenance['kind'], string> = {
  agent_declared: 'Agent 声明',
  inferred: '系统推断',
  user_created: '用户创建',
};

const confirmationLabels: Record<'unconfirmed' | 'confirmed' | 'rejected', string> = {
  unconfirmed: '未确认',
  confirmed: '已确认',
  rejected: '已否决',
};

export const nodeTypeLabels: Record<NodeType, string> = {
  entry: '入口',
  module: '模块',
  group: '分组',
  file: '文件',
  service: '服务',
  external_system: '外部系统',
  storage: '存储',
  unclassified: '未分类',
};

/**
 * 只有 L0/L1 级别的证据才是代码事实。
 *
 * `agent_claim` 是 Agent 的说法，无论它出现多少次都不提升可信度。
 */
export function countCodeEvidence(evidence: readonly Evidence[] | undefined): number {
  return (evidence ?? []).filter((item) => item.kind !== 'agent_claim').length;
}

export function badgesFor(entity: GraphNode | GraphEdge): EntityBadges {
  const validation = entity.codeValidation;
  const codeEvidenceCount =
    countCodeEvidence(validation.evidence) + countCodeEvidence(entity.declaredEvidence);
  return {
    trust: trustTierFor(entity),
    level: validation.level ?? 'L2',
    validationLabel: validationLabels[validation.status],
    sourceLabel: sourceLabels[entity.source.kind],
    confirmationLabel: confirmationLabels[entity.userConfirmation.status],
    codeEvidenceCount,
  };
}

function trustTierFor(entity: GraphNode | GraphEdge): TrustTier {
  switch (entity.codeValidation.status) {
    case 'verified':
      return 'code-verified';
    case 'failed':
    case 'drifted':
      return 'conflicting';
    case 'unverified':
    case 'unsupported':
      // 未被代码证实的内容一律停留在「声明」，不因为来源是用户或系统而升级。
      return entity.userConfirmation.status === 'rejected' ? 'conflicting' : 'declared';
    default:
      return 'unknown';
  }
}

/** 生命周期为 in_progress 的实体是进行中的变更预览，不是已完成状态。 */
export function isInProgress(entity: GraphNode | GraphEdge): boolean {
  return entity.lifecycle.status === 'in_progress' || entity.lifecycle.status === 'planned';
}

export function isFailed(entity: GraphNode | GraphEdge): boolean {
  return entity.lifecycle.status === 'failed';
}
