import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitAdapter } from './git-adapter.js';

/**
 * GitAdapter 针对真实 git 的测试。
 *
 * 覆盖的缺陷：`git ls-files --cached` 反映的是索引，删除文件后它仍然列出该路径，
 * 直到删除被 `git add`。这份清单是覆盖率的**分母**，包含磁盘上不存在的文件会让
 * 分母虚高、覆盖率虚低，而用户在仓库里根本找不到那个文件。
 */

const run = promisify(execFile);

let root: string;
let git: GitAdapter;

async function inRepo(args: readonly string[]): Promise<void> {
  await run('git', [...args], { cwd: root });
}

async function writeSource(relative: string, contents = 'export const x = 1;\n'): Promise<void> {
  const target = join(root, relative);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, contents);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'god-view-git-'));
  await inRepo(['init', '-q']);
  await inRepo(['config', 'user.email', 'test@example.com']);
  await inRepo(['config', 'user.name', 'test']);
  await writeSource('src/a.ts');
  await writeSource('src/b.ts');
  await inRepo(['add', '-A']);
  await inRepo(['commit', '-qm', 'init']);
  git = new GitAdapter(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('listFirstPartyFiles', () => {
  it('包含已跟踪与未跟踪的文件', async () => {
    await writeSource('src/c.ts');

    // ls-files 不会把 --cached 与 --others 两组合并排序，顺序由 InventoryBuilder 负责。
    const files = [...((await git.listFirstPartyFiles()) ?? [])].sort();
    expect(files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('排除已跟踪但已从磁盘删除的文件', async () => {
    await rm(join(root, 'src/b.ts'));

    // 删除尚未 git add，--cached 仍会列出 src/b.ts。
    await expect(git.listFirstPartyFiles()).resolves.toEqual(['src/a.ts']);
  });

  it('删除被提交后结果保持一致', async () => {
    await rm(join(root, 'src/b.ts'));
    await inRepo(['add', '-A']);
    await inRepo(['commit', '-qm', 'remove b']);

    await expect(git.listFirstPartyFiles()).resolves.toEqual(['src/a.ts']);
  });

  it('遵循 .gitignore', async () => {
    await writeFile(join(root, '.gitignore'), 'ignored.ts\n');
    await writeSource('ignored.ts');

    const files = await git.listFirstPartyFiles();
    expect(files).toContain('.gitignore');
    expect(files).not.toContain('ignored.ts');
  });

  it('非 Git 目录返回 undefined，由调用方走兜底清单', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'god-view-plain-'));
    try {
      await expect(new GitAdapter(plain).listFirstPartyFiles()).resolves.toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('read', () => {
  it('报告当前分支与已有改动', async () => {
    await inRepo(['checkout', '-qb', 'feature/x']);
    await writeSource('src/a.ts', 'export const x = 2;\n');

    const state = await git.read();

    expect(state.hasGit).toBe(true);
    expect(state.branchKey).toBe('feature/x');
    expect(state.preexistingChanges).toContain('src/a.ts');
  });

  it('非 Git 目录退化为无 Git 而不是启动失败', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'god-view-plain-'));
    try {
      const state = await new GitAdapter(plain).read();

      expect(state.hasGit).toBe(false);
      expect(state.preexistingChanges).toEqual([]);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('diffSummary', () => {
  it('只返回路径、状态、行数和哈希，并标记批准范围与既有改动重叠', async () => {
    await writeSource('src/a.ts', 'export const x = 2;\nexport const y = 3;\n');
    await rm(join(root, 'src/b.ts'));
    const summary = await git.diffSummary({
      approvedScope: ['src/a.ts'],
      preexistingChanges: ['src/a.ts'],
      computedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(summary).toMatchObject({ additions: 2, deletions: 2 });
    expect(summary?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(summary?.files).toEqual([
      expect.objectContaining({
        path: 'src/a.ts',
        status: 'modified',
        scopeStatus: 'approved',
        attribution: 'preexisting_overlap',
      }),
      expect.objectContaining({
        path: 'src/b.ts',
        status: 'deleted',
        scopeStatus: 'outside_scope',
        attribution: 'change_set',
      }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('export const');
  });

  it('批准目录覆盖其内部文件', async () => {
    await writeSource('src/a.ts', 'changed\n');
    const summary = await git.diffSummary({
      approvedScope: ['src'],
      preexistingChanges: [],
      computedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(summary?.files[0]?.scopeStatus).toBe('approved');
  });

  it('启动前未跟踪目录覆盖其内部文件，不把旧文件归因给当前 ChangeSet', async () => {
    await writeSource('public/file.svg', '<svg />\n');
    const before = await git.read();
    expect(before.preexistingChanges).toContain('public/');

    const summary = await git.diffSummary({
      approvedScope: ['src/a.ts'],
      preexistingChanges: before.preexistingChanges,
      computedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(summary?.files).toContainEqual(
      expect.objectContaining({
        path: 'public/file.svg',
        scopeStatus: 'outside_scope',
        attribution: 'preexisting_overlap',
      }),
    );
  });

  it('不把 God View 自己的运行时文件归因给 Agent', async () => {
    await writeSource('.godview/session.json', '{}\n');
    const summary = await git.diffSummary({
      approvedScope: ['src'],
      preexistingChanges: [],
      computedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(summary?.files).toEqual([]);
  });
});

describe('readHistory', () => {
  it('按时间正序返回提交、增删行数与删除标记', async () => {
    await writeSource('src/c.ts', 'export const c = 1;\nexport const d = 2;\n');
    await inRepo(['add', '-A']);
    await inRepo(['commit', '-qm', 'add c']);
    await rm(join(root, 'src/b.ts'));
    await inRepo(['add', '-A']);
    await inRepo(['commit', '-qm', 'remove b']);

    const history = await git.readHistory({ limit: 10 });

    expect(history?.commits.map((commit) => commit.subject)).toEqual(['init', 'add c', 'remove b']);
    expect(history?.truncatedCommits).toBe(0);
    expect(history?.commits[1]?.files).toEqual([
      { path: 'src/c.ts', additions: 2, deletions: 0, removed: false },
    ]);
    expect(history?.commits[2]?.files).toEqual([
      { path: 'src/b.ts', additions: 0, deletions: 1, removed: true },
    ]);
    expect(history?.commits[0]?.author).toBe('test');
  });

  it('超出窗口时报告被截断的提交数，并给出窗口起点前的文件基线', async () => {
    await writeSource('src/c.ts');
    await inRepo(['add', '-A']);
    await inRepo(['commit', '-qm', 'add c']);

    const history = await git.readHistory({ limit: 1 });

    expect(history?.commits).toHaveLength(1);
    expect(history?.commits[0]?.subject).toBe('add c');
    expect(history?.truncatedCommits).toBe(1);
    expect([...(history?.baselineFiles ?? [])].sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('二进制文件的行数记为 0 而不是 NaN', async () => {
    await writeFile(join(root, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0]));
    await inRepo(['add', '-A']);
    await inRepo(['commit', '-qm', 'add binary']);

    const history = await git.readHistory({ limit: 1 });

    expect(history?.commits[0]?.files).toEqual([
      { path: 'logo.bin', additions: 0, deletions: 0, removed: false },
    ]);
  });

  it('非 Git 目录返回 undefined，由调用方如实告知回放不可用', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'god-view-plain-'));
    try {
      await expect(new GitAdapter(plain).readHistory({ limit: 10 })).resolves.toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
