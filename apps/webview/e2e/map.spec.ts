import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const graph = page.getByRole('application', { name: '项目地图' });
  await expect(graph).toBeVisible();
  await expect(graph).toHaveAttribute('data-rendered-nodes', '3');
  await expect(graph).toHaveAttribute('data-visible-nodes', '3');
  await expect(graph).toHaveAttribute('data-rendered-edges', '2');
  await expect(graph).toHaveAttribute('data-visible-edges', '2');
  const canvas = await graph.boundingBox();
  expect(canvas?.height ?? 0).toBeGreaterThan(400);
  await expect(page.getByText(/当前绘制 \d+ 个节点 · \d+ 根连线/u)).toBeVisible();
});

test('原生 Agent 入口把对话和权限留在官方终端，并保留修改审批边界', async ({ page }) => {
  const panel = page.getByRole('region', { name: '原生项目 Agent' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('God View 不再运行一套独立 Agent');
  await expect(panel).toContainText('系统权限申请也会在那里出现');
  await page.getByRole('button', { name: '打开 / 聚焦终端' }).click();
  await page.getByLabel('发送给原生项目 Agent').fill('订单数据如何流动？');
  await page.getByRole('button', { name: '发送到终端' }).click();
  const changeRequest = page.getByRole('checkbox', {
    name: '作为修改请求（先形成 God View 方案）',
  });
  await expect(changeRequest).toBeEnabled();
  await changeRequest.check();
  await expect(changeRequest).toBeChecked();
  await page.getByLabel('发送给原生项目 Agent').fill('把它实现成个人博客');
  await page.getByRole('button', { name: '发送到终端' }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({ type: 'openAgentTerminal', agent: 'codex' });
  expect(commands).toContainEqual({
    type: 'sendAgentMessage',
    agent: 'codex',
    message: '订单数据如何流动？',
    mode: 'chat',
  });
  expect(commands).toContainEqual({
    type: 'sendAgentMessage',
    agent: 'codex',
    message: '把它实现成个人博客',
    mode: 'change',
  });
});

test('原生 Agent 提交方案后，批准、执行、画布更新与 Diff 验收形成完整闭环', async ({ page }) => {
  await page.getByRole('checkbox', { name: '作为修改请求（先形成 God View 方案）' }).check();
  await page.getByLabel('发送给原生项目 Agent').fill('继续处理');
  await page.getByRole('button', { name: '发送到终端' }).click();

  const approval = page.getByRole('region', { name: '等待批准并实现' });
  await expect(approval).toContainText('方案已准备好，等待你批准后交给原生 Agent');
  await expect(approval).toContainText('继续视觉优化并保持现有功能边界');
  await approval.getByRole('button', { name: '批准并开始实现' }).click();

  const review = page.getByRole('complementary', { name: 'ChangeSet Diff 审查' });
  await expect(review).toContainText('src/orders/index.ts');
  await expect(review.getByRole('region', { name: '地图同步结果' })).toContainText('module.orders');
  await review.getByRole('button', { name: '接受结果' }).click();
  await review.getByText(/ChangeSet 历史/u).click();
  await expect(review).toContainText('已接受');

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([
      {
        type: 'sendAgentMessage',
        agent: 'codex',
        message: '继续处理',
        mode: 'change',
      },
      expect.objectContaining({
        type: 'approveProposal',
        proposalId: 'proposal.continue-e2e',
        autoStartAgent: 'codex',
      }),
      {
        type: 'reviewChange',
        changeSetId: 'change.approved.e2e',
        status: 'accepted',
      },
    ]),
  );
});

test('原生 Agent 写越界文件前显示权威扩围申请，并提交专用用户决定', async ({ page }) => {
  await page.evaluate(() => {
    const timestamp = '2026-08-11T00:00:00.000Z';
    const harness = window as unknown as {
      __godViewSnapshot: { document: { revision: number; activeChanges: unknown[] } };
    };
    const active = {
      changeSetId: 'change.orders',
      sessionId: 'native-agent-e2e',
      intent: '修改订单并补充测试',
      startedAt: timestamp,
      approvedScope: ['src/orders/index.ts'],
      touchedNodeIds: [],
      touchedEdgeIds: [],
      executionStatus: 'scope_violation',
      scopeExpansionRequests: [
        {
          id: 'scope.orders-tests',
          requestedFiles: ['src/orders.test.ts', 'src/test-helper.ts'],
          reason: '需要补充回归测试和测试辅助函数',
          status: 'pending',
          requestedAt: timestamp,
        },
      ],
    };
    harness.__godViewSnapshot.document.activeChanges = [active];
    harness.__godViewSnapshot.document.revision += 1;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: harness.__godViewSnapshot.document.revision,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedActiveChanges: [active],
          },
          drift: [],
        },
      }),
    );
  });

  const review = page.getByRole('complementary', { name: 'ChangeSet Diff 审查' });
  await expect(review).toContainText('需要补充回归测试和测试辅助函数');
  await expect(review).toContainText('src/orders.test.ts');
  await expect(review).toContainText('src/test-helper.ts');
  await review.getByRole('button', { name: '批准并继续' }).click();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({
    type: 'decideScopeExpansion',
    requestId: 'scope.orders-tests',
    changeSetId: 'change.orders',
    decision: 'approved',
  });
});

