(() => {
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

  function createProposal(snapshot, timestamp, message) {
    const annotation = {
      id: 'annotation.continue-e2e',
      type: 'change',
      status: 'plan_proposed',
      target: { nodeIds: ['module.orders'], mapRevision: snapshot.document.revision },
      messages: [{ id: 'continue.question', author: 'user', body: message, createdAt: timestamp }],
      createdAt: timestamp,
    };
    const request = {
      id: 'request.continue-e2e',
      annotationId: annotation.id,
      status: 'converted',
      reason: '原生 Agent 已分析修改意图并提交方案',
      expectedScope: ['src/orders/index.ts'],
      requestedAt: timestamp,
    };
    const proposal = {
      id: 'proposal.continue-e2e',
      annotationId: annotation.id,
      requestId: request.id,
      status: 'proposed',
      summary: '继续视觉优化并保持现有功能边界',
      plannedFiles: ['src/orders/index.ts'],
      structuralChanges: ['更新现有页面呈现，不新增运行时服务'],
      risks: ['视觉调整可能影响窄屏布局'],
      validationPlan: ['运行测试并检查宽窄屏布局'],
      branchKey: 'main',
      baseMapRevision: snapshot.document.revision,
      baseGitRevision: 'head-e2e',
      createdAt: timestamp,
    };
    snapshot.document.annotations = [...snapshot.document.annotations, annotation];
    snapshot.document.writeAccessRequests = [...snapshot.document.writeAccessRequests, request];
    snapshot.document.changeProposals = [...snapshot.document.changeProposals, proposal];
    patch(snapshot, {
      upsertedAnnotations: [annotation],
      upsertedWriteAccessRequests: [request],
      upsertedChangeProposals: [proposal],
    });
  }

  window.__godViewContinuationHarness = {
    handle(command, snapshot, timestamp) {
      if (
        command.type === 'sendAgentMessage' &&
        command.mode === 'change' &&
        command.message === '继续处理'
      ) {
        queueMicrotask(() => createProposal(snapshot, timestamp, command.message));
        return true;
      }
      return false;
    },
  };
})();
