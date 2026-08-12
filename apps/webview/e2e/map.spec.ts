import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('application', { name: '项目地图' })).toBeVisible();
});

test('空地图可配置两种 Agent，并保留任务与手动接入入口', async ({ page }) => {
  await page.goto('/?empty=1');
  await expect(
    page.getByRole('heading', { name: '让 Agent 基于代码事实创建第一版地图' }),
  ).toBeVisible();
  await expect(page.getByText('等待归类').locator('..')).toContainText('3');

  await page.getByRole('button', { name: '配置 Claude Code' }).click();
  await page.getByRole('button', { name: '配置 Codex' }).click();
  await page.getByRole('button', { name: '生成初始化任务' }).click();
  await page.getByRole('button', { name: '复制手动接入命令' }).click();

  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toEqual(
    expect.arrayContaining([
      { type: 'configureAgent', agent: 'claude-code' },
      { type: 'configureAgent', agent: 'codex' },
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
  await page.getByRole('button', { name: '聚焦邻域' }).click();
  await expect(page.getByRole('button', { name: '1 层邻域' })).toBeVisible();

  await page.getByRole('button', { name: 'src/orders/index.ts', exact: true }).first().click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({ type: 'openSource', path: 'src/orders/index.ts' });
});

test('关键界面无 axe critical 或 serious 问题', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking).toEqual([]);
});

test('键盘可依次到达层级、搜索和画布操作', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '远景 · 分组' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '中景 · 模块' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '近景 · 文件' })).toBeFocused();
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

test('创建解释标注、预览上下文、接收安全答案并解决', async ({ page }) => {
  await page.getByRole('searchbox', { name: '搜索节点' }).fill('Orders');
  await page.getByRole('button', { name: /Orders/u }).click();
  await expect(page.getByRole('heading', { name: '原位标注' })).toBeVisible();
  await expect(page.getByText('发送前预览（只含路径，不含源码）')).toBeVisible();
  await page.getByLabel('内容').fill('为什么订单依赖支付？');
  await page.getByRole('button', { name: '创建标注' }).click();
  await expect(page.getByText('为什么订单依赖支付？')).toBeVisible();

  await page.getByRole('button', { name: '复制解释任务' }).click();
  await expect(
    page.getByText('<script>alert(1)</script> 支付授权在订单确认前完成。'),
  ).toBeVisible();
  // 页面固定只有 harness 与应用两个外链脚本；答案中的标签必须作为文本，不能生成第三个脚本节点。
  expect(await page.locator('script').count()).toBe(2);
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
      }),
      { type: 'copyAnnotationTask', annotationId: 'annotation.e2e' },
      { type: 'resolveAnnotation', annotationId: 'annotation.e2e' },
    ]),
  );
});

test('修改方案可缩小范围、明确批准并交接授权任务', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: '修改方案' })).toBeVisible();
  await expect(page.getByText('请求本身没有授予写权限。')).toBeVisible();
  await page.getByLabel('src/orders/index.test.ts').uncheck();
  await page.getByRole('button', { name: '明确批准所选范围' }).click();
  await expect(page.getByText(/当前为 monitored 模式/u)).toBeVisible();
  await page.getByRole('button', { name: '复制已批准修改任务' }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({
    type: 'approveProposal',
    proposalId: 'proposal.change',
    approvedScope: ['src/orders/index.ts'],
  });
  expect(commands).toContainEqual({
    type: 'copyApprovedChangeTask',
    proposalId: 'proposal.change',
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
  await page.getByRole('button', { name: '停止并保留 Diff' }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __godViewCommands: unknown[] }).__godViewCommands,
  );
  expect(commands).toContainEqual({ type: 'interruptChange', changeSetId: 'change.running' });
});
