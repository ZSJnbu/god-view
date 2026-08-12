import {
  currentProtocolVersion,
  type ActiveChange,
  type AnnotationThread,
  type ChangeProposal,
  type CompletedChange,
  type GraphEdge,
  type GraphNode,
  type GuidedStory,
  type GraphSnapshotDocument,
  type Identifier,
  type Timestamp,
  type WriteAccessRequest,
} from '@god-view/protocol';

/**
 * 进程内的图状态。
 *
 * 使用 Map 提供 O(1) 查找，但持久化时必须转换为 GraphSnapshotDocument 的排序数组：
 * Map 的迭代顺序取决于插入顺序，会让「相同事件序列产生相同快照」的保证失效
 * （CODING_STANDARDS.md §4.2、§9）。
 */
export interface GraphSnapshot {
  readonly schemaVersion: string;
  readonly workspaceId: Identifier;
  readonly branchKey: Identifier;
  readonly revision: number;
  readonly lastEventSeq: number;
  readonly baseGitRevision?: string;
  readonly createdAt: Timestamp;
  readonly nodes: ReadonlyMap<Identifier, GraphNode>;
  readonly edges: ReadonlyMap<Identifier, GraphEdge>;
  readonly activeChanges: ReadonlyMap<Identifier, ActiveChange>;
  readonly stories: ReadonlyMap<Identifier, GuidedStory>;
  readonly annotations: ReadonlyMap<Identifier, AnnotationThread>;
  readonly writeAccessRequests: ReadonlyMap<Identifier, WriteAccessRequest>;
  readonly changeProposals: ReadonlyMap<Identifier, ChangeProposal>;
  readonly completedChanges: ReadonlyMap<Identifier, CompletedChange>;
  readonly appliedEventIds: ReadonlySet<Identifier>;
}

export interface CreateSnapshotOptions {
  readonly workspaceId: Identifier;
  readonly branchKey: Identifier;
  readonly createdAt: Timestamp;
  readonly baseGitRevision?: string;
}

export function createEmptySnapshot(options: CreateSnapshotOptions): GraphSnapshot {
  return {
    schemaVersion: currentProtocolVersion,
    workspaceId: options.workspaceId,
    branchKey: options.branchKey,
    revision: 0,
    lastEventSeq: 0,
    ...(options.baseGitRevision === undefined ? {} : { baseGitRevision: options.baseGitRevision }),
    createdAt: options.createdAt,
    nodes: new Map(),
    edges: new Map(),
    activeChanges: new Map(),
    stories: new Map(),
    annotations: new Map(),
    writeAccessRequests: new Map(),
    changeProposals: new Map(),
    completedChanges: new Map(),
    appliedEventIds: new Set(),
  };
}

function byId<T extends { readonly id: Identifier }>(items: readonly T[]): Map<Identifier, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 转换为持久化形态。
 *
 * 所有集合按 id 字典序排序，因此同一事件序列在任何机器上序列化结果一致，
 * 可以直接用内容哈希比较回放确定性。
 */
export function toSnapshotDocument(snapshot: GraphSnapshot): GraphSnapshotDocument {
  return {
    schemaVersion: snapshot.schemaVersion,
    workspaceId: snapshot.workspaceId,
    branchKey: snapshot.branchKey,
    revision: snapshot.revision,
    lastEventSeq: snapshot.lastEventSeq,
    ...(snapshot.baseGitRevision === undefined
      ? {}
      : { baseGitRevision: snapshot.baseGitRevision }),
    createdAt: snapshot.createdAt,
    nodes: [...snapshot.nodes.values()].sort((left, right) => compareIds(left.id, right.id)),
    edges: [...snapshot.edges.values()].sort((left, right) => compareIds(left.id, right.id)),
    activeChanges: [...snapshot.activeChanges.values()].sort((left, right) =>
      compareIds(left.changeSetId, right.changeSetId),
    ),
    stories: [...snapshot.stories.values()].sort((left, right) => compareIds(left.id, right.id)),
    annotations: [...snapshot.annotations.values()].sort((left, right) =>
      compareIds(left.id, right.id),
    ),
    writeAccessRequests: [...snapshot.writeAccessRequests.values()].sort((left, right) =>
      compareIds(left.id, right.id),
    ),
    changeProposals: [...snapshot.changeProposals.values()].sort((left, right) =>
      compareIds(left.id, right.id),
    ),
    completedChanges: [...snapshot.completedChanges.values()].sort((left, right) =>
      compareIds(left.changeSetId, right.changeSetId),
    ),
    appliedEventIds: [...snapshot.appliedEventIds].sort(compareIds),
  };
}

export function fromSnapshotDocument(document: GraphSnapshotDocument): GraphSnapshot {
  return {
    schemaVersion: document.schemaVersion,
    workspaceId: document.workspaceId,
    branchKey: document.branchKey,
    revision: document.revision,
    lastEventSeq: document.lastEventSeq,
    ...(document.baseGitRevision === undefined
      ? {}
      : { baseGitRevision: document.baseGitRevision }),
    createdAt: document.createdAt,
    nodes: byId(document.nodes),
    edges: byId(document.edges),
    activeChanges: new Map(
      (document.activeChanges ?? []).map((change) => [change.changeSetId, change]),
    ),
    stories: new Map((document.stories ?? []).map((story) => [story.id, story])),
    annotations: new Map(
      (document.annotations ?? []).map((annotation) => [annotation.id, annotation]),
    ),
    writeAccessRequests: new Map(
      (document.writeAccessRequests ?? []).map((request) => [request.id, request]),
    ),
    changeProposals: new Map(
      (document.changeProposals ?? []).map((proposal) => [proposal.id, proposal]),
    ),
    completedChanges: new Map(
      (document.completedChanges ?? []).map((change) => [change.changeSetId, change]),
    ),
    appliedEventIds: new Set(document.appliedEventIds),
  };
}

/**
 * 稳定序列化：对象键按字典序输出，因此结构相同的两个快照得到相同字符串。
 *
 * 不能直接用 JSON.stringify：它保留键的插入顺序，回放顺序不同会产生不同文本。
 */
export function canonicalize(value: unknown): string {
  // JSON.stringify(undefined) 返回 undefined，会破坏拼接结果，这里显式规范化。
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => compareIds(left, right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(',')}}`;
}

const fnvOffsetBasis = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const uint64Mask = 0xffffffffffffffffn;

/**
 * 快照内容哈希（FNV-1a 64 位）。
 *
 * 用于回放确定性断言和存储完整性校验，不用于任何安全用途，因此不需要
 * 加密散列，也避免 graph-core 依赖 node:crypto 而失去纯函数与浏览器可用性。
 */
export function hashSnapshot(document: GraphSnapshotDocument): string {
  const text = canonicalize(document);
  let hash = fnvOffsetBasis;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * fnvPrime) & uint64Mask;
  }
  return hash.toString(16).padStart(16, '0');
}
