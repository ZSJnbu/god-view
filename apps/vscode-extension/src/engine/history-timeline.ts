import {
  buildHistoryTimeline,
  listEdges,
  listNodes,
  type GraphSnapshot,
  type HistoryCommit,
} from '@god-view/graph-core';
import type { HistoryTimelineView } from '@god-view/webview-bridge';
import { decideExclusion } from '../workspace/exclusions.js';
import type { GitAdapter } from '../workspace/git-adapter.js';

/** 回放窗口上限。更早的提交在 UI 里显式说明被截断，不静默丢弃。 */
export const historyCommitLimit = 2000;
/** 帧数上限。超过后相邻提交合并成一帧，帧内如实报告合并了几次提交。 */
export const historyFrameLimit = 240;

export interface WorkspaceHistoryInput {
  readonly git: GitAdapter;
  readonly snapshot: GraphSnapshot;
  readonly extraExcludes: readonly string[];
  readonly commitLimit?: number;
  readonly frameLimit?: number;
}

/**
 * 把工作区的 git 历史装配成可回放的时间线。
 *
 * 排除规则复用 {@link decideExclusion}：覆盖率、清单与回放必须用同一份名单，
 * 否则回放里会冒出仓库统计中根本不存在的 `node_modules` 模块。
 */
export async function buildWorkspaceHistory(
  input: WorkspaceHistoryInput,
): Promise<HistoryTimelineView | undefined> {
  const history = await input.git.readHistory({
    limit: input.commitLimit ?? historyCommitLimit,
  });
  if (history === undefined) return undefined;
  const keep = (path: string): boolean => !decideExclusion(path, input.extraExcludes).excluded;
  const commits: HistoryCommit[] = [];
  for (const commit of history.commits) {
    const files = commit.files.filter((file) => keep(file.path));
    // 只动了构建产物或依赖的提交在结构上什么也没发生，出一帧只会让回放变长。
    if (files.length === 0) continue;
    commits.push({ ...commit, files });
  }
  if (commits.length === 0) return undefined;
  const timeline = buildHistoryTimeline(commits, {
    mapNodes: listNodes(input.snapshot),
    mapEdges: listEdges(input.snapshot),
    baselineFiles: history.baselineFiles.filter(keep),
    maxFrames: input.frameLimit ?? historyFrameLimit,
    truncatedCommits: history.truncatedCommits,
  });
  return timeline;
}
