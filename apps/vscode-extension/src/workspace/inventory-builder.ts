import type { InventoryKind, RepositoryInventory } from '@god-view/graph-core';
import type { WorkspacePath } from '@god-view/protocol';
import { decideExclusion } from './exclusions.js';
import type { GitAdapter } from './git-adapter.js';

const sourceExtensions = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.m',
  '.mm',
  '.scala',
  '.ex',
  '.exs',
  '.vue',
  '.svelte',
  '.sql',
  '.sh',
];

const configExtensions = [
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.lock',
  '.gradle',
  '.properties',
];

/**
 * 按用途分类，而不是按语言。
 *
 * 概览图把普通配置与资源聚合为分组展示，不逐文件展开（PRD §7.1.11）。
 */
export function classify(path: string): InventoryKind {
  const lower = path.toLowerCase();
  if (sourceExtensions.some((extension) => lower.endsWith(extension))) {
    return 'source';
  }
  if (configExtensions.some((extension) => lower.endsWith(extension))) {
    return 'config';
  }
  return 'asset';
}

export interface InventoryOptions {
  readonly extraExcludes: readonly string[];
}

/**
 * 只读仓库清单。
 *
 * 这份清单是覆盖率的**分母**，不能由 Agent 自报节点数量代替
 * （PRD §9、CODE_QUALITY_STANDARD.md §5.2）。
 */
export class InventoryBuilder {
  readonly #git: GitAdapter;
  readonly #options: InventoryOptions;

  constructor(git: GitAdapter, options: InventoryOptions) {
    this.#git = git;
    this.#options = options;
  }

  /**
   * 优先使用 `git ls-files --cached --others --exclude-standard`。
   *
   * 直接复用 Git 的忽略规则，避免 God View 自行实现一份与 `.gitignore`
   * 不一致的匹配逻辑；无 Git 时由调用方提供文件清单。
   */
  async build(fallbackFiles?: readonly string[]): Promise<RepositoryInventory> {
    const files = (await this.#git.listFirstPartyFiles()) ?? fallbackFiles ?? [];
    const included: { path: WorkspacePath; kind: InventoryKind }[] = [];
    const excluded: { path: WorkspacePath; reason: string }[] = [];

    for (const file of files) {
      const decision = decideExclusion(file, this.#options.extraExcludes);
      if (decision.excluded) {
        excluded.push({ path: file, reason: decision.reason ?? '已排除' });
      } else {
        included.push({ path: file, kind: classify(file) });
      }
    }

    return {
      included: included.sort((left, right) => (left.path < right.path ? -1 : 1)),
      excluded: excluded.sort((left, right) => (left.path < right.path ? -1 : 1)),
      failed: [],
    };
  }
}
