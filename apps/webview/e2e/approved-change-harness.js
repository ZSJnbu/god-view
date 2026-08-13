(() => {
  /* global setTimeout */
  function dispatch(data) {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  function patch(snapshot, update) {
    snapshot.document.revision += 1;
    dispatch({
      type: 'map/patch',
      revision: snapshot.document.revision,
      factsRevision: 1,
      patch: {
        upsertedNodes: [],
        upsertedEdges: [],
        removedNodeIds: [],
        removedEdgeIds: [],
        ...update,
      },
      drift: [],
    });
  }

  function run(command, snapshot, timestamp) {
    const proposal = snapshot.document.changeProposals.find(
      (item) => item.id === command.proposalId,
    );
    const annotation = snapshot.document.annotations.find(
      (item) => item.id === proposal?.annotationId,
    );
    if (proposal === undefined || annotation === undefined) return;
    dispatch({
      type: 'agent/run',
      run: {
        runId: 'approved-change-run-e2e',
        agent: command.agent ?? command.autoStartAgent,
        state: 'running',
        output: [
          'start_approved_change 已接受，开始修改批准范围。',
          '正在编辑 src/orders/index.ts…',
          '正在更新 Orders 模块和支付依赖关系…',
        ],
        detail: 'Agent 正在编辑代码、运行验证并同步项目视图…',
        restartRequired: false,
        purpose: 'approved_change',
        proposalId: proposal.id,
      },
    });
    const inProgress = { ...annotation, status: 'in_progress' };
    snapshot.document.annotations = [inProgress];
    patch(snapshot, { upsertedAnnotations: [inProgress] });
    setTimeout(() => {
      const completed = {
        changeSetId: 'change.approved.e2e',
        proposalId: proposal.id,
        status: 'pending_review',
        completedAt: timestamp,
        plannedFiles: proposal.approval.approvedScope,
        actualFiles: ['src/orders/index.ts'],
        touchedNodeIds: ['module.orders'],
        touchedEdgeIds: ['edge.orders-payments'],
        diff: {
          files: [
            {
              path: 'src/orders/index.ts',
              status: 'modified',
              additions: 8,
              deletions: 2,
              scopeStatus: 'approved',
              attribution: 'change_set',
            },
          ],
          additions: 8,
          deletions: 2,
          computedAt: timestamp,
          contentHash: 'a'.repeat(64),
        },
        note: '优化订单校验；已同步 Orders 模块和支付依赖关系。',
      };
      snapshot.document.completedChanges = [completed];
      const updatedNode = {
        ...snapshot.document.nodes.find((node) => node.id === 'module.orders'),
        responsibility: 'Validates orders, authorizes payment and persists accepted results.',
      };
      const updatedEdge = {
        ...snapshot.document.edges.find((edge) => edge.id === 'edge.orders-payments'),
        reason: 'Authorize payment after the strengthened order validation',
      };
      snapshot.document.nodes = snapshot.document.nodes.map((node) =>
        node.id === updatedNode.id ? updatedNode : node,
      );
      snapshot.document.edges = snapshot.document.edges.map((edge) =>
        edge.id === updatedEdge.id ? updatedEdge : edge,
      );
      patch(snapshot, {
        upsertedNodes: [updatedNode],
        upsertedEdges: [updatedEdge],
        upsertedCompletedChanges: [completed],
      });
      dispatch({
        type: 'agent/run',
        run: {
          runId: 'approved-change-run-e2e',
          agent: command.agent ?? command.autoStartAgent,
          state: 'completed',
          output: [
            'start_approved_change 已接受，开始修改批准范围。',
            '正在编辑 src/orders/index.ts…',
            '正在更新 Orders 模块和支付依赖关系…',
            '订单测试通过。',
            'complete_change 已接受；代码、模块和关系视图已同步。',
          ],
          detail: '批准后编辑已完成并通过最终复核；地图已刷新。',
          restartRequired: false,
          purpose: 'approved_change',
          proposalId: proposal.id,
        },
      });
    }, 30);
  }

  window.__godViewApprovedChangeHarness = {
    handle(command, snapshot, timestamp) {
      if (command.type === 'approveProposal') {
        const current = snapshot.document.changeProposals.find(
          (item) => item.id === command.proposalId,
        );
        if (current === undefined) return false;
        const approved = {
          ...current,
          status: 'approved',
          approval: {
            token: 'approval-e2e',
            approvedScope: command.approvedScope,
            permissionMode: 'monitored',
            approvedAt: timestamp,
            expiresAt: '2026-08-11T00:15:00.000Z',
            branchKey: 'main',
            mapRevision: snapshot.document.revision,
            gitRevision: 'head-e2e',
            preexistingChanges: [],
          },
        };
        snapshot.document.changeProposals = [approved];
        patch(snapshot, { upsertedChangeProposals: [approved] });
        if (command.autoStartAgent !== undefined) {
          setTimeout(() => run(command, snapshot, timestamp), 5);
        }
        return true;
      }
      if (command.type === 'startApprovedChange') {
        queueMicrotask(() => run(command, snapshot, timestamp));
        return true;
      }
      return false;
    },
  };
})();
