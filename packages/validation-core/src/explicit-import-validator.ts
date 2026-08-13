import {
  ok,
  type Evidence,
  type Identifier,
  type ProtocolError,
  type Result,
  type WorkspacePath,
} from '@god-view/protocol';
import type {
  ValidationOutcome,
  ValidationTarget,
  Validator,
  ValidatorContext,
  WorkspaceProbe,
} from './ports.js';

export const explicitImportValidatorId = 'god-view.typescript-import' as Identifier;
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/iu;
const importPattern =
  /(?:\bimport\s+(?:[^'"()]*?\s+from\s+)?|\bexport\s+[^'"()]*?\s+from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/gu;

/** TypeScript/JavaScript 相对显式 import 校验；不推断别名、运行时调用或业务语义。 */
export class ExplicitImportValidator implements Validator {
  readonly id = explicitImportValidatorId;
  readonly level = 'L1' as const;
  readonly #probe: WorkspaceProbe;

  constructor(probe: WorkspaceProbe) {
    this.#probe = probe;
  }

  supports(target: ValidationTarget): boolean {
    return (
      target.kind === 'edge' &&
      (target.declaredEvidence ?? []).some((evidence) => evidence.kind === 'explicit_import') &&
      (target.sourcePaths ?? []).some((path) => sourceExtension.test(path)) &&
      (target.targetPaths?.length ?? 0) > 0
    );
  }

  async validate(
    target: ValidationTarget,
    context: ValidatorContext,
  ): Promise<Result<ValidationOutcome, ProtocolError>> {
    if (!this.supports(target)) return ok(this.#outcome(target, 'unsupported', [], context));
    let readSupportedSource = false;
    for (const sourcePath of target.sourcePaths ?? []) {
      if (!sourceExtension.test(sourcePath)) continue;
      const text = await this.#probe.readText(sourcePath);
      if (text === undefined) continue;
      readSupportedSource = true;
      for (const found of imports(text)) {
        const resolved = resolveWorkspaceImport(sourcePath, found.specifier);
        if (resolved === undefined) continue;
        if ((target.targetPaths ?? []).some((path) => matchesTarget(resolved, path))) {
          return ok(
            this.#outcome(
              target,
              'verified',
              [
                {
                  kind: 'explicit_import',
                  location: { path: sourcePath, startLine: found.line },
                  detail: `${found.specifier} → ${resolved}`,
                },
              ],
              context,
            ),
          );
        }
      }
    }
    return ok(
      readSupportedSource
        ? this.#outcome(
            target,
            'drifted',
            [],
            context,
            '声明了 explicit_import，但源文件中没有找到指向目标节点路径的相对 import/export/require',
            'conflicting_declaration',
          )
        : this.#outcome(
            target,
            'unsupported',
            [],
            context,
            '相关 TypeScript/JavaScript 源文件不可读',
          ),
    );
  }

  #outcome(
    target: ValidationTarget,
    status: ValidationOutcome['status'],
    evidence: readonly Evidence[],
    context: ValidatorContext,
    detail?: string,
    driftKind?: ValidationOutcome['driftKind'],
  ): ValidationOutcome {
    return {
      targetId: target.id,
      status,
      level: this.level,
      validator: this.id,
      evidence,
      checkedAt: context.checkedAt,
      ...(detail === undefined ? {} : { detail }),
      ...(driftKind === undefined ? {} : { driftKind }),
    };
  }
}

function imports(text: string): readonly { specifier: string; line: number }[] {
  return [...text.matchAll(importPattern)].flatMap((match) => {
    const specifier = match[1];
    if (specifier === undefined) return [];
    return [{ specifier, line: text.slice(0, match.index).split('\n').length }];
  });
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/gu, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveRelative(sourcePath: WorkspacePath, specifier: string): WorkspacePath {
  const directory = normalize(sourcePath).split('/').slice(0, -1).join('/');
  return normalize(`${directory}/${specifier}`);
}

/**
 * 解析仓库内 import。除相对路径外，支持 TanStack/Vite 项目常见的 `@/` → `src/`
 * 映射；其他包名仍保持 unsupported，不把第三方依赖误判为项目节点关系。
 */
function resolveWorkspaceImport(
  sourcePath: WorkspacePath,
  specifier: string,
): WorkspacePath | undefined {
  if (specifier.startsWith('.')) return resolveRelative(sourcePath, specifier);
  if (specifier.startsWith('@/')) return normalize(`src/${specifier.slice(2)}`);
  return undefined;
}

function withoutExtension(path: string): string {
  return normalize(path)
    .replace(sourceExtension, '')
    .replace(/\/index$/u, '');
}

function matchesTarget(resolved: string, target: WorkspacePath): boolean {
  const targetBase = withoutExtension(target);
  const resolvedBase = withoutExtension(resolved);
  return (
    targetBase === resolvedBase ||
    targetBase.startsWith(`${resolvedBase}/`) ||
    resolvedBase.startsWith(`${targetBase}/`)
  );
}