test('原生 Agent 入口可在停靠面板与可拖动缩放浮窗间切换', async ({ page }) => {
  await page.getByRole('button', { name: '浮动窗口' }).click();

  const floating = page.getByTestId('agent-floating-pane');
  await expect(floating).toBeVisible();
  const before = await floating.boundingBox();
  const titlebar = page.getByRole('toolbar', { name: 'Agent 浮窗标题栏' });
  await expect(titlebar).toContainText('按住此标题栏拖动');
  const dragHandle = await titlebar.boundingBox();
  expect(dragHandle).not.toBeNull();
  if (dragHandle !== null && before !== null) {
    await page.mouse.move(
      dragHandle.x + dragHandle.width / 2,
      dragHandle.y + dragHandle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dragHandle.x + dragHandle.width / 2 + 90,
      dragHandle.y + dragHandle.height / 2 + 55,
      { steps: 5 },
    );
    await page.mouse.up();
    const moved = await floating.boundingBox();
    expect((moved?.x ?? 0) - before.x).toBeGreaterThan(70);
    expect((moved?.y ?? 0) - before.y).toBeGreaterThan(40);
  }
  const movedBeforeKeyboard = await floating.boundingBox();
  await titlebar.focus();
  await page.keyboard.press('ArrowLeft');
  const movedAfterKeyboard = await floating.boundingBox();
  expect((movedBeforeKeyboard?.x ?? 0) - (movedAfterKeyboard?.x ?? 0)).toBeGreaterThanOrEqual(11);

  const resizer = page.getByRole('separator', { name: '调整 Agent 浮窗大小' });
  const handle = await resizer.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();
  if (handle !== null) {
    await page.mouse.move(handle.x + 8, handle.y + 8);
    await page.mouse.down();
    await page.mouse.move(handle.x + 88, handle.y + 68, { steps: 4 });
    await page.mouse.up();
  }
  const after = await floating.boundingBox();
  expect((after?.width ?? 0) - (movedAfterKeyboard?.width ?? 0)).toBeGreaterThan(60);
  expect((after?.height ?? 0) - (movedAfterKeyboard?.height ?? 0)).toBeGreaterThan(45);

  await page.getByRole('button', { name: '停靠底部' }).click();
  await expect(floating).toHaveCount(0);
  await expect(page.getByTestId('agent-pane')).toBeVisible();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'saveAgentPaneView',
        view: expect.objectContaining({ mode: 'floating' }),
      }),
      expect.objectContaining({
        type: 'saveAgentPaneView',
        view: expect.objectContaining({ mode: 'docked' }),
      }),
    ]),
  );
});

test('空地图配置 MCP 与 hook，并在原生终端启动首次建图', async ({ page }) => {
  await page.goto('/?empty=1');
  await expect(
    page.getByRole('heading', { name: '让 Agent 基于代码事实创建第一版地图' }),
  ).toBeVisible();
  await expect(page.getByText('等待归类').locator('..')).toContainText('3');

  await expect(page.getByRole('button', { name: '✓ Codex' })).toBeVisible();
  await expect(page.getByText('✓ 当前工作区已配置并复验')).toBeVisible();
  await page.getByRole('button', { name: '配置 Claude Code' }).click();
  await expect(page.getByRole('button', { name: '✓ Claude Code' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Claude Code/u })).toBeChecked();
  await page.getByRole('radio', { name: /Codex CLI/u }).check();
  await expect(page.getByRole('radio', { name: /Codex CLI/u })).toBeChecked();
  await page.getByRole('button', { name: '在原生终端启动首次建图' }).click();
  await expect(page.getByText(/已有 Agent 会话不会热加载新配置/u)).toBeVisible();
  await page.getByRole('button', { name: '复制手动任务' }).click();
  await page.getByRole('button', { name: '复制手动接入命令' }).click();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([
      { type: 'configureAgent', agent: 'claude-code' },
      { type: 'startInitialization', agent: 'codex' },
      { type: 'generateAgentTask' },
      { type: 'copyAgentSetup' },
    ]),
  );
});

