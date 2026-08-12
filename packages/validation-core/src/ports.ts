import type {
  CodeLocation,
  CodeValidationStatus,
  Evidence,
  Identifier,
  ProtocolError,
  Result,
  Timestamp,
  ValidationLevel,
  WorkspacePath,
} from '@god-view/protocol';

/** 待校验的地图实体。Validator 只读取声明，不修改图状态。 */
export interface ValidationTarget {
  readonly kind: 'node' | 'edge';
  readonly id: Identifier;
  readonly paths: readonly WorkspacePath[];
  readonly locations: readonly CodeLocation[];
  readonly sourcePaths?: readonly WorkspacePath[];
  readonly targetPaths?: readonly WorkspacePath[];
  readonly declaredEvidence?: readonly Evidence[];
}

export interface ValidationOutcome {
  readonly targetId: Identifier;
  readonly status: CodeValidationStatus;
  readonly level: ValidationLevel;
  readonly validator: Identifier;
  readonly evidence: readonly Evidence[];
  readonly checkedAt: Timestamp;
  readonly detail?: string;
  readonly driftKind?: 'missing_file' | 'conflicting_declaration';
}

export interface ValidatorContext {
  readonly checkedAt: Timestamp;
  /** 长任务必须接受取消信号并定期检查（CODING_STANDARDS.md §8）。 */
  readonly signal?: AbortSignal;
}

/**
 * 语言/事实校验器端口。
 *
 * 不支持的语法必须返回 `unsupported`，不得返回空的「验证成功」
 * （TECHNICAL_ARCHITECTURE.md §11.2）。
 */
export interface Validator {
  readonly id: Identifier;
  readonly level: ValidationLevel;
  supports(target: ValidationTarget): boolean;
  validate(
    target: ValidationTarget,
    context: ValidatorContext,
  ): Promise<Result<ValidationOutcome, ProtocolError>>;
}

/**
 * 工作区只读探针。
 *
 * 把文件系统访问收敛到一个端口，使校验逻辑可以用内存实现测试，
 * 也让领域包不直接依赖 node:fs。
 */
export interface WorkspaceProbe {
  exists(path: WorkspacePath): Promise<boolean>;
  /** 只读源码；无法读取、不是文件或超过实现限制时返回 undefined。 */
  readText(path: WorkspacePath): Promise<string | undefined>;
  /** 列出纳入范围的第一方文件，用于发现未声明的新文件。 */
  listFirstPartyFiles(): Promise<readonly WorkspacePath[]>;
}
