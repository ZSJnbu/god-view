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

export interface GitCommitFile {
  readonly path: WorkspacePath;
  readonly additions: number;
  readonly deletions: number;
  readonly removed: boolean;
}

export interface GitCommitLog {
  readonly sha: string;
  readonly author: string;
  readonly committedAt: string;
  readonly subject: string;
  readonly files: readonly GitCommitFile[];
}

export interface GitHistory {
  /** 从旧到新排序，最多 `limit` 条。 */
  readonly commits: readonly GitCommitLog[];
  /** 窗口起点之前已经存在的文件，用于回放的起始基线。 */
  readonly baselineFiles: readonly WorkspacePath[];
  /** 因为 `limit` 被丢掉的更早提交数。 */
  readonly truncatedCommits: number;
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
   * 读取当前分支的提交历史，用于「历史回放」。
   *
   * `--no-renames` 让重命名表现为删除 + 新增：回放关心的是每个阶段有哪些文件，
   * 把 `{a => b}/c` 这种重命名摘要解析对反而更容易出错。`--raw` 提供状态字母
   * （用于识别删除），`--numstat` 提供行数；两者在同一次调用里成对输出，避免
   * 分两次调用后再按顺序配对。
   */
  async readHistory(options: { readonly limit: number }): Promise<GitHistory | undefined> {
    const limit = Math.max(1, Math.trunc(options.limit));
    const output = await this.#git([
      'log',
      '--first-parent',
      '--no-merges',
      '--no-renames',
      '--reverse',
      '-n',
      String(limit),
      '--raw',
      '--numstat',
      '--pretty=format:%x01%H%x1f%an%x1f%aI%x1f%s',
    ]);
    if (output === undefined) return undefined;
    const commits = parseCommitLog(output);
    const first = commits[0];
    if (first === undefined) return { commits: [], baselineFiles: [], truncatedCommits: 0 };
    const total = Number.parseInt(
      (await this.#git(['rev-list', '--count', '--first-parent', '--no-merges', 'HEAD'])) ?? '',
      10,
    );
    const truncatedCommits = Number.isFinite(total) ? Math.max(0, total - commits.length) : 0;
    // 窗口被截断时，更早的文件不会出现在任何一条提交里。缺了这份基线，回放会把
    // 项目原本就有的部分误报成这段窗口里新建的。
    const baselineFiles =
      truncatedCommits === 0 ? [] : ((await this.listTreeFiles(`${first.sha}~1`)) ?? []);
    return { commits, baselineFiles, truncatedCommits };
  }

  /** 列出某个提交的完整文件树。用于给被截断的历史窗口构造起始基线。 */
  async listTreeFiles(revision: string): Promise<readonly WorkspacePath[] | undefined> {
    const output = await this.#git(['ls-tree', '-r', '--name-only', revision]);
    return output === undefined ? undefined : splitLines(output);
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

/**
 * 解析 `git log --raw --numstat` 的输出。
 *
 * 每个提交以 `\x01` 开头，头部字段用 `\x1f` 分隔；随后先是 `:` 开头的 raw 行
 * （提供状态字母），再是 numstat 行（提供增删行数）。二进制文件的行数是 `-`，
 * 记为 0 而不是让 `NaN` 传播到规模统计里。
 */
export function parseCommitLog(output: string): readonly GitCommitLog[] {
  const commits: GitCommitLog[] = [];
  for (const block of output.split('\u0001')) {
    if (block.trim() === '') continue;
    const [header = '', ...rest] = block.split('\n');
    const [sha = '', author = '', committedAt = '', ...subject] = header.split('\u001f');
    if (sha === '') continue;
    commits.push({
      sha,
      author,
      committedAt,
      subject: subject.join('\u001f'),
      files: parseCommitFiles(rest),
    });
  }
  return commits;
}

/** raw 行给出状态字母（用于识别删除），numstat 行给出行数；两段合并成一份文件清单。 */
function parseCommitFiles(lines: readonly string[]): readonly GitCommitFile[] {
  const removed = new Set<WorkspacePath>();
  const counts = new Map<WorkspacePath, { additions: number; deletions: number }>();
  for (const line of lines) {
    if (line.startsWith(':')) {
      const [meta = '', path = ''] = line.split('\t');
      if (path !== '' && meta.trimEnd().endsWith('D')) removed.add(path);
      continue;
    }
    const [added = '0', deleted = '0', path = ''] = line.split('\t');
    if (path !== '') counts.set(path, { additions: countOf(added), deletions: countOf(deleted) });
  }
  return [...new Set<WorkspacePath>([...counts.keys(), ...removed])].map((path) => ({
    path,
    additions: counts.get(path)?.additions ?? 0,
    deletions: counts.get(path)?.deletions ?? 0,
    removed: removed.has(path),
  }));
}

function countOf(raw: string): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : 0;
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