test('搜索、定位、聚焦并返回源码命令形成完整浏览链路', async ({ page }) => {
  await page.getByRole('searchbox', { name: '搜索节点' }).fill('Orders');
  await expect(page.getByRole('heading', { name: '搜索结果（1）' })).toBeVisible();
  await page.getByRole('button', { name: /Orders/u }).click();

  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  await expect(page.getByText('Validates and persists customer orders.')).toBeVisible();
  await page.getByRole('button', { name: 'src/orders/index.ts', exact: true }).first().click();
  await page.getByRole('button', { name: '只看相关模块' }).click();
  await expect(page.getByRole('button', { name: '相关 1 层' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '当前地图视图' })).toContainText('局部视图');
  await page
    .getByRole('navigation', { name: '当前地图视图' })
    .getByRole('button', { name: '返回模块关系图' })
    .click();
  await expect(page.getByRole('navigation', { name: '当前地图视图' })).toContainText('模块关系图');
  await expect(page.getByRole('button', { name: '相关 1 层' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '详情' })).toHaveCount(0);
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({ type: 'openSource', path: 'src/orders/index.ts' });
});

test('详情作为可关闭浮层，不改变画布尺寸', async ({ page }) => {
  const canvas = page.getByRole('application', { name: '项目地图' });
  const before = await canvas.boundingBox();
  await page.getByRole('searchbox', { name: '搜索节点' }).fill('Orders');
  await page.getByRole('button', { name: /Orders/u }).click();
  const after = await canvas.boundingBox();

  expect(after).toEqual(before);
  await expect(page.getByRole('complementary', { name: '详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByRole('complementary', { name: '详情' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: '搜索节点' })).toHaveValue('');
});

test('切换层级使用可中断的连续动画，而不是让模块瞬间消失出现', async ({ page }) => {
  await page.goto('/?levels=1');
  const canvas = page.getByRole('application', { name: '项目地图' });
  await expect(canvas).toHaveAttribute('aria-busy', 'false');

  await page.getByRole('radio', { name: '分组概览' }).click();
  await expect(canvas).toHaveAttribute('aria-busy', 'true');
  // 动画尚未完成时切到另一层，必须从当前画面接管而不是排队。
  await page.getByRole('radio', { name: '文件关系图' }).click();
  await expect(canvas).toHaveAttribute('aria-busy', 'false', { timeout: 2000 });
  await expect(canvas).toHaveAttribute('data-visible-nodes', '5');
  await expect(canvas).toHaveAttribute('data-visible-edges', '2');
  await expect(page.getByRole('navigation', { name: '当前地图视图' })).toContainText('文件关系图');
});

test('没有分组或文件节点时提供 AI 增量补全入口', async ({ page }) => {
  await expect(page.getByRole('radio', { name: '模块关系图' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '分组概览' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '文件关系图' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '＋ AI 补全分组层级' })).toBeVisible();
  await expect(page.getByRole('button', { name: '＋ AI 补全关键文件关系' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '当前地图视图' })).toContainText(
    '点击模块可在右侧查看职责、文件路径和标注',
  );

  await page.getByRole('button', { name: '＋ AI 补全关键文件关系' }).click();
  await expect(page.getByRole('region', { name: '原生项目 Agent' })).toContainText(
    '对话、权限与恢复由官方终端处理',
  );
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({
    type: 'startMapCompletion',
    agent: 'codex',
    target: 'files',
  });
});

test('点击模块后保留全图并恢复所有关系可见性', async ({ page }) => {
  const canvas = page.getByRole('application', { name: '项目地图' });
  await page.getByRole('searchbox', { name: '搜索节点' }).fill('Orders');
  await page.getByRole('button', { name: /Orders/u }).click();

  await expect(canvas).toHaveAttribute('data-rendered-nodes', '3');
  await expect(canvas).toHaveAttribute('data-visible-nodes', '3');
  await expect(canvas).toHaveAttribute('data-rendered-edges', '2');
  await expect(canvas).toHaveAttribute('data-visible-edges', '2');
  await expect(page.getByText('当前绘制 3 个节点 · 2 根连线')).toBeVisible();
});

test('真实密集拓扑在点击和连续重绘后仍显示全部模块与连线', async ({ page }) => {
  await page.goto('/?dense=1');
  const canvas = page.getByRole('application', { name: '项目地图' });
  await expect(canvas).toHaveAttribute('data-rendered-nodes', '9');
  await expect(canvas).toHaveAttribute('data-visible-nodes', '9');
  await expect(canvas).toHaveAttribute('data-rendered-edges', '26');
  await expect(canvas).toHaveAttribute('data-visible-edges', '26');
  await expect(canvas).toHaveAttribute('data-node-overlaps', '0');
  await expect(canvas).toHaveAttribute('data-module-colors', '9');
  await expect(canvas).toHaveAttribute('data-inline-edge-labels', 'false');
  await expect(canvas).not.toHaveAttribute('data-edge-bridges', '0');
  await expect(page.getByText('当前绘制 9 个节点 · 26 根连线（汇总 28 条关系）')).toBeVisible();

  await page.getByRole('searchbox', { name: '搜索节点' }).fill('测试');
  await page.getByRole('button', { name: /测试、交付与项目知识/u }).click();
  await page.getByRole('button', { name: '拓扑排序' }).click();
  await expect(canvas).toHaveAttribute('aria-busy', 'false', { timeout: 2_000 });
  await expect(canvas).toHaveAttribute('data-visible-nodes', '9');
  await expect(canvas).toHaveAttribute('data-visible-edges', '26');
  await expect(canvas).toHaveAttribute('data-node-overlaps', '0');
});

test('模块高亮不再批量绘制黑色关系标签背景', async ({ page }) => {
  await page.goto('/?dense=1');
  const canvas = page.getByRole('application', { name: '项目地图' });
  await expect(canvas).toHaveAttribute('data-inline-edge-labels', 'false');

  const cytoscapeCanvas = page.locator('.canvas__surface canvas').last();
  const box = await cytoscapeCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

  // 模块悬停只高亮关系；关系说明只能由单根线触发独立 tooltip。
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-visible-edges', '26');
});

test('拖动模块后重新布线仍保留全部模块与关系', async ({ page }) => {
  await page.goto('/?dense=1');
  const canvas = page.getByRole('application', { name: '项目地图' });
  await expect(canvas).toHaveAttribute('data-visible-edges', '26');

  const movable = page.locator('.canvas__surface canvas').last();
  const box = await movable.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  // 从真实画布中的模块中心拖动，触发 Cytoscape dragfreeon 与完整线路重算。
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.29);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.4, { steps: 10 });
  await page.mouse.up();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'saveLayout' })]),
  );
  await expect(canvas).toHaveAttribute('data-rendered-nodes', '9');
  await expect(canvas).toHaveAttribute('data-visible-nodes', '9');
  await expect(canvas).toHaveAttribute('data-rendered-edges', '26');
  await expect(canvas).toHaveAttribute('data-visible-edges', '26');
});

