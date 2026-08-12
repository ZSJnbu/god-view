import {
  err,
  errorCodes,
  ok,
  protocolError,
  type Evidence,
  type Identifier,
  type ProtocolError,
  type Result,
} from '@god-view/protocol';
import type {
  ValidationOutcome,
  ValidationTarget,
  Validator,
  ValidatorContext,
  WorkspaceProbe,
} from './ports.js';

export const fileFactValidatorId = 'god-view.file-fact' as Identifier;

/**
 * L0 文件事实校验器。
 *
 * 只回答「声明引用的文件是否存在」，不解释业务语义：`verified` 仅表示路径证据成立，
 * 不表示模块职责描述正确（PRD §2.3）。
 */
export class FileFactValidator implements Validator {
  readonly id = fileFactValidatorId;
  readonly level = 'L0' as const;
  readonly #probe: WorkspaceProbe;

  constructor(probe: WorkspaceProbe) {
    this.#probe = probe;
  }

  supports(target: ValidationTarget): boolean {
    return target.paths.length > 0 || target.locations.length > 0;
  }

  async validate(
    target: ValidationTarget,
    context: ValidatorContext,
  ): Promise<Result<ValidationOutcome, ProtocolError>> {
    if (!this.supports(target)) {
      // 没有任何路径声明的节点（例如纯分组）无法用文件事实验证，
      // 必须明确返回 unsupported，而不是伪装成验证通过。
      return ok(this.#outcome(target, 'unsupported', [], context, '实体未声明任何代码路径'));
    }

    const declaredPaths = [...new Set([...target.paths, ...target.locations.map((l) => l.path)])];
    const evidence: Evidence[] = [];
    const missing: string[] = [];

    for (const path of declaredPaths) {
      if (context.signal?.aborted === true) {
        return err(protocolError(errorCodes.CANCELLED, '文件事实校验已取消'));
      }
      // 顺序探测便于及时响应取消；跨实体的并发上限由调用方控制。
      const exists = await this.#probe.exists(path);
      if (exists) {
        evidence.push({ kind: 'file_exists', location: { path } });
      } else {
        missing.push(path);
      }
    }

    if (missing.length === 0) {
      return ok(this.#outcome(target, 'verified', evidence, context));
    }
    return ok(
      this.#outcome(
        target,
        'drifted',
        evidence,
        context,
        `声明引用的 ${String(missing.length)} 个路径不存在：${missing.slice(0, 5).join(', ')}`,
      ),
    );
  }

  #outcome(
    target: ValidationTarget,
    status: ValidationOutcome['status'],
    evidence: readonly Evidence[],
    context: ValidatorContext,
    detail?: string,
  ): ValidationOutcome {
    return {
      targetId: target.id,
      status,
      level: this.level,
      validator: this.id,
      evidence,
      checkedAt: context.checkedAt,
      ...(detail === undefined ? {} : { detail }),
    };
  }
}
