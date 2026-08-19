(() => {
  const timestamp = '2026-08-11T00:00:00.000Z';
  const provenance = {
    kind: 'agent_declared',
    actor: { kind: 'agent', adapterId: 'codex' },
    sessionId: 'session-e2e',
    declaredAt: timestamp,
  };
  const common = {
    source: provenance,
    codeValidation: { status: 'verified', level: 'file_exists', checkedAt: timestamp },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: timestamp,
    revision: 3,
  };
  const snapshot = {
    type: 'map/snapshot',
    document: {
      schemaVersion: '1.3',
      workspaceId: 'ws-webview-e2e',
      branchKey: 'main',
      revision: 3,
      lastEventSeq: 3,
      createdAt: timestamp,
      nodes: [
        {
          ...common,
          id: 'module.api',
          type: 'module',
          label: 'API Gateway',
          responsibility: 'Receives HTTP requests and dispatches commands.',
          paths: ['src/api/server.ts'],
        },
        {
          ...common,
          id: 'module.orders',
          type: 'module',
          label: 'Orders',
          responsibility: 'Validates and persists customer orders.',
          paths: ['src/orders/index.ts'],
          locations: [{ path: 'src/orders/index.ts', startLine: 12, endLine: 48 }],
        },
        {
          ...common,
          id: 'service.payments',
          type: 'service',
          label: 'Payments',
          responsibility: 'Authorizes order payments.',
          paths: ['src/payment/index.ts'],
        },
      ],
      edges: [
        {
          ...common,
          id: 'edge.api-orders',
          from: 'module.api',
          to: 'module.orders',
          type: 'calls',
          reason: 'Dispatch order commands',
        },
        {
          ...common,
          id: 'edge.orders-payments',
          from: 'module.orders',
          to: 'service.payments',
          type: 'depends_on',
          reason: 'Authorize payment before persistence',
        },
      ],
      stories: [
        {
          id: 'story.intro',
          type: 'project_intro',
          title: '从入口到支付',
          steps: [
            {
              order: 0,
              focusNodeIds: ['module.api'],
              caption: '请求从 API 入口进入',
              cameraHint: 'focus',
            },
            {
              order: 1,
              focusNodeIds: ['module.orders'],
              focusEdgeIds: ['edge.api-orders'],
              caption: '订单模块校验业务规则',
              cameraHint: 'fit',
            },
            {
              order: 2,
              focusNodeIds: ['service.payments'],
              focusEdgeIds: ['edge.orders-payments'],
              caption: '最后完成支付授权',
              cameraHint: 'focus',
            },
          ],
        },
        {
          id: 'story.flow',
          type: 'key_flow',
          title: '下单主流程',
          steps: [
            { order: 0, focusNodeIds: ['module.api'], caption: '接收下单请求' },
            { order: 1, focusNodeIds: ['module.orders'], caption: '创建订单' },
            { order: 2, focusNodeIds: ['service.payments'], caption: '支付授权' },
          ],
        },
        {
          id: 'story.change',
          type: 'change_replay',
          title: '支付接入变更',
          steps: [
            { order: 0, focusNodeIds: ['module.orders'], caption: '订单声明支付依赖' },
            { order: 1, focusNodeIds: ['service.payments'], caption: '新增支付服务' },
            {
              order: 2,
              focusNodeIds: ['module.orders', 'service.payments'],
              focusEdgeIds: ['edge.orders-payments'],
              caption: '连接并验证依赖',
            },
          ],
        },
      ],
      annotations: [],
      writeAccessRequests: [],
      changeProposals: [],
      activeChanges: [],
      completedChanges: [],
      appliedEventIds: ['event-1', 'event-2', 'event-3'],
    },
    capabilities: {
      hasGit: true,
      canExecuteChanges: false,
      reducedMotion: new URLSearchParams(window.location.search).get('reducedMotion') === '1',
      branchKey: 'main',
    },
    factsRevision: 1,
    coverage: {
      includedSources: 3,
      includedConfigs: 0,
      includedAssets: 0,
      classified: 3,
      unclassified: 0,
      excluded: 2,
      failed: 0,
      reasons: [{ reason: 'node_modules', count: 2 }],
      computedAt: timestamp,
    },
    drift: [],
  };

  if (new URLSearchParams(window.location.search).get('empty') === '1') {
    snapshot.document.nodes = [];
    snapshot.document.edges = [];
    snapshot.document.stories = [];
    snapshot.coverage.classified = 0;
    snapshot.coverage.unclassified = 3;
  }

  // 独立覆盖三种绘图层级。日常 fixture 没有 group/file 节点，产品应隐藏无效果的
  // 层级入口；这里补齐真实父子层级，验证分组与文件关系图确实改变图结构。
  if (new URLSearchParams(window.location.search).get('levels') === '1') {
    snapshot.document.nodes.find((node) => node.id === 'module.api').parentId = 'group.backend';
    snapshot.document.nodes.find((node) => node.id === 'module.orders').parentId = 'group.backend';
    snapshot.document.nodes.push(
      {
        ...common,
        id: 'group.backend',
        type: 'group',
        label: 'Backend',
        responsibility: 'Groups backend modules.',
        paths: ['src/api', 'src/orders'],
      },
      {
        ...common,
        id: 'file.orders-index',
        type: 'file',
        label: 'src/orders/index.ts',
        responsibility: 'Order module entry file.',
        paths: ['src/orders/index.ts'],
        parentId: 'module.orders',
      },
    );
    snapshot.coverage.classified = 5;
  }

  // 对应真实 CRM 地图的密集模块拓扑：9 个模块、28 条声明关系，其中两组
  // 同端点关系在模块层聚合为 26 根可见连线。用于防止“小图正常、大图丢线”。
  if (new URLSearchParams(window.location.search).get('dense') === '1') {
    const denseNodes = [
      ['application-operations', '应用操作与 Server Functions', 'service'],
      ['background-runtime', '后台任务与服务端能力', 'service'],
      ['data-persistence', '数据模型与持久化', 'storage'],
      ['delivery-assurance', '测试、交付与项目知识', 'group'],
      ['domain-rules', '领域规则与流程', 'module'],
      ['external-integrations', '外部服务适配', 'service'],
      ['platform-foundations', '平台基础能力', 'module'],
      ['product-surfaces', '产品界面与 HTTP 表面', 'module'],
      ['runtime-entry', '运行时与应用入口', 'entry'],
    ];
    const denseEdges = [
      ['assurance-verifies-system', 'delivery-assurance', 'runtime-entry'],
      ['background-applies-domain', 'background-runtime', 'domain-rules'],
      ['background-calls-integrations', 'background-runtime', 'external-integrations'],
      ['background-data-flow', 'background-runtime', 'data-persistence'],
      ['background-depends-platform', 'background-runtime', 'platform-foundations'],
      ['data-depends-platform', 'data-persistence', 'platform-foundations'],
      ['domain-calls-background', 'domain-rules', 'background-runtime'],
      ['domain-calls-integrations', 'domain-rules', 'external-integrations'],
      ['domain-depends-platform', 'domain-rules', 'platform-foundations'],
      ['domain-read-data', 'domain-rules', 'data-persistence'],
      ['domain-write-data', 'domain-rules', 'data-persistence'],
      ['integrations-depend-platform', 'external-integrations', 'platform-foundations'],
      ['integrations-write-data', 'external-integrations', 'data-persistence'],
      ['operations-apply-domain', 'application-operations', 'domain-rules'],
      ['operations-call-background', 'application-operations', 'background-runtime'],
      ['operations-depend-platform', 'application-operations', 'platform-foundations'],
      ['operations-read-data', 'application-operations', 'data-persistence'],
      ['operations-write-data', 'application-operations', 'data-persistence'],
      ['product-calls-background', 'product-surfaces', 'background-runtime'],
      ['product-calls-domain', 'product-surfaces', 'domain-rules'],
      ['product-calls-operations', 'product-surfaces', 'application-operations'],
      ['product-data-flow', 'product-surfaces', 'data-persistence'],
      ['product-depends-platform', 'product-surfaces', 'platform-foundations'],
      ['runtime-calls-background', 'runtime-entry', 'background-runtime'],
      ['runtime-calls-domain', 'runtime-entry', 'domain-rules'],
      ['runtime-calls-operations', 'runtime-entry', 'application-operations'],
      ['runtime-depends-platform', 'runtime-entry', 'platform-foundations'],
      ['runtime-serves-product', 'runtime-entry', 'product-surfaces'],
    ];
    snapshot.document.nodes = denseNodes.map(([id, label, type]) => ({
      ...common,
      id,
      label,
      type,
      responsibility: `${label} 的职责。`,
      paths: [`src/${id}/index.ts`],
    }));
    snapshot.document.edges = denseEdges.map(([id, from, to], index) => ({
      ...common,
      id,
      from,
      to,
      type: index % 3 === 0 ? 'calls' : index % 3 === 1 ? 'depends_on' : 'data_flow',
      reason: `${from} 到 ${to}`,
    }));
    snapshot.coverage.classified = 9;
    snapshot.coverage.unclassified = 0;
  }

  /** Git 历史回放的固定时间线：三次提交里模块逐个出现、体量逐步变大。 */
  function historyTimelineEvent(current, at) {
    const ids = current.document.nodes.map((node) => node.id);
    const frame = (index, present, changed, magnitudes) => ({
      index,
      sha: `0000000000000000000000000000000000000${index}`,
      shortSha: `commit${index}`,
      author: 'God View 测试',
      committedAt: at,
      subject: `第 ${index + 1} 次提交`,
      additions: 40 + index * 10,
      deletions: index,
      commitCount: index === 2 ? 3 : 1,
      fileCount: index + 1,
      presentNodeIds: present,
      changedNodeIds: changed,
      magnitudes,
    });
    return {
      type: 'history/timeline',
      timeline: {
        nodes: current.document.nodes,
        edges: current.document.edges,
        frames: [
          frame(0, ids.slice(0, 1), ids.slice(0, 1), { [ids[0]]: 20 }),
          frame(1, ids.slice(0, 2), ids.slice(1, 2), { [ids[0]]: 40, [ids[1]]: 15 }),
          frame(2, ids, ids.slice(2), { [ids[0]]: 60, [ids[1]]: 120, [ids[2]]: 30 }),
        ],
        truncatedCommits: 4,
        derivedNodeCount: 0,
      },
    };
  }

  window.__godViewCommands = [];
  window.__godViewSnapshot = snapshot;
  window.acquireVsCodeApi = () => ({
    // Test harness intentionally routes every supported command in one host adapter.
    postMessage(command) {
      window.__godViewCommands.push(command);
      window.__godViewContinuationHarness.handle(command, snapshot, timestamp);
      if (command.type === 'ready' || command.type === 'requestSnapshot') {
        queueMicrotask(() => {
          window.dispatchEvent(new MessageEvent('message', { data: snapshot }));
        });
      }
      if (command.type === 'requestHistoryTimeline') {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', { data: historyTimelineEvent(snapshot, timestamp) }),
          );
        });
      }
      if (command.type === 'ready' || command.type === 'refreshAgentStatus') {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'agent/status',
                selectedAgent: 'codex',
                agents: [
                  {
                    agent: 'claude-code',
                    displayName: 'Claude Code',
                    installed: true,
                    version: '2.1.228',
                    configuration: 'missing',
                    workspaceRoot: '/repo',
                    detail: '尚未完整配置当前工作区的 MCP 与上下文 hook。',
                  },
                  {
                    agent: 'codex',
                    displayName: 'Codex CLI',
                    installed: true,
                    version: 'codex-cli 0.147.0',
                    configuration: 'current',
                    workspaceRoot: '/repo',
                    detail: '原生会话、MCP 与每轮上下文 hook 已配置并复验。',
                  },
                ],
              },
            }),
          );
        });
      }
      if (command.type === 'configureAgent') {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'agent/status',
                selectedAgent: command.agent,
                agents: ['claude-code', 'codex'].map((agent) => ({
                  agent,
                  displayName: agent === 'codex' ? 'Codex CLI' : 'Claude Code',
                  installed: true,
                  version: agent === 'codex' ? 'codex-cli 0.147.0' : '2.1.228',
                  configuration: 'current',
                  workspaceRoot: '/repo',
                  detail: '原生会话、MCP 与每轮上下文 hook 已配置并复验。',
                })),
              },
            }),
          );
        });
      }
      window.__godViewAnnotationHarness.handle(command, snapshot, timestamp);
      window.__godViewApprovedChangeHarness.handle(command, snapshot, timestamp);
      if (command.type === 'rejectProposal') {
        const current = snapshot.document.changeProposals.find(
          (item) => item.id === command.proposalId,
        );
        if (current !== undefined) {
          const rejected = { ...current, status: 'rejected' };
          snapshot.document.changeProposals = [rejected];
          snapshot.document.revision += 1;
          queueMicrotask(() => {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'map/patch',
                  revision: snapshot.document.revision,
                  factsRevision: 1,
                  patch: {
                    upsertedNodes: [],
                    upsertedEdges: [],
                    removedNodeIds: [],
                    removedEdgeIds: [],
                    upsertedChangeProposals: [rejected],
                  },
                  drift: [],
                },
              }),
            );
          });
        }
      }
      if (command.type === 'reviewChange') {
        const current = snapshot.document.completedChanges.find(
          (item) => item.changeSetId === command.changeSetId,
        );
        if (current !== undefined) {
          const reviewed = { ...current, status: command.status, note: command.note };
          snapshot.document.completedChanges = snapshot.document.completedChanges.map((item) =>
            item.changeSetId === command.changeSetId ? reviewed : item,
          );
          snapshot.document.revision += 1;
          queueMicrotask(() => {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'map/patch',
                  revision: snapshot.document.revision,
                  factsRevision: 1,
                  patch: {
                    upsertedNodes: [],
                    upsertedEdges: [],
                    removedNodeIds: [],
                    removedEdgeIds: [],
                    upsertedCompletedChanges: [reviewed],
                  },
                  drift: [],
                },
              }),
            );
          });
        }
      }
    },
    setState(state) {
      window.__godViewState = state;
      return state;
    },
  });
})();