test('拓扑排序整理手工坐标、保存结果并保持线路避障', async ({ page }) => {
  await page.goto('/?dense=1');
  const canvas = page.getByRole('application', { name: '项目地图' });
  const crossingsBefore = Number(await canvas.getAttribute('data-edge-crossings'));
  await expect(page.getByRole('button', { name: '拓扑排序' })).toBeVisible();
  await page.getByRole('button', { name: '拓扑排序' }).click();

  await expect(canvas).toHaveAttribute('data-topology-revision', '1', { timeout: 2_000 });
  await expect(canvas).toHaveAttribute('aria-busy', 'false', { timeout: 2_000 });
  await expect(canvas).toHaveAttribute('data-visible-nodes', '9');
  await expect(canvas).toHaveAttribute('data-visible-edges', '26');
  await expect(canvas).toHaveAttribute('data-edge-node-intersections', '0');
  await expect(canvas).toHaveAttribute('data-edge-overlapping-pairs', '0');
  await expect(canvas).toHaveAttribute('data-node-overlaps', '0');
  const crossings = Number(await canvas.getAttribute('data-edge-crossings'));
  const bridges = Number(await canvas.getAttribute('data-edge-bridges'));
  expect(crossings).toBeLessThanOrEqual(40);
  expect(bridges).toBeGreaterThan(0);
  expect(crossingsBefore).toBeGreaterThanOrEqual(0);
  await expect(page.getByLabel('关系线说明')).toContainText('箭头指向被调用或依赖方');
  await expect(page.getByLabel('关系线说明')).toContainText('拱桥表示交叉但不相连');

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'saveLayout' })]),
  );
});

test('已有地图可由当前 Agent 重新初始化，并保留地图直到重绘完成', async ({ page }) => {
  await expect(page.getByRole('button', { name: '重新初始化' })).toBeVisible();
  await page.getByRole('button', { name: '重新初始化' }).click();
  await expect(page.getByRole('application', { name: '项目地图' })).toBeVisible();
  await expect(page.getByRole('region', { name: '原生项目 Agent' })).toBeVisible();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({ type: 'startReinitialization', agent: 'codex' });
});

test('地图与 Agent 输出视窗可拖动和键盘调整，并保存用户高度', async ({ page }) => {
  await page.getByRole('button', { name: '重新初始化' }).click();
  const separator = page.getByRole('separator', { name: '调整地图与 Agent 输出的高度' });
  const pane = page.getByTestId('agent-pane');
  const canvas = page.getByRole('application', { name: '项目地图' });
  const graphSummary = page.getByText(/当前绘制 \d+ 个节点 · \d+ 根连线/u);
  await expect(separator).toBeVisible();
  const summaryBefore = await graphSummary.textContent();

  const paneBefore = await pane.boundingBox();
  const canvasBefore = await canvas.boundingBox();
  const handle = await separator.boundingBox();
  expect(paneBefore).not.toBeNull();
  expect(canvasBefore).not.toBeNull();
  expect(handle).not.toBeNull();
  if (handle === null) return;

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 5 });
  await page.mouse.up();

  const paneAfter = await pane.boundingBox();
  const canvasAfter = await canvas.boundingBox();
  expect((paneAfter?.height ?? 0) - (paneBefore?.height ?? 0)).toBeGreaterThan(80);
  expect((canvasBefore?.height ?? 0) - (canvasAfter?.height ?? 0)).toBeGreaterThan(80);
  await expect(graphSummary).toHaveText(summaryBefore ?? '');

  await separator.focus();
  await page.keyboard.press('ArrowDown');
  await expect(separator).toHaveAttribute(
    'aria-valuenow',
    String(Math.round((paneAfter?.height ?? 0) - 24)),
  );
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'saveAgentPaneHeight' })]),
  );
});

