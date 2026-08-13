import { describe, expect, it } from 'vitest';
import type { CoverageReport } from '@god-view/protocol';
import { buildAgentTask } from './agent-task.js';

const coverage: CoverageReport = {
  includedSources: 2,
  includedConfigs: 0,
  includedAssets: 0,
  classified: 0,
  unclassified: 2,
  excluded: 3,
  failed: 0,
  unclassifiedPaths: ['src/index.ts', 'src/orders.ts'],
  reasons: [{ reason: '默认排除', count: 3 }],
  computedAt: '2026-08-11T00:00:00.000Z',
};

describe('buildAgentTask', () => {
  it('空地图生成首次建图任务，并明确全覆盖与禁止改代码', () => {
    const task = buildAgentTask({ revision: 0, nodeCount: 0, coverage, drift: [] });
    expect(task).toContain('建立第一版项目地图');
    expect(task).toContain('不要修改用户代码');
    expect(task).toContain('God View: Configure Agent MCP');
    expect(task).toContain('不要扫描仓库');
    expect(task).toContain('共有 2 个第一方文件');
    expect(task).toContain('所有第一方文件必须归入模块/分组');
    expect(task).toContain('未分类：src/index.ts');
  });

  it('已有地图生成增量维护任务，而不是重新初始化', () => {
    const task = buildAgentTask({
      revision: 7,
      nodeCount: 3,
      coverage,
      drift: [{ kind: 'missing_file', detail: 'src/old.ts 不存在' }],
    });
    expect(task).toContain('当前地图版本：r7');
    expect(task).toContain('在稳定 ID 上增量更新');
    expect(task).toContain('漂移(missing_file)：src/old.ts 不存在');
    expect(task).not.toContain('建立第一版项目地图');
  });

  it('用户主动重新初始化时生成完整重绘任务，并要求清理旧实体与保留稳定 ID', () => {
    const task = buildAgentTask(
      {
        revision: 29,
        nodeCount: 9,
        coverage: { ...coverage, classified: 2, unclassified: 0 },
        drift: [],
      },
      'reinitialize',
    );
    expect(task).toContain('重新初始化并完整重绘项目地图');
    expect(task).toContain('地图 r29，现有 9 个节点');
    expect(task).toContain('保留稳定 ID');
    expect(task).toContain('remove_edge');
    expect(task).toContain('remove_node');
    expect(task).toContain('不要先清空整张地图');
    expect(task).toContain('不得修改用户源码');
  });

  it.each([
    ['complete_groups', '分组层级', '通过 parentId 归组'],
    ['complete_files', '关键文件关系', '不要把全部文件平铺到画布'],
  ] as const)('生成 %s 局部补全任务且不要求重绘', (mode, title, rule) => {
    const task = buildAgentTask({ revision: 29, nodeCount: 9, coverage, drift: [] }, mode);
    expect(task).toContain(title);
    expect(task).toContain(rule);
    expect(task).toContain('不是重新初始化');
    expect(task).toContain('保留现有模块');
    expect(task).toContain('不得修改用户源码');
  });

  it('超长未分类清单只内联前 50 项并提示通过 get_map 获取完整清单', () => {
    const paths = Array.from({ length: 52 }, (_, index) => `src/${String(index)}.ts`);
    const task = buildAgentTask({
      revision: 0,
      nodeCount: 0,
      coverage: { ...coverage, unclassified: paths.length, unclassifiedPaths: paths },
      drift: [],
    });
    expect(task).toContain('未分类：src/49.ts');
    expect(task).not.toContain('未分类：src/50.ts');
    expect(task).toContain('另有 2 个未分类文件');
  });
});
