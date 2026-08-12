/**
 * `@god-view/validation-core` 的唯一公开入口。
 *
 * 回答一个问题：**Agent 声明与代码证据是否一致。**
 * 本包只定义端口与组合逻辑；具体语言实现独立成包。
 */
export type {
  ValidationOutcome,
  ValidationTarget,
  Validator,
  ValidatorContext,
  WorkspaceProbe,
} from './ports.js';

export { FileFactValidator, fileFactValidatorId } from './file-fact-validator.js';
export { ExplicitImportValidator, explicitImportValidatorId } from './explicit-import-validator.js';

export { aggregateOutcomes, detectDrift } from './aggregate.js';
export type { DriftInput } from './aggregate.js';