test('关键界面无 axe critical 或 serious 问题', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking).toEqual([]);
});

test('键盘可依次到达层级、搜索和画布操作', async ({ page }) => {
  await page.goto('/?levels=1');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '分组概览' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '模块关系图' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '文件关系图' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: '搜索节点' })).toBeFocused();
});

test('讲解可播放、暂停、切换速度、逐步导航和退出', async ({ page }) => {
  await page.getByRole('button', { name: /30 秒认识项目：从入口到支付/u }).click();
  await expect(page.getByRole('region', { name: '讲解播放器' })).toContainText('第 1 / 3 步');
  await expect(page.getByText('请求从 API 入口进入')).toBeVisible();

  await page.getByRole('button', { name: '暂停' }).click();
  await page.getByLabel('讲解速度').selectOption('2');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('region', { name: '讲解播放器' })).toContainText('第 2 / 3 步');
  await page.getByRole('button', { name: '重播' }).click();
  await expect(page.getByRole('region', { name: '讲解播放器' })).toContainText('第 1 / 3 步');
  await page.getByRole('button', { name: '退出讲解' }).click();
  await expect(page.getByRole('region', { name: '项目讲解' })).toBeVisible();
});

test('仅凭 MCP 地图补丁即可暂停、逐步并回放 AI 对画布的调整', async ({ page }) => {
  await page.evaluate(() => {
    const harness = window as unknown as {
      __godViewSnapshot: {
        document: { revision: number; nodes: Record<string, unknown>[] };
      };
    };
    const orders = harness.__godViewSnapshot.document.nodes.find(
      (node) => node['id'] === 'module.orders',
    );
    if (orders === undefined) throw new Error('fixture 缺少 Orders 节点');
    for (const responsibility of ['AI 调整第一步', 'AI 调整第二步']) {
      harness.__godViewSnapshot.document.revision += 1;
      const updated = {
        ...orders,
        responsibility,
        revision: harness.__godViewSnapshot.document.revision,
      };
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'map/patch',
            revision: harness.__godViewSnapshot.document.revision,
            factsRevision: 1,
            patch: {
              upsertedNodes: [updated],
              upsertedEdges: [],
              removedNodeIds: [],
              removedEdgeIds: [],
            },
            drift: [],
          },
        }),
      );
    }
  });

  const timeline = page.getByRole('region', { name: '地图变更时间线' });
  await expect(timeline).toContainText('权威 r5');
  await timeline.getByRole('button', { name: '暂停' }).click();
  await timeline.getByRole('button', { name: '下一步' }).click();
  await expect(timeline).toContainText('画面 r4');
  await timeline.getByRole('button', { name: '跳到最新' }).click();
  await expect(timeline).toContainText('画面 r5');
  await timeline.getByRole('button', { name: '回放画布调整' }).click();
  await expect(timeline).toContainText('正在回放画布调整');
  await expect(timeline).toContainText('画面 r3');
});

test('创建解释标注、预览上下文、接收安全答案并解决', async ({ page }) => {
  await page.getByRole('searchbox', { name: '搜索节点' }).fill('Orders');
  await page.getByRole('button', { name: /Orders/u }).click();
  await expect(page.getByRole('heading', { name: '原位标注' })).toBeVisible();
  await expect(page.getByText(/随标注发送的路径/u)).toBeVisible();
  await page.getByRole('button', { name: '创建解释标注' }).click();
  await expect(page.getByRole('alert')).toContainText('请先写下');
  await expect(page.getByLabel('内容')).toBeFocused();
  await page.getByLabel('内容').fill('为什么订单依赖支付？');
  await page.getByRole('button', { name: '创建解释标注' }).click();
  await expect(page.getByText(/标注已创建；已配置 Agent 时会发送到官方终端/u)).toBeVisible();
  await expect(page.getByText('为什么订单依赖支付？')).toBeVisible();
  await expect(page.getByText('<script>alert(1)</script> 支付授权在订单确认前完成。')).toBeVisible({
    timeout: 2_000,
  });
  // 页面固定只有三个专用 harness、宿主 harness 与应用入口；答案中的标签必须作为文本，不能生成额外脚本节点。
  expect(await page.locator('script').count()).toBe(5);
  await page.getByText('详情与证据').click();
  await expect(
    page
      .getByRole('region', { name: '标注线程（1）' })
      .getByRole('button', { name: 'src/orders/index.ts:12' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '标记已解决' }).click();
  await expect(page.locator('.annotation-thread[data-status="resolved"]')).toBeVisible();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'createAnnotation',
        annotationType: 'explain',
        nodeIds: ['module.orders'],
        autoAnswerAgent: 'codex',
      }),
      { type: 'resolveAnnotation', annotationId: 'annotation.e2e' },
    ]),
  );
});

