import type {
  GraphEdge,
  GraphNode,
  Identifier,
  Timestamp,
  WorkspacePath,
} from '@god-view/protocol';

/**
 * Git 历史 → 分阶段地图的纯投影。
 *
 * 本模块回答：「按提交顺序看，这个项目在每个阶段由哪些模块组成、有多大」。
 * 它不读 git、不读文件系统，只消费调用方已经取好的提交清单，因此可以直接单测
 * （TECHNICAL_ARCHITECTURE.md §4.1）。
 */

export interface HistoryCommitFile {
  readonly path: WorkspacePath;
  readonly additions: number;
  readonly deletions: number;
  /** 该提交把这个文件删除了。重命名由调用方拆成删除 + 新增。 */
  readonly removed: boolean;
}

export interface HistoryCommit {
  readonly sha: string;
  readonly author: string;
  readonly committedAt: Timestamp;
  readonly subject: string;
  readonly files: readonly HistoryCommitFile[];
}

export interface BuildHistoryTimelineOptions {
  /** 当前地图节点。文件优先归属这里，保证回放用的是业务模块名而不是目录名。 */
  readonly mapNodes: readonly GraphNode[];
  /** 当前地图关系。只有两端都已出现的关系才会在该帧画出。 */
  readonly mapEdges: readonly GraphEdge[];
  /**
   * 窗口起点之前就已存在的文件。
   *
   * 只回放最近 N 次提交时，更早的文件不会出现在任何提交里；缺少它们会让回放
   * 从一张假的空图开始，把「项目原本就有的部分」误报成这段窗口里新建的。
   */
  readonly baselineFiles?: readonly WorkspacePath[];
  /** 提交数超过该上限时，相邻提交合并成一帧。 */
  readonly maxFrames?: number;
  /** 被更早提交截断掉的提交数，只用于向用户说明回放不完整。 */
  readonly truncatedCommits?: number;
}

export interface HistoryFrame {
  readonly index: number;
  readonly sha: string;
  readonly shortSha: string;
  readonly author: string;
  readonly committedAt: Timestamp;
  readonly subject: string;
  readonly additions: number;
  readonly deletions: number;
  /** 该帧合并了多少次提交。大于 1 表示因为帧数上限而聚合过。 */
  readonly commitCount: number;
  readonly fileCount: number;
  readonly presentNodeIds: readonly Identifier[];
  readonly changedNodeIds: readonly Identifier[];
  /** 节点规模：累计代码行 + 文件数。基线文件行数未知，至少体现文件数。 */
  readonly magnitudes: Readonly<Record<Identifier, number>>;
}

export interface HistoryTimeline {
  /** 整段历史里出现过的全部节点。帧只携带 id，避免消息体随帧数放大。 */
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly frames: readonly HistoryFrame[];
  readonly truncatedCommits: number;
  /** 未被地图覆盖、按目录推断出来的节点数。UI 必须如实说明它们不是声明结果。 */
  readonly derivedNodeCount: number;
}

const defaultMaxFrames = 240;
const derivedIdPrefix = 'history:dir:';
const rootBucket = '(root)';

/**
 * 顶层目录只是容器时向下再取一层。
 *
 * `src/` 或 `packages/` 下面的东西才是模块；停在容器目录会把整个仓库画成一个点。
 */
const containerSegments = new Set([
  'src',
  'lib',
  'libs',
  'apps',
  'packages',
  'modules',
  'services',
  'components',
  'internal',
  'pkg',
]);

interface NodeAccumulator {
  readonly files: Set<WorkspacePath>;
  lines: number;
}

export function buildHistoryTimeline(
  commits: readonly HistoryCommit[],
  options: BuildHistoryTimelineOptions,
): HistoryTimeline {
  const ownership = buildOwnershipIndex(options.mapNodes);
  const parents = new Map<Identifier, Identifier>(
    options.mapNodes.flatMap((node) =>
      node.parentId === undefined ? [] : [[node.id, node.parentId] as const],
    ),
  );
  const accumulators = new Map<Identifier, NodeAccumulator>();
  const owners = new Map<WorkspacePath, Identifier>();
  const derived = new Map<Identifier, GraphNode>();
  const timestamp = commits[commits.length - 1]?.committedAt ?? new Date(0).toISOString();

  const ownerFor = (path: WorkspacePath): Identifier => {
    const existing = owners.get(path);
    if (existing !== undefined) return existing;
    const declared = ownership.find(
      (entry) => path === entry.prefix || path.startsWith(`${entry.prefix}/`),
    );
    const id = declared?.nodeId ?? `${derivedIdPrefix}${derivedBucket(path)}`;
    if (declared === undefined && !derived.has(id)) {
      derived.set(id, derivedNode(id, derivedBucket(path), timestamp));
    }
    owners.set(path, id);
    return id;
  };

  for (const path of options.baselineFiles ?? []) {
    addFile(accumulators, chain(ownerFor(path), parents), path, 0);
  }

  const buckets = groupCommits(commits, options.maxFrames ?? defaultMaxFrames);
  const frames: HistoryFrame[] = [];
  for (const [index, bucket] of buckets.entries()) {
    const touched = new Set<Identifier>();
    let additions = 0;
    let deletions = 0;
    for (const commit of bucket) {
      additions += commit.files.reduce((sum, file) => sum + file.additions, 0);
      deletions += commit.files.reduce((sum, file) => sum + file.deletions, 0);
      for (const file of commit.files) {
        const ids = chain(ownerFor(file.path), parents);
        for (const id of ids) touched.add(id);
        if (file.removed) {
          removeFile(accumulators, ids, file.path, file.additions - file.deletions);
        } else {
          addFile(accumulators, ids, file.path, file.additions - file.deletions);
        }
      }
    }
    const last = bucket[bucket.length - 1];
    if (last === undefined) continue;
    const present = [...accumulators.entries()].filter(([, value]) => value.files.size > 0);
    frames.push({
      index,
      sha: last.sha,
      shortSha: last.sha.slice(0, 7),
      author: last.author,
      committedAt: last.committedAt,
      subject: last.subject,
      additions,
      deletions,
      commitCount: bucket.length,
      fileCount: countFiles(present),
      presentNodeIds: present.map(([id]) => id),
      changedNodeIds: [...touched].filter((id) => (accumulators.get(id)?.files.size ?? 0) > 0),
      magnitudes: Object.fromEntries(
        present.map(([id, value]) => [id, value.lines + value.files.size]),
      ),
    });
  }

  const nodeIds = new Set(accumulators.keys());
  const nodes = [
    ...options.mapNodes.filter((node) => nodeIds.has(node.id)),
    ...[...derived.values()].filter((node) => nodeIds.has(node.id)),
  ];
  return {
    nodes,
    edges: options.mapEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    frames,
    truncatedCommits: options.truncatedCommits ?? 0,
    derivedNodeCount: derived.size,
  };
}

