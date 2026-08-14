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
    if (proposal === undefined) return;
    const active = {
      changeSetId: 'change.approved.e2e',
      sessionId: 'native-agent-e2e',
      intent: proposal.summary,
      startedAt: timestamp,
      proposalId: proposal.id,
      approvalToken: proposal.approval?.token,
      approvedScope: proposal.approval?.approvedScope,
      permissionMode: 'monitored',
      touchedNodeIds: [],
      touchedEdgeIds: [],
      executionStatus: 'in_progress',
    };
    snapshot.document.activeChanges = [active];
    patch(snapshot, { upsertedActiveChanges: [active] });

    setTimeout(() => {
      const completed = {
        changeSetId: active.changeSetId,
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
      const updatedNode = {
        ...snapshot.document.nodes.find((node) => node.id === 'module.orders'),
        responsibility: 'Validates orders, authorizes payment and persists accepted results.',
      };
      const updatedEdge = {
        ...snapshot.document.edges.find((edge) => edge.id === 'edge.orders-payments'),
        reason: 'Authorize payment after the strengthened order validation',
      };
      snapshot.document.activeChanges = [];
      snapshot.document.completedChanges = [completed];
      snapshot.document.nodes = snapshot.document.nodes.map((node) =>
        node.id === updatedNode.id ? updatedNode : node,
      );
      snapshot.document.edges = snapshot.document.edges.map((edge) =>
        edge.id === updatedEdge.id ? updatedEdge : edge,
      );
      patch(snapshot, {
        upsertedNodes: [updatedNode],
        upsertedEdges: [updatedEdge],
        removedActiveChangeIds: [active.changeSetId],
        upsertedCompletedChanges: [completed],
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
            expiresAt: '2026-08-15T00:15:00.000Z',
            branchKey: 'main',
            mapRevision: snapshot.document.revision,
            gitRevision: 'head-e2e',
            preexistingChanges: [],
          },
        };
        snapshot.document.changeProposals = snapshot.document.changeProposals.map((proposal) =>
          proposal.id === approved.id ? approved : proposal,
        );
        patch(snapshot, { upsertedChangeProposals: [approved] });
        if (command.autoStartAgent !== undefined)
          setTimeout(() => run(command, snapshot, timestamp), 5);
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