test('修改方案批准后交给原生 Agent，并由 MCP 同步模块关系视图', async ({ page }) => {
  await page.getByRole('searchbox', { name: '搜索节点' }).fill('Orders');
  await page.getByRole('button', { name: /Orders/u }).click();
  await page.evaluate(() => {
    const timestamp = '2026-08-11T00:00:00.000Z';
    const harness = window as unknown as {
      __godViewSnapshot: {
        document: {
          revision: number;
          annotations: unknown[];
          writeAccessRequests: unknown[];
          changeProposals: unknown[];
        };
      };
    };
    const annotation = {
      id: 'annotation.change',
      type: 'change',
      status: 'plan_proposed',
      target: { nodeIds: ['module.orders'], mapRevision: 3 },
      messages: [
        { id: 'question.change', author: 'user', body: '优化订单校验', createdAt: timestamp },
      ],
      createdAt: timestamp,
    };
    const request = {
      id: 'request.change',
      annotationId: 'annotation.change',
      status: 'converted',
      reason: '需要修改订单校验',
      expectedScope: ['src/orders/index.ts', 'src/orders/index.test.ts'],
      requestedAt: timestamp,
    };
    const proposal = {
      id: 'proposal.change',
      annotationId: 'annotation.change',
      requestId: 'request.change',
      status: 'proposed',
      summary: '优化订单校验并补测试',
      plannedFiles: ['src/orders/index.ts', 'src/orders/index.test.ts'],
      structuralChanges: ['更新订单模块'],
      risks: ['边界条件回归'],
      validationPlan: ['运行订单测试'],
      branchKey: 'main',
      baseMapRevision: 3,
      baseGitRevision: 'head-e2e',
      createdAt: timestamp,
    };
    harness.__godViewSnapshot.document.annotations = [annotation];
    harness.__godViewSnapshot.document.writeAccessRequests = [request];
    harness.__godViewSnapshot.document.changeProposals = [proposal];
    harness.__godViewSnapshot.document.revision = 4;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: 4,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedAnnotations: [annotation],
            upsertedWriteAccessRequests: [request],
            upsertedChangeProposals: [proposal],
          },
          drift: [],
        },
      }),
    );
  });
  const approval = page.getByRole('region', { name: '等待批准并实现' });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText('方案已准备好，等待你批准后交给原生 Agent');
  await expect(approval).toContainText('Agent 还没有修改代码');
  await expect(approval.getByRole('heading', { name: '修改方案' })).toBeVisible();
  await expect(page.getByText('请求本身没有授予写权限。')).toBeVisible();
  await approval.getByLabel('src/orders/index.test.ts').uncheck();
  await approval.getByRole('button', { name: '批准并开始实现' }).click();
  await expect(approval.getByText(/当前为 monitored 模式/u)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'ChangeSet Diff 审查' })).toContainText(
    'src/orders/index.ts',
  );
  await expect(page.getByRole('region', { name: '地图同步结果' })).toContainText('module.orders');
  await expect(page.getByRole('region', { name: '地图同步结果' })).toContainText(
    'edge.orders-payments',
  );
  await expect(page.getByText(/Validates orders, authorizes payment/u)).toBeVisible();
  await expect(page.getByRole('button', { name: /复制已批准任务/u })).toHaveCount(0);
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({
    type: 'approveProposal',
    proposalId: 'proposal.change',
    approvedScope: ['src/orders/index.ts'],
    autoStartAgent: 'codex',
  });
});

