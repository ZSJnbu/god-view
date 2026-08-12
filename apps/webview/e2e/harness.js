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

  window.__godViewCommands = [];
  window.__godViewSnapshot = snapshot;
  window.acquireVsCodeApi = () => ({
    postMessage(command) {
      window.__godViewCommands.push(command);
      if (command.type === 'ready' || command.type === 'requestSnapshot') {
        queueMicrotask(() => {
          window.dispatchEvent(new MessageEvent('message', { data: snapshot }));
        });
      }
      if (command.type === 'createAnnotation') {
        const id = 'annotation.e2e';
        const annotation = {
          id,
          type: command.annotationType,
          status: 'sent',
          target: { nodeIds: command.nodeIds, mapRevision: snapshot.document.revision },
          messages: [
            { id: `${id}.question`, author: 'user', body: command.body, createdAt: timestamp },
          ],
          createdAt: timestamp,
        };
        snapshot.document.annotations = [annotation];
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
                  upsertedAnnotations: [annotation],
                },
                drift: [],
              },
            }),
          );
        });
      }
      if (command.type === 'copyAnnotationTask') {
        const current = snapshot.document.annotations.find(
          (item) => item.id === command.annotationId,
        );
        if (current !== undefined) {
          const answered = {
            ...current,
            status: 'answered',
            messages: [
              ...current.messages,
              {
                id: `${current.id}.answer`,
                author: 'agent',
                body: '<script>alert(1)</script> 支付授权在订单确认前完成。',
                detail: '订单模块显式依赖支付服务。',
                evidence: [
                  {
                    kind: 'explicit_import',
                    location: { path: 'src/orders/index.ts', startLine: 12 },
                  },
                ],
                createdAt: timestamp,
              },
            ],
          };
          snapshot.document.annotations = [answered];
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
                    upsertedAnnotations: [answered],
                  },
                  drift: [],
                },
              }),
            );
          });
        }
      }
      if (command.type === 'resolveAnnotation') {
        const current = snapshot.document.annotations.find(
          (item) => item.id === command.annotationId,
        );
        if (current !== undefined) {
          const resolved = { ...current, status: 'resolved', resolvedAt: timestamp };
          snapshot.document.annotations = [resolved];
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
                    upsertedAnnotations: [resolved],
                  },
                  drift: [],
                },
              }),
            );
          });
        }
      }
      if (command.type === 'approveProposal') {
        const current = snapshot.document.changeProposals.find(
          (item) => item.id === command.proposalId,
        );
        if (current !== undefined) {
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
                    upsertedChangeProposals: [approved],
                  },
                  drift: [],
                },
              }),
            );
          });
        }
      }
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
