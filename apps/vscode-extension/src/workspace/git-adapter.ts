import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { ChangeDiffSummary, DiffFile, WorkspacePath } from '@god-view/protocol';
import { noGitBranchKey, type BranchKey } from '@god-view/protocol';

const run = promisify(execFile);

export interface GitState {
  readonly branchKey: BranchKey;
  readonly headRevision?: string;
  /** 无 Git 工作区只开放建图、浏览与解释，不得获得写权限。 */
  readonly hasGit: boolean;
  /** 任务开始前工作区已有的改动，不得归因给 Agent。 */
  readonly preexistingChanges: readonly string[];
}

/**
 * 只读 Git 适配器。
 *
 * 使用参数数组调用 git，不做 shell 字符串拼接（CODING_STANDARDS.md §15）。
 * God View MVP 不执行 add、commit、push，也不自动回滚。
 */
export class GitAdapter {
  readonly #cwd: string;

  constructor(workspaceRoot: string) {
    this.#cwd = workspaceRoot;
  }

  async read(): Promise<GitState> {
    const branch = await this.#git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === undefined) {
      return { branchKey: noGitBranchKey, hasGit: false, preexistingChanges: [] };
    }
    const head = await this.#git(['rev-parse', 'HEAD']);
    const status = await this.#git(['status', '--porcelain']);
    return {
      branchKey: (branch === '' ? 'detached' : branch) as BranchKey,
      ...(head === undefined || head === '' ? {} : { headRevision: head }),
      hasGit: true,
      preexistingChanges: parseStatus(status ?? ''),
    };
  }

  /**
   * 列出第一方文件：已跟踪 + 未跟踪且未被忽略，再减去已删除的。
   *
   * 直接使用 git 的忽略规则，避免 God View 自行实现一份与 `.gitignore`
   * 不一致的匹配逻辑。
   *
   * `--cached` 反映的是索引，删除文件后它仍会列出该路径，直到删除被 `git add`。
   * 这会让覆盖率的**分母**包含磁盘上并不存在的文件——分母虚高，覆盖率虚低，
   * 而且用户在仓库里根本找不到那个文件。因此这里显式减去 `--deleted`。
   */
  async listFirstPartyFiles(): Promise<readonly string[] | undefined> {
    const output = await this.#git(['ls-files', '--cached', '--others', '--exclude-standard']);
    if (output === undefined) {
      return undefined;
    }
    const deleted = new Set(splitLines((await this.#git(['ls-files', '--deleted'])) ?? ''));
    return splitLines(output).filter((path) => !deleted.has(path));
  }

  /**
   * 读取 HEAD 到当前工作树的元数据摘要。只保存路径、状态、行数与哈希，不复制源码正文。
   */
  async diffSummary(input: {
    readonly approvedScope: readonly WorkspacePath[];
    readonly preexistingChanges: readonly WorkspacePath[];
    readonly computedAt: string;
  }): Promise<ChangeDiffSummary | undefined> {
    const [nameStatus, numstat, untracked] = await Promise.all([
      this.#git(['diff', '--name-status', 'HEAD', '--']),
      this.#git(['diff', '--numstat', 'HEAD', '--']),
      this.#git(['ls-files', '--others', '--exclude-standard']),
    ]);
    if (nameStatus === undefined || numstat === undefined || untracked === undefined)
      return undefined;
    const counts = parseNumstat(numstat);
    const changed = [
      ...parseNameStatus(nameStatus),
      ...splitLines(untracked).map((path) => ({ path, status: 'added' as const })),
    ].filter(({ path }) => path !== '.godview' && !path.startsWith('.godview/'));
    const files = changed.map<DiffFile>(({ path, status }) => {
      const count = counts.get(path) ?? { additions: 0, deletions: 0 };
      return {
        path,
        status,
        additions: count.additions,
        deletions: count.deletions,
        scopeStatus: isInScope(path, input.approvedScope) ? 'approved' : 'outside_scope',
        attribution: isCoveredByPathSet(path, input.preexistingChanges)
          ? 'preexisting_overlap'
          : 'change_set',
      };
    });
    const canonical = files
      .map(
        (file) =>
          `${file.status}\t${String(file.additions)}\t${String(file.deletions)}\t${file.path}`,
      )
      .join('\n');
    return {
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      computedAt: input.computedAt,
      contentHash: createHash('sha256').update(canonical).digest('hex'),
    };
  }

  async #git(args: readonly string[]): Promise<string | undefined> {
    try {
      const { stdout } = await run('git', [...args], {
        cwd: this.#cwd,
        // 仓库可能非常大，但这些命令的输出仍需有上限，避免占满 Extension Host 内存。
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout.trimEnd();
    } catch {
      // 无 Git、git 不可用或非仓库目录都退化为「无 Git」，而不是让扩展启动失败。
      return undefined;
    }
  }
}

function parseNameStatus(
  output: string,
): { readonly path: WorkspacePath; readonly status: DiffFile['status'] }[] {
  return splitLines(output).map((line) => {
    const [code = '', first = '', second] = line.split('\t');
    const path = second ?? first;
    const prefix = code[0];
    const status: DiffFile['status'] =
      prefix === 'A'
        ? 'added'
        : prefix === 'M'
          ? 'modified'
          : prefix === 'D'
            ? 'deleted'
            : prefix === 'R'
              ? 'renamed'
              : 'unknown';
    return { path, status };
  });
}

function parseNumstat(
  output: string,
): ReadonlyMap<WorkspacePath, { readonly additions: number; readonly deletions: number }> {
  return new Map(
    splitLines(output).map((line) => {
      const [added = '0', deleted = '0', path = ''] = line.split('\t');
      const value = (raw: string): number => (raw === '-' ? 0 : Number.parseInt(raw, 10));
      return [path, { additions: value(added), deletions: value(deleted) }];
    }),
  );
}

function isInScope(path: WorkspacePath, scope: readonly WorkspacePath[]): boolean {
  return isCoveredByPathSet(path, scope);
}

/** Git porcelain may collapse an untracked directory (`public/`) while Diff expands its files. */
export function isCoveredByPathSet(
  path: WorkspacePath,
  candidates: readonly WorkspacePath[],
): boolean {
  return candidates.some((candidate) => {
    const normalized = candidate.replace(/\/+$/u, '');
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function parseStatus(output: string): readonly string[] {
  return output
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((line) => line !== '');
}