test('Diff 可打开原生比较并由用户验收，越界结果只能带问题接受', async ({ page }) => {
  await page.evaluate(() => {
    const timestamp = '2026-08-11T00:00:00.000Z';
    const harness = window as unknown as {
      __godViewSnapshot: {
        document: { revision: number; completedChanges: unknown[] };
      };
    };
    const completed = {
      changeSetId: 'change.clean',
      proposalId: 'proposal.clean',
      status: 'pending_review',
      completedAt: timestamp,
      plannedFiles: ['src/orders/index.ts'],
      actualFiles: ['src/orders/index.ts'],
      diff: {
        files: [
          {
            path: 'src/orders/index.ts',
            status: 'modified',
            additions: 4,
            deletions: 1,
            scopeStatus: 'approved',
            attribution: 'change_set',
          },
        ],
        additions: 4,
        deletions: 1,
        computedAt: timestamp,
        contentHash: 'a'.repeat(64),
      },
    };
    harness.__godViewSnapshot.document.completedChanges = [completed];
    harness.__godViewSnapshot.document.revision += 1;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: harness.__godViewSnapshot.document.revision,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedCompletedChanges: [completed],
          },
          drift: [],
        },
      }),
    );
  });
  await expect(page.getByRole('complementary', { name: 'ChangeSet Diff 审查' })).toBeVisible();
  await page.getByRole('button', { name: /src\/orders\/index\.ts/u }).click();
  await page.getByRole('button', { name: '接受结果' }).click();

  await page.evaluate(() => {
    const timestamp = '2026-08-11T00:01:00.000Z';
    const harness = window as unknown as {
      __godViewSnapshot: {
        document: { revision: number; completedChanges: unknown[] };
      };
    };
    const outside = {
      changeSetId: 'change.outside',
      proposalId: 'proposal.outside',
      status: 'pending_review',
      completedAt: timestamp,
      plannedFiles: ['src/orders/index.ts'],
      actualFiles: ['src/outside.ts'],
      diff: {
        files: [
          {
            path: 'src/outside.ts',
            status: 'added',
            additions: 1,
            deletions: 0,
            scopeStatus: 'outside_scope',
            attribution: 'change_set',
          },
        ],
        additions: 1,
        deletions: 0,
        computedAt: timestamp,
        contentHash: 'b'.repeat(64),
      },
    };
    harness.__godViewSnapshot.document.completedChanges.push(outside);
    harness.__godViewSnapshot.document.revision += 1;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: harness.__godViewSnapshot.document.revision,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedCompletedChanges: [outside],
          },
          drift: [],
        },
      }),
    );
  });
  await expect(page.getByRole('button', { name: '接受结果' })).toHaveCount(0);
  await page.getByText('ChangeSet 历史（2）').click();
  await page.getByRole('button', { name: /change\.clean.*已接受/u }).click();
  await expect(page.getByRole('button', { name: /src\/orders\/index\.ts/u })).toBeVisible();
  await page.getByRole('button', { name: /^change\.outside/u }).click();
  await page.getByRole('button', { name: '带问题接受' }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([
      { type: 'openDiff', path: 'src/orders/index.ts' },
      { type: 'reviewChange', changeSetId: 'change.clean', status: 'accepted' },
      {
        type: 'reviewChange',
        changeSetId: 'change.outside',
        status: 'accepted_with_issues',
        note: '用户确认保留当前 Diff，但验证仍有问题',
      },
    ]),
  );
});

test('任务前已有的范围外改动不误报越界，并允许正常接受结果', async ({ page }) => {
  await page.evaluate(() => {
    const timestamp = '2026-08-11T00:02:00.000Z';
    const harness = window as unknown as {
      __godViewSnapshot: {
        document: { revision: number; completedChanges: unknown[] };
      };
    };
    const completed = {
      changeSetId: 'change.preexisting-overlap',
      proposalId: 'proposal.preexisting-overlap',
      status: 'pending_review',
      completedAt: timestamp,
      plannedFiles: ['README.md'],
      actualFiles: ['README.md'],
      diff: {
        files: [
          {
            path: 'README.md',
            status: 'modified',
            additions: 12,
            deletions: 2,
            scopeStatus: 'approved',
            attribution: 'change_set',
          },
          {
            path: 'src/existing.ts',
            status: 'modified',
            additions: 0,
            deletions: 0,
            scopeStatus: 'outside_scope',
            attribution: 'preexisting_overlap',
          },
        ],
        additions: 12,
        deletions: 2,
        computedAt: timestamp,
        contentHash: 'c'.repeat(64),
      },
    };
    harness.__godViewSnapshot.document.completedChanges = [completed];
    harness.__godViewSnapshot.document.revision += 1;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: harness.__godViewSnapshot.document.revision,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedCompletedChanges: [completed],
          },
          drift: [],
        },
      }),
    );
  });

  const review = page.getByRole('complementary', { name: 'ChangeSet Diff 审查' });
  await expect(review).toContainText('README.md');
  await expect(review).toContainText('任务前已有 · 不影响本次验收');
  await expect(review.getByText(/src\/existing\.ts/u).locator('..')).not.toContainText('越界');
  const before = await review.boundingBox();
  const titlebar = review.getByRole('toolbar', { name: 'ChangeSet Diff 拖动标题栏' });
  const dragHandle = await titlebar.boundingBox();
  expect(before).not.toBeNull();
  expect(dragHandle).not.toBeNull();
  if (before !== null && dragHandle !== null) {
    await page.mouse.move(
      dragHandle.x + dragHandle.width / 2,
      dragHandle.y + dragHandle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dragHandle.x + dragHandle.width / 2 - 180,
      dragHandle.y + dragHandle.height / 2 - 100,
      { steps: 5 },
    );
    await page.mouse.up();
    const moved = await review.boundingBox();
    expect(before.x - (moved?.x ?? before.x)).toBeGreaterThan(150);
    expect(before.y - (moved?.y ?? before.y)).toBeGreaterThan(70);
  }
  const beforeKeyboard = await review.boundingBox();
  await titlebar.focus();
  await page.keyboard.press('ArrowRight');
  const afterKeyboard = await review.boundingBox();
  expect((afterKeyboard?.x ?? 0) - (beforeKeyboard?.x ?? 0)).toBeGreaterThanOrEqual(11);
  await review.getByRole('button', { name: '接受结果' }).click();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({
    type: 'reviewChange',
    changeSetId: 'change.preexisting-overlap',
    status: 'accepted',
  });
});

