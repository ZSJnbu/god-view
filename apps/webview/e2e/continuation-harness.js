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

  function askForDirection(command, snapshot, timestamp) {
    const annotation = {
      id: 'annotation.continue-e2e',
      type: 'change',
      status: 'answered',
      target: { nodeIds: ['module.orders'], mapRevision: snapshot.document.revision },
      messages: [
        { id: 'continue.question', author: 'user', body: command.message, createdAt: timestamp },
        {
          id: 'continue.answer',
          author: 'agent',
          body: '“继续处理”还不足以确定下一步是内容替换、视觉优化还是在线发布能力。',
          uncertain: true,
          createdAt: timestamp,
        },
      ],
      createdAt: timestamp,
    };
    snapshot.document.annotations = [...snapshot.document.annotations, annotation];
    patch(snapshot, { upsertedAnnotations: [annotation] });
    dispatch({
      type: 'agent/conversation',
      conversation: {
        threadId: 'thread-continue-e2e',
        agent: command.agent,
        state: 'awaiting_input',
        activeRunId: 'continue-run-e2e',
        messages: [
          {
            id: 'continue.user',
            role: 'user',
            body: command.message,
            createdAt: timestamp,
            runId: 'continue-run-e2e',
          },
        ],
      },
    });
    dispatch({
      type: 'agent/run',
      run: {
        runId: 'continue-run-e2e',
        agent: command.agent,
        state: 'awaiting_input',
        output: ['answer_annotation 已接受；需要用户明确继续方向。'],
        detail: 'Agent 正在等待你的选择。',
        restartRequired: false,
        purpose: 'annotation_answer',
        annotationId: annotation.id,
        question: {
          question: '希望继续处理哪个方向？',
          options: [
            {
              id: 'visual',
              label: '视觉优化（推荐）',
              description: '继续打磨现有页面，不引入后台。',
            },
            {
              id: 'content',
              label: '替换真实内容',
              description: '把示例文章替换为用户内容。',
            },
            {
              id: 'publishing',
              label: '在线发布能力',
              description: '增加登录、编辑与持久化。',
            },
          ],
        },
      },
    });
  }

  function createProposal(snapshot, timestamp) {
    const annotation = snapshot.document.annotations.find(
      (item) => item.id === 'annotation.continue-e2e',
    );
    if (annotation === undefined) return;
    const request = {
      id: 'request.continue-e2e',
      annotationId: annotation.id,
      status: 'converted',
      reason: '用户选择继续视觉优化',
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
    snapshot.document.writeAccessRequests = [...snapshot.document.writeAccessRequests, request];
    snapshot.document.changeProposals = [...snapshot.document.changeProposals, proposal];
    patch(snapshot, {
      upsertedWriteAccessRequests: [request],
      upsertedChangeProposals: [proposal],
    });
    dispatch({
      type: 'agent/run',
      run: {
        runId: 'continue-run-e2e',
        agent: 'codex',
        state: 'completed',
        output: ['用户选择：visual', 'propose_change 已接受；方案等待用户批准。'],
        detail: '标注分析与修改方案已回写；请审核方案和文件范围，批准后 Agent 才会开始实现。',
        restartRequired: false,
        purpose: 'annotation_answer',
        annotationId: annotation.id,
      },
    });
    dispatch({
      type: 'agent/conversation',
      conversation: {
        threadId: 'thread-continue-e2e',
        agent: 'codex',
        state: 'idle',
        messages: [
          {
            id: 'continue.user',
            role: 'user',
            body: '继续处理',
            createdAt: timestamp,
            runId: 'continue-run-e2e',
          },
          {
            id: 'continue.activity',
            role: 'activity',
            body: '用户已选择视觉优化，修改方案已生成并等待批准。',
            createdAt: timestamp,
            runId: 'continue-run-e2e',
          },
        ],
      },
    });
  }

  window.__godViewContinuationHarness = {
    handle(command, snapshot, timestamp) {
      if (
        command.type === 'sendAgentMessage' &&
        command.mode === 'change' &&
        command.message === '继续处理'
      ) {
        queueMicrotask(() => askForDirection(command, snapshot, timestamp));
        return true;
      }
      if (command.type === 'answerAgentQuestion' && command.runId === 'continue-run-e2e') {
        queueMicrotask(() => createProposal(snapshot, timestamp));
        return true;
      }
      return false;
    },
  };
})();
