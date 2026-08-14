import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Uri, workspace } from 'vscode';
import { currentProtocolVersion, type GodViewEvent } from '@god-view/protocol';
import { createService, deliver, identity, watchUpdates, workspaceRoot } from './harness.js';

const run = promisify(execFile);

describe('修改方案、用户批准与授权 ChangeSet 完整宿主链路', () => {
  it('批准前不创建 ChangeSet，宿主签发令牌后有效 start 才创建一个', async function () {
    this.timeout(30000);
    const root = workspaceRoot();
    try {
      await workspace.fs.delete(Uri.joinPath(root, '.git'), { recursive: true });
    } catch {
      // 临时夹具通常没有 .git；删除仅用于处理本地夹具残留的未初始化仓库。
    }
    await run('git', ['init'], { cwd: root.fsPath });
    await run('git', ['config', 'user.email', 'god-view@example.invalid'], { cwd: root.fsPath });
    await run('git', ['config', 'user.name', 'God View Test'], { cwd: root.fsPath });
    await run('git', ['add', '-A'], { cwd: root.fsPath });
    await run('git', ['commit', '-m', 'fixture'], { cwd: root.fsPath });
    const { stdout: headOutput } = await run('git', ['rev-parse', 'HEAD'], { cwd: root.fsPath });
    const head = headOutput.trim();
    const { stdout: branchOutput } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root.fsPath,
    });
    const branchKey = branchOutput.trim();

    const service = await createService();
    const { id: workspaceId } = identity();
    const baseEnvelope = (eventId: string) => ({
      version: currentProtocolVersion,
      workspaceId,
      branchKey,
      sessionId: 'itest-proposal',
      eventId,
      timestamp: new Date().toISOString(),
      actor: { kind: 'agent' as const, adapterId: 'itest' },
    });
    const node: GodViewEvent = {
      ...baseEnvelope('itest.proposal.node'),
      type: 'node_upsert',
      payload: {
        node: { id: 'orders', type: 'module', label: 'Orders', paths: ['src/orders/index.ts'] },
      },
    };
    await deliver([node]);
    await service.open();
    const waiter = watchUpdates(service);
    try {
      const annotationId = await service.createAnnotation({
        annotationType: 'risk',
        body: '请修正订单校验风险',
        nodeIds: ['orders'],
      });
      assert.ok(annotationId);
      const request: GodViewEvent = {
        ...baseEnvelope('itest.proposal.request'),
        type: 'write_access_requested',
        payload: {
          request: {
            id: 'request.orders',
            annotationId,
            status: 'requested',
            reason: '需要修改订单校验',
            expectedScope: ['src/orders/index.ts'],
            requestedAt: new Date().toISOString(),
          },
        },
      };
      const requestUpdate = waiter.next(
        (update) => (update.patch.upsertedWriteAccessRequests?.length ?? 0) === 1,
        '写入请求应发布到 Webview',
      );
      await deliver([request]);
      await requestUpdate;
      const proposalBaseline = service.snapshot.revision;
      const proposal: GodViewEvent = {
        ...baseEnvelope('itest.proposal.plan'),
        type: 'change_proposal',
        payload: {
          proposal: {
            id: 'proposal.orders',
            annotationId,
            requestId: 'request.orders',
            status: 'proposed',
            summary: '修正订单校验',
            plannedFiles: ['src/orders/index.ts'],
            structuralChanges: ['更新订单模块'],
            risks: ['校验兼容性'],
            validationPlan: ['运行订单测试'],
            branchKey,
            baseMapRevision: proposalBaseline,
            baseGitRevision: head,
            createdAt: new Date().toISOString(),
          },
        },
      };
      const proposalUpdate = waiter.next(
        (update) => update.patch.upsertedChangeProposals?.[0]?.status === 'proposed',
        '修改方案应发布到 Webview',
      );
      await deliver([proposal]);
      await proposalUpdate;
      assert.equal(service.snapshot.activeChanges.size, 0, '请求和方案不能产生写授权');

      const approvalUpdate = waiter.next(
        (update) => update.patch.upsertedChangeProposals?.[0]?.status === 'approved',
        '用户批准应发布带令牌的方案补丁',
      );
      const approved = await service.approveProposal('proposal.orders', ['src/orders/index.ts']);
      assert.ok(approved.ok);
      await approvalUpdate;
      const approval = service.snapshot.changeProposals.get('proposal.orders')?.approval;
      assert.ok(approval);
      assert.equal(approval.token, approved.token);
      assert.equal(approval.permissionMode, 'monitored');
      assert.equal(service.snapshot.activeChanges.size, 0, '批准后仍需 Agent 显式启动 ChangeSet');

      const start: GodViewEvent = {
        ...baseEnvelope('itest.proposal.start'),
        baseMapRevision: proposalBaseline + 1,
        type: 'change_start',
        payload: {
          changeSetId: 'change.orders',
          intent: '修正订单校验',
          plannedFiles: ['src/orders/index.ts'],
          proposalId: 'proposal.orders',
          approvalToken: approved.token,
        },
      };
      const startUpdate = waiter.next(
        (update) => update.patch.upsertedActiveChanges?.[0]?.changeSetId === 'change.orders',
        '授权 start 应发布活动 ChangeSet',
      );
      await deliver([start]);
      await startUpdate;
      assert.equal(service.snapshot.activeChanges.size, 1);
      assert.deepEqual(service.snapshot.activeChanges.get('change.orders')?.approvedScope, [
        'src/orders/index.ts',
      ]);

      const expansion: GodViewEvent = {
        ...baseEnvelope('itest.proposal.expand-tests'),
        baseMapRevision: service.snapshot.revision,
        type: 'scope_expansion_requested',
        payload: {
          request: {
            id: 'scope.orders-tests',
            changeSetId: 'change.orders',
            sessionId: 'itest-proposal',
            requestedFiles: ['src/orders.test.ts'],
            reason: '需要补充订单回归测试',
            status: 'pending',
            requestedAt: new Date().toISOString(),
          },
        },
      };
      const expansionUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.scopeExpansionRequests?.[0]?.status ===
          'pending',
        'Agent 扩围申请应先进入待用户决定状态',
      );
      await deliver([expansion]);
      await expansionUpdate;
      assert.deepEqual(service.snapshot.activeChanges.get('change.orders')?.approvedScope, [
        'src/orders/index.ts',
      ]);

      const approvedExpansionUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.scopeExpansionRequests?.[0]?.status ===
          'approved',
        '宿主记录用户批准后才扩大范围',
      );
      assert.equal(
        await service.decideScopeExpansion('change.orders', 'scope.orders-tests', 'approved'),
        true,
      );
      await approvedExpansionUpdate;
      assert.deepEqual(service.snapshot.activeChanges.get('change.orders')?.approvedScope, [
        'src/orders.test.ts',
        'src/orders/index.ts',
      ]);

      const rejectedRequest: GodViewEvent = {
        ...baseEnvelope('itest.proposal.expand-rejected'),
        baseMapRevision: service.snapshot.revision,
        type: 'scope_expansion_requested',
        payload: {
          request: {
            id: 'scope.orders-rejected',
            changeSetId: 'change.orders',
            sessionId: 'itest-proposal',
            requestedFiles: ['src/rejected.ts'],
            reason: '尝试修改额外辅助文件',
            status: 'pending',
            requestedAt: new Date().toISOString(),
          },
        },
      };
      const rejectedRequestUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.scopeExpansionRequests?.[1]?.status ===
          'pending',
        '第二次扩围申请应独立等待决定',
      );
      await deliver([rejectedRequest]);
      await rejectedRequestUpdate;
      const rejectedExpansionUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.scopeExpansionRequests?.[1]?.status ===
          'rejected',
        '拒绝应保留审计记录但不扩大范围',
      );
      assert.equal(
        await service.decideScopeExpansion('change.orders', 'scope.orders-rejected', 'rejected'),
        true,
      );
      await rejectedExpansionUpdate;
      assert.equal(
        service.snapshot.activeChanges
          .get('change.orders')
          ?.approvedScope?.includes('src/rejected.ts'),
        false,
      );
      const diffUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.diff?.files.some(
            (file) => file.path === 'src/orders/index.ts',
          ) === true,
        '批准范围内写入应生成 Diff 摘要',
      );
      await workspace.fs.writeFile(
        Uri.joinPath(root, 'src/orders/index.ts'),
        Buffer.from('export function createOrder() { return { validated: true }; }\n', 'utf8'),
      );
      const observed = await diffUpdate;
      const changed = observed.patch.upsertedActiveChanges?.[0];
      assert.ok(changed?.diff);
      assert.equal(changed.executionStatus, 'in_progress');
      assert.equal(changed.diff.files[0]?.scopeStatus, 'approved');
      assert.ok(changed.diff.additions > 0);

      const violationUpdate = waiter.next(
        (update) => update.patch.upsertedActiveChanges?.[0]?.executionStatus === 'scope_violation',
        '批准范围外写入应使 ChangeSet 进入 scope_violation',
      );
      await workspace.fs.writeFile(
        Uri.joinPath(root, 'src/outside.ts'),
        Buffer.from('export const outside = true;\n', 'utf8'),
      );
      const violation = await violationUpdate;
      assert.ok(
        violation.patch.upsertedActiveChanges?.[0]?.diff?.files.some(
          (file) => file.path === 'src/outside.ts' && file.scopeStatus === 'outside_scope',
        ),
      );
      const recoveredUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.executionStatus === 'in_progress' &&
          update.patch.upsertedActiveChanges[0].diff?.files.every(
            (file) => file.scopeStatus === 'approved',
          ) === true,
        '删除越界文件后 ChangeSet 应恢复到可完成状态',
      );
      await workspace.fs.delete(Uri.joinPath(root, 'src/outside.ts'));
      await recoveredUpdate;

      const complete: GodViewEvent = {
        ...baseEnvelope('itest.proposal.complete'),
        type: 'change_complete',
        payload: {
          changeSetId: 'change.orders',
          status: 'completed',
          actualFiles: ['src/orders/index.ts'],
        },
      };
      const completionUpdate = waiter.next(
        (update) => update.patch.upsertedCompletedChanges?.[0]?.status === 'pending_review',
        '完成事件应发布待用户验收的持久化 Diff',
      );
      await deliver([complete]);
      await completionUpdate;
      assert.equal(service.snapshot.activeChanges.size, 0);
      assert.equal(
        service.snapshot.completedChanges.get('change.orders')?.status,
        'pending_review',
      );

      const { stdout: headBeforeReview } = await run('git', ['rev-parse', 'HEAD'], {
        cwd: root.fsPath,
      });
      const { stdout: indexBeforeReview } = await run('git', ['diff', '--cached', '--name-only'], {
        cwd: root.fsPath,
      });
      const reviewUpdate = waiter.next(
        (update) => update.patch.upsertedCompletedChanges?.[0]?.status === 'accepted',
        '用户验收应发布 accepted 状态',
      );
      assert.equal(await service.reviewChange('change.orders', 'accepted'), true);
      await reviewUpdate;
      assert.equal(service.snapshot.completedChanges.get('change.orders')?.status, 'accepted');
      const { stdout: headAfterReview } = await run('git', ['rev-parse', 'HEAD'], {
        cwd: root.fsPath,
      });
      const { stdout: indexAfterReview } = await run('git', ['diff', '--cached', '--name-only'], {
        cwd: root.fsPath,
      });
      assert.equal(headAfterReview, headBeforeReview, '用户验收不得创建 Git commit');
      assert.equal(indexAfterReview, indexBeforeReview, '用户验收不得执行 Git add');
      await service.flush();
      assert.equal(service.toDocument().completedChanges?.[0]?.status, 'accepted');

      const userInterruptedStart: GodViewEvent = {
        ...baseEnvelope('itest.interruption.user-start'),
        type: 'change_start',
        payload: {
          changeSetId: 'change.user-interrupted',
          intent: '验证用户可以停止没有 proposal/diff 的旧式 ChangeSet',
        },
      };
      const userInterruptionStartUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.changeSetId === 'change.user-interrupted',
        '用户中断回归的 ChangeSet 应先启动',
      );
      await deliver([userInterruptedStart]);
      await userInterruptionStartUpdate;
      assert.equal(
        await service.interruptChange('change.user-interrupted'),
        true,
        '没有 CompletedChange 记录时也应按活动项消失报告中断成功',
      );
      assert.equal(service.snapshot.activeChanges.size, 0);

      const interruptedStart: GodViewEvent = {
        ...baseEnvelope('itest.interruption.start'),
        type: 'change_start',
        payload: {
          changeSetId: 'change.interrupted-by-checkout',
          intent: '验证分支切换不会把活动 ChangeSet 带到另一个分支',
          plannedFiles: ['src/orders/index.ts'],
        },
      };
      const interruptionStartUpdate = waiter.next(
        (update) =>
          update.patch.upsertedActiveChanges?.[0]?.changeSetId === 'change.interrupted-by-checkout',
        '分支切换回归的 ChangeSet 应先在原分支启动',
      );
      await deliver([interruptedStart]);
      await interruptionStartUpdate;
      assert.ok(service.snapshot.activeChanges.has('change.interrupted-by-checkout'));

      await run('git', ['checkout', '-b', 'feature/interruption'], { cwd: root.fsPath });
      await service.syncBranch();
      assert.equal(service.snapshot.branchKey, 'feature/interruption');
      assert.equal(service.snapshot.activeChanges.size, 0, '新分支不得继承原分支的活动 ChangeSet');

      await run('git', ['checkout', branchKey], { cwd: root.fsPath });
      await service.syncBranch();
      assert.equal(service.snapshot.branchKey, branchKey);
      assert.equal(
        service.snapshot.activeChanges.size,
        0,
        '返回原分支后活动 ChangeSet 应保持 interrupted，证明中断写入了旧分支日志',
      );
      await service.flush();
    } finally {
      waiter.dispose();
      service.dispose();
      await workspace.fs.delete(Uri.joinPath(root, '.godview'), { recursive: true });
      await workspace.fs.delete(Uri.joinPath(root, '.git'), { recursive: true });
    }
  });
});
