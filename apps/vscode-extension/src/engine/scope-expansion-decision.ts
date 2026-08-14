import type { GraphSnapshot } from '@god-view/graph-core';
import type { GodViewEvent, Identifier, ToolResult } from '@god-view/protocol';
import type { GitState } from '../workspace/git-adapter.js';

/** 宿主审批必须在最新 Git/地图事实上完成，不能只把答案发回 Agent。 */
export async function decidePendingScopeExpansion(input: {
  readonly snapshot: () => GraphSnapshot | undefined;
  readonly readGit: () => Promise<GitState>;
  readonly rememberGit: (state: GitState) => void;
  readonly observe: (snapshot: GraphSnapshot) => Promise<void>;
  readonly buildEvent: (snapshot: GraphSnapshot) => GodViewEvent;
  readonly apply: (event: GodViewEvent) => Promise<ToolResult>;
  readonly changeSetId: Identifier;
  readonly requestId: Identifier;
}): Promise<boolean> {
  const initial = input.snapshot();
  const active = initial?.activeChanges.get(input.changeSetId);
  const request = active?.scopeExpansionRequests?.find((item) => item.id === input.requestId);
  if (initial === undefined || active === undefined || request?.status !== 'pending') return false;

  const gitState = await input.readGit();
  input.rememberGit(gitState);
  if (active.baseGitRevision !== undefined && gitState.headRevision !== active.baseGitRevision)
    return false;

  // 审批前重新读取 Diff；若 Agent 已经先写越界文件，领域层会拒绝事后补批。
  await input.observe(initial);
  const current = input.snapshot();
  if (current === undefined) return false;
  return (await input.apply(input.buildEvent(current))).accepted;
}
