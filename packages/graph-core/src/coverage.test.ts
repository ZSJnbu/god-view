import { beforeEach, describe, expect, it } from 'vitest';
import { computeCoverage, type RepositoryInventory } from './coverage.js';
import { reduce } from './reduce.js';
import { createEmptySnapshot, type GraphSnapshot } from './snapshot.js';
import {
  branchKey,
  node,
  nodeRemove,
  nodeUpsert,
  resetEventSequence,
  workspaceId,
} from '@god-view/testkit';

const computedAt = '2026-08-07T10:00:00.000Z';

function snapshotWith(paths: Record<string, readonly string[]>): GraphSnapshot {
  let snapshot: GraphSnapshot = createEmptySnapshot({
    workspaceId,
    branchKey,
    createdAt: computedAt,
  });
  for (const [id, nodePaths] of Object.entries(paths)) {
    const result = reduce(snapshot, nodeUpsert(node(id, { paths: [...nodePaths] })));
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    snapshot = result.value;
  }
  return snapshot;
}

const inventory: RepositoryInventory = {
  included: [
    { path: 'src/orders/index.ts', kind: 'source' },
    { path: 'src/orders/repository.ts', kind: 'source' },
    { path: 'src/payment/index.ts', kind: 'source' },
    { path: 'src/orphan.ts', kind: 'source' },
    { path: 'package.json', kind: 'config' },
    { path: 'assets/logo.svg', kind: 'asset' },
  ],
  excluded: [
    { path: 'node_modules/left-pad/index.js', reason: '第三方依赖' },
    { path: 'node_modules/react/index.js', reason: '第三方依赖' },
    { path: 'dist/bundle.js', reason: '构建产物' },
  ],
  failed: [{ path: 'src/broken.ts', reason: '读取失败' }],
};

beforeEach(() => {
  resetEventSequence();
});

describe('覆盖率计算', () => {
  it('按目录前缀归类文件，并把未覆盖文件列为未分类', () => {
    const snapshot = snapshotWith({
      'module.orders': ['src/orders'],
      'module.payment': ['src/payment/index.ts'],
      'group.config': ['package.json'],
      'group.assets': ['assets'],
    });
    const { report } = computeCoverage(inventory, snapshot, computedAt);

    expect(report.classified).toBe(5);
    expect(report.unclassified).toBe(1);
    expect(report.unclassifiedPaths).toEqual(['src/orphan.ts']);
  });

  it('分别统计源码、配置和资源数量', () => {
    const { report } = computeCoverage(inventory, snapshotWith({}), computedAt);
    expect(report.includedSources).toBe(4);
    expect(report.includedConfigs).toBe(1);
    expect(report.includedAssets).toBe(1);
  });

  it('目录前缀不会误覆盖同名前缀的兄弟目录', () => {
    const snapshot = snapshotWith({ 'module.orders': ['src/orders'] });
    const withSibling: RepositoryInventory = {
      included: [{ path: 'src/orders-legacy/index.ts', kind: 'source' }],
      excluded: [],
      failed: [],
    };
    const { report } = computeCoverage(withSibling, snapshot, computedAt);
    expect(report.unclassifiedPaths).toEqual(['src/orders-legacy/index.ts']);
  });

  it('已删除节点不再提供覆盖', () => {
    let snapshot = snapshotWith({ 'module.orders': ['src/orders'] });
    const removed = reduce(snapshot, nodeRemove('module.orders'));
    if (!removed.ok) {
      throw new Error(removed.error.message);
    }
    snapshot = removed.value;
    const { report } = computeCoverage(inventory, snapshot, computedAt);
    expect(report.classified).toBe(0);
  });

  it('排除原因按类型聚合且可核对', () => {
    const { report } = computeCoverage(inventory, snapshotWith({}), computedAt);
    expect(report.excluded).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.reasons).toEqual([
      { reason: '构建产物', count: 1 },
      { reason: '第三方依赖', count: 2 },
      { reason: '读取失败', count: 1 },
    ]);
  });

  it('归一化 ./ 前缀与 Windows 分隔符', () => {
    const snapshot = snapshotWith({ 'module.orders': ['./src/orders'] });
    const windowsPaths: RepositoryInventory = {
      included: [{ path: 'src\\orders\\index.ts', kind: 'source' }],
      excluded: [],
      failed: [],
    };
    const { report } = computeCoverage(windowsPaths, snapshot, computedAt);
    expect(report.classified).toBe(1);
  });

  it('空清单产生零覆盖率但不报错', () => {
    const { report } = computeCoverage(
      { included: [], excluded: [], failed: [] },
      snapshotWith({}),
      computedAt,
    );
    expect(report.classified).toBe(0);
    expect(report.unclassified).toBe(0);
    expect(report.reasons).toEqual([]);
  });
});
