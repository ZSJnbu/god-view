import type { CoverageReport, CoverageReason, Timestamp, WorkspacePath } from '@god-view/protocol';
import type { GraphSnapshot } from './snapshot.js';

/** 第一方文件的分类，由插件侧 Inventory Builder 只读收集。 */
export type InventoryKind = 'source' | 'config' | 'asset';

export interface InventoryEntry {
  readonly path: WorkspacePath;
  readonly kind: InventoryKind;
}

export interface ExcludedEntry {
  readonly path: WorkspacePath;
  /** 排除原因必须可查看，不能静默丢弃第一方内容。 */
  readonly reason: string;
}

/**
 * 仓库清单。
 *
 * 覆盖率以这份清单为分母，而不是 Agent 自报的节点数量
 * （PRD 第 9 节、CODE_QUALITY_STANDARD.md §5.2）。
 */
export interface RepositoryInventory {
  readonly included: readonly InventoryEntry[];
  readonly excluded: readonly ExcludedEntry[];
  readonly failed: readonly ExcludedEntry[];
}

function normalize(path: string): string {
  return path.replace(/^\.\//u, '').replace(/\\/gu, '/');
}

/**
 * 判断某个文件是否被某个节点声明覆盖。
 *
 * 目录声明按前缀匹配，因此 `src/orders` 覆盖 `src/orders/index.ts`，
 * 但不会误覆盖 `src/orders-legacy/index.ts`。
 */
function covers(declaredPath: string, filePath: string): boolean {
  const declared = normalize(declaredPath);
  const file = normalize(filePath);
  return file === declared || file.startsWith(`${declared.replace(/\/$/u, '')}/`);
}

function collectDeclaredPaths(snapshot: GraphSnapshot): string[] {
  const declared: string[] = [];
  for (const node of snapshot.nodes.values()) {
    if (node.lifecycle.status === 'removed') {
      continue;
    }
    for (const path of node.paths ?? []) {
      declared.push(normalize(path));
    }
  }
  return declared;
}

function countReasons(entries: readonly ExcludedEntry[]): CoverageReason[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => (left.reason < right.reason ? -1 : 1));
}

export interface CoverageResult {
  readonly report: CoverageReport;
  /** 未归类文件的完整清单，供「未分类/待分析」节点展示。 */
  readonly unclassifiedPaths: readonly WorkspacePath[];
}

/**
 * 计算地图覆盖率。
 *
 * 未被任何节点覆盖的第一方文件必须出现在 unclassifiedPaths 中：产品要求
 * 「所有第一方内容必须在同一张图中有归属」，宁可显示「未分类」也不静默遗漏。
 */
export function computeCoverage(
  inventory: RepositoryInventory,
  snapshot: GraphSnapshot,
  computedAt: Timestamp,
): CoverageResult {
  const declared = collectDeclaredPaths(snapshot);
  const unclassifiedPaths: WorkspacePath[] = [];
  let classified = 0;
  const kindCounts: Record<InventoryKind, number> = { source: 0, config: 0, asset: 0 };

  for (const entry of inventory.included) {
    kindCounts[entry.kind] += 1;
    if (declared.some((declaredPath) => covers(declaredPath, entry.path))) {
      classified += 1;
    } else {
      unclassifiedPaths.push(entry.path);
    }
  }

  const sorted = [...unclassifiedPaths].sort();
  return {
    report: {
      includedSources: kindCounts.source,
      includedConfigs: kindCounts.config,
      includedAssets: kindCounts.asset,
      classified,
      unclassified: sorted.length,
      excluded: inventory.excluded.length,
      failed: inventory.failed.length,
      unclassifiedPaths: sorted,
      reasons: countReasons([...inventory.excluded, ...inventory.failed]),
      computedAt,
    },
    unclassifiedPaths: sorted,
  };
}