/** 文件先归属声明路径最长的地图节点：`src/a/b.ts` 属于 `src/a` 而不是 `src`。 */
function buildOwnershipIndex(
  nodes: readonly GraphNode[],
): readonly { readonly prefix: WorkspacePath; readonly nodeId: Identifier }[] {
  return nodes
    .flatMap((node) =>
      (node.paths ?? []).map((path) => ({ prefix: normalize(path), nodeId: node.id })),
    )
    .filter((entry) => entry.prefix !== '')
    .sort((left, right) => right.prefix.length - left.prefix.length);
}

function normalize(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function derivedBucket(path: WorkspacePath): string {
  const segments = normalize(path).split('/');
  if (segments.length <= 1) return rootBucket;
  const [first = '', second] = segments;
  return containerSegments.has(first) && second !== undefined && segments.length > 2
    ? `${first}/${second}`
    : first;
}

function derivedNode(id: Identifier, bucket: string, timestamp: Timestamp): GraphNode {
  return {
    id,
    type: 'module',
    label: bucket === rootBucket ? '仓库根目录' : bucket,
    responsibility: '按目录结构推断的历史分组，不是 Agent 声明的模块。',
    paths: bucket === rootBucket ? [] : [bucket],
    // 目录推断属于 L3 系统推断：既不是文件事实，也不是 Agent 声明，UI 不得展示成已验证。
    source: {
      kind: 'inferred',
      actor: { kind: 'system', displayName: 'God View history' },
      declaredAt: timestamp,
    },
    codeValidation: { status: 'unverified', level: 'L3' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: timestamp,
    revision: 0,
  };
}

/** 节点自身加它在地图里的祖先链：某个文件出现时，包含它的模块也就出现了。 */
function chain(
  id: Identifier,
  parents: ReadonlyMap<Identifier, Identifier>,
): readonly Identifier[] {
  const result: Identifier[] = [id];
  const seen = new Set<Identifier>([id]);
  let current = parents.get(id);
  while (current !== undefined && !seen.has(current)) {
    result.push(current);
    seen.add(current);
    current = parents.get(current);
  }
  return result;
}

function accumulator(
  accumulators: Map<Identifier, NodeAccumulator>,
  id: Identifier,
): NodeAccumulator {
  const existing = accumulators.get(id);
  if (existing !== undefined) return existing;
  const created: NodeAccumulator = { files: new Set(), lines: 0 };
  accumulators.set(id, created);
  return created;
}

function addFile(
  accumulators: Map<Identifier, NodeAccumulator>,
  ids: readonly Identifier[],
  path: WorkspacePath,
  lineDelta: number,
): void {
  for (const id of ids) {
    const target = accumulator(accumulators, id);
    target.files.add(path);
    target.lines = Math.max(0, target.lines + lineDelta);
  }
}

function removeFile(
  accumulators: Map<Identifier, NodeAccumulator>,
  ids: readonly Identifier[],
  path: WorkspacePath,
  lineDelta: number,
): void {
  for (const id of ids) {
    const target = accumulator(accumulators, id);
    target.files.delete(path);
    target.lines = Math.max(0, target.lines + lineDelta);
  }
}

/** 只统计叶子归属，避免祖先链把同一个文件重复计入仓库文件总数。 */
function countFiles(present: readonly (readonly [Identifier, NodeAccumulator])[]): number {
  const files = new Set<WorkspacePath>();
  for (const [, value] of present) {
    for (const file of value.files) files.add(file);
  }
  return files.size;
}

/**
 * 提交数超过帧数上限时把相邻提交合并成一帧。
 *
 * 上限是渲染成本约束：几千帧的回放既播不完也没人看。合并后的帧仍然如实报告
 * `commitCount`，不假装每帧只有一次提交。
 */
function groupCommits(
  commits: readonly HistoryCommit[],
  maxFrames: number,
): readonly (readonly HistoryCommit[])[] {
  const limit = Math.max(1, maxFrames);
  const size = Math.max(1, Math.ceil(commits.length / limit));
  const buckets: HistoryCommit[][] = [];
  for (let index = 0; index < commits.length; index += size) {
    buckets.push([...commits.slice(index, index + size)]);
  }
  return buckets;
}