test('失败方案显示真实原因，并且只能通过重新批准来重试', async ({ page }) => {
  await page.evaluate(() => {
    const harness = window as unknown as {
      __godViewSnapshot: {
        document: {
          revision: number;
          changeProposals: unknown[];
          completedChanges: unknown[];
        };
      };
    };
    const proposal = {
      id: 'proposal.retry',
      annotationId: 'annotation.retry',
      requestId: 'request.retry',
      status: 'approved',
      summary: '重新执行博客修改',
      plannedFiles: ['src/retry.ts'],
      structuralChanges: [],
      risks: [],
      validationPlan: ['运行测试'],
      branchKey: 'main',
      baseMapRevision: 3,
      baseGitRevision: 'head-e2e',
      createdAt: '2026-08-11T00:00:00.000Z',
      approval: {
        token: 'approval-old',
        approvedScope: ['src/retry.ts'],
        permissionMode: 'monitored',
        approvedAt: '2026-08-11T00:01:00.000Z',
        expiresAt: '2026-08-11T00:16:00.000Z',
        branchKey: 'main',
        mapRevision: 4,
        gitRevision: 'head-e2e',
        preexistingChanges: [],
      },
    };
    const failed = {
      changeSetId: 'change.retry.failed',
      proposalId: 'proposal.retry',
      status: 'failed',
      completedAt: '2026-08-11T00:10:00.000Z',
      plannedFiles: ['src/retry.ts'],
      actualFiles: ['src/retry.ts'],
      diff: {
        files: [],
        additions: 0,
        deletions: 0,
        computedAt: '2026-08-11T00:10:00.000Z',
        contentHash: 'f'.repeat(64),
      },
      note: '测试失败：src/retry.ts 没有通过回归验证。',
    };
    harness.__godViewSnapshot.document.changeProposals = [proposal];
    harness.__godViewSnapshot.document.completedChanges = [failed];
    harness.__godViewSnapshot.document.revision += 1;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: harness.__godViewSnapshot.document.revision,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedChangeProposals: [proposal],
            upsertedCompletedChanges: [failed],
          },
          drift: [],
        },
      }),
    );
  });

  const approval = page.getByRole('region', { name: '等待批准并实现' });
  await expect(approval).toContainText('上次执行未成功，需要重新决定');
  await expect(approval).toContainText('测试失败：src/retry.ts 没有通过回归验证。');
  await expect(approval.getByRole('button', { name: '发送到原生 Agent 继续' })).toHaveCount(0);
  await approval.getByRole('button', { name: '重新批准并重试' }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({
    type: 'approveProposal',
    proposalId: 'proposal.retry',
    approvedScope: ['src/retry.ts'],
    autoStartAgent: 'codex',
  });
});

test('活动 ChangeSet 可由用户停止并保留当前 Diff', async ({ page }) => {
  await page.evaluate(() => {
    const timestamp = '2026-08-11T00:00:00.000Z';
    const harness = window as unknown as {
      __godViewSnapshot: { document: { revision: number; activeChanges: unknown[] } };
    };
    const active = {
      changeSetId: 'change.running',
      sessionId: 'codex',
      intent: '修改订单',
      startedAt: timestamp,
      touchedNodeIds: [],
      touchedEdgeIds: [],
      executionStatus: 'in_progress',
      diff: {
        files: [
          {
            path: 'src/orders/index.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
            scopeStatus: 'approved',
            attribution: 'change_set',
          },
        ],
        additions: 1,
        deletions: 0,
        computedAt: timestamp,
        contentHash: 'c'.repeat(64),
      },
    };
    harness.__godViewSnapshot.document.activeChanges = [active];
    harness.__godViewSnapshot.document.revision += 1;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'map/patch',
          revision: harness.__godViewSnapshot.document.revision,
          factsRevision: 1,
          patch: {
            upsertedNodes: [],
            upsertedEdges: [],
            removedNodeIds: [],
            removedEdgeIds: [],
            upsertedActiveChanges: [active],
          },
          drift: [],
        },
      }),
    );
  });
  await expect(page.getByRole('button', { name: '重新初始化' })).toBeDisabled();
  await page.getByRole('button', { name: '停止并保留 Diff' }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({ type: 'interruptChange', changeSetId: 'change.running' });
});
