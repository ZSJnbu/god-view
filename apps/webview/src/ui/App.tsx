import { useCallback, useState } from 'react';
import type { Identifier } from '@god-view/protocol';
import type { AppStore } from '../app-store.js';
import type { Messenger } from '../messaging.js';
import type { LayoutClient } from '../layout/layout-client.js';
import { toLayoutRequest } from '../layout/layout-input.js';
import { buildVisibleGraph } from '../model/view-model.js';
import type { CytoscapeAdapter, GraphViewCallbacks } from '../graph/cytoscape-adapter.js';
import { GraphCanvas } from './GraphCanvas.js';
import { Toolbar } from './Toolbar.js';
import { DetailsPanel } from './DetailsPanel.js';
import { EmptyMap } from './EmptyMap.js';
import { StatusBar } from './StatusBar.js';
import { StoryPlayer } from './StoryPlayer.js';
import { ChangeReview } from './ChangeReview.js';
import { AgentConversationPanel } from './AgentConversationPanel.js';
import { ResizableAgentPane } from './ResizableAgentPane.js';
import { FloatingAgentPane } from './FloatingAgentPane.js';
import { ViewContext } from './ViewContext.js';
import { MapPlaybackControls } from './MapPlaybackControls.js';
import { useAppState } from './use-app-state.js';

export interface AppProps {
  readonly store: AppStore;
  readonly messenger: Messenger;
  readonly layoutClient: LayoutClient;
  readonly createAdapter: (
    container: HTMLElement,
    callbacks: GraphViewCallbacks,
  ) => CytoscapeAdapter;
}

export function App({
  store,
  messenger,
  layoutClient,
  createAdapter,
}: AppProps): React.JSX.Element {
  const state = useAppState(store);
  const [topologicalSortBusy, setTopologicalSortBusy] = useState(false);
  const configuredAgent =
    state.agents.find(
      (item) => item.agent === state.selectedAgent && item.configuration === 'current',
    ) ?? state.agents.find((item) => item.configuration === 'current');
  const savePaneView = useCallback(
    (view: typeof state.agentPaneView) => {
      store.setAgentPaneView(view);
      messenger.send({ type: 'saveAgentPaneView', view });
    },
    [messenger, store, state.agentPaneView],
  );

  const openSource = useCallback(
    (path: string, startLine?: number) => {
      messenger.send(
        startLine === undefined
          ? { type: 'openSource', path }
          : { type: 'openSource', path, startLine },
      );
    },
    [messenger],
  );

  const openNodeSource = useCallback(
    (nodeId: Identifier) => {
      const first = store.getState().map.nodes.get(nodeId)?.paths?.[0];
      if (first !== undefined) {
        openSource(first);
      }
    },
    [store, openSource],
  );

  const persistLayout = useCallback(() => {
    messenger.send({ type: 'saveLayout', positions: store.getState().map.layout });
  }, [messenger, store]);

  const refreshAgentStatus = useCallback(() => {
    messenger.send({ type: 'refreshAgentStatus' });
  }, [messenger]);

  const requestAgentConfiguration = useCallback(() => {
    const candidate =
      state.agents.find((item) => item.agent === state.selectedAgent && item.installed) ??
      state.agents.find((item) => item.installed);
    if (candidate === undefined) {
      refreshAgentStatus();
      return;
    }
    messenger.send({ type: 'configureAgent', agent: candidate.agent });
  }, [messenger, refreshAgentStatus, state.agents, state.selectedAgent]);

  const topologicalSort = useCallback(() => {
    if (topologicalSortBusy) return;
    setTopologicalSortBusy(true);
    const graph = buildVisibleGraph(store.getState().map, { level: 'modules' });
    void layoutClient
      .computeTopological(toLayoutRequest(graph, {}))
      .then(({ positions }) => {
        store.applyTopologicalLayout(positions);
        messenger.send({ type: 'saveLayout', positions });
      })
      .finally(() => {
        setTopologicalSortBusy(false);
      });
  }, [layoutClient, messenger, store, topologicalSortBusy]);

  if (!state.map.hydrated) {
    return (
      <main className="app app--loading">
        <p role="status">正在读取项目地图…</p>
      </main>
    );
  }

  if (state.map.nodes.size === 0) {
    return (
      <main className="app">
        <EmptyMap
          coverage={state.map.coverage}
          agents={state.agents}
          selectedAgent={state.selectedAgent}
          onGenerateAgentTask={() => {
            messenger.send({ type: 'generateAgentTask' });
          }}
          onCopyAgentSetup={() => {
            messenger.send({ type: 'copyAgentSetup' });
          }}
          onConfigureAgent={(agent) => {
            messenger.send({ type: 'configureAgent', agent });
          }}
          onRefreshAgentStatus={refreshAgentStatus}
          onStartInitialization={(agent) => {
            messenger.send({ type: 'startInitialization', agent });
          }}
        />
        <MapPlaybackControls store={store} />
        <StatusBar store={store} />
      </main>
    );
  }

  return (
    <main className="app">
      <Toolbar
        store={store}
        onTopologicalSort={topologicalSort}
        onCompleteLevel={(target) => {
          const agent =
            state.agents.find(
              (item) => item.agent === state.selectedAgent && item.configuration === 'current',
            ) ?? state.agents.find((item) => item.configuration === 'current');
          if (agent === undefined) {
            requestAgentConfiguration();
            return;
          }
          messenger.send({ type: 'startMapCompletion', agent: agent.agent, target });
        }}
        topologicalSortBusy={topologicalSortBusy}
        hasConfiguredAgent={state.agents.some((item) => item.configuration === 'current')}
        onReinitialize={() => {
          const agent =
            state.agents.find(
              (item) => item.agent === state.selectedAgent && item.configuration === 'current',
            ) ?? state.agents.find((item) => item.configuration === 'current');
          if (agent === undefined) {
            requestAgentConfiguration();
            return;
          }
          messenger.send({ type: 'startReinitialization', agent: agent.agent });
        }}
      />
      <StoryPlayer store={store} />
      <ViewContext store={store} />
      <div className="app__body">
        <GraphCanvas
          store={store}
          layoutClient={layoutClient}
          createAdapter={createAdapter}
          onOpenSource={openNodeSource}
          onPersistLayout={persistLayout}
        />
        <MapPlaybackControls store={store} />
        {(state.selectedId !== undefined || (state.view.query ?? '').trim() !== '') && (
          <DetailsPanel
            store={store}
            onOpenSource={openSource}
            onCreateAnnotation={(annotationType, body, nodeIds, excludedPaths) => {
              const autoAnswerAgent =
                state.agents.find(
                  (item) => item.agent === state.selectedAgent && item.configuration === 'current',
                )?.agent ?? state.agents.find((item) => item.configuration === 'current')?.agent;
              messenger.send({
                type: 'createAnnotation',
                annotationType,
                body,
                nodeIds,
                ...(excludedPaths.length === 0 ? {} : { excludedPaths }),
                ...(autoAnswerAgent === undefined ? {} : { autoAnswerAgent }),
              });
            }}
            onStartAnnotationAnswer={(annotationId) => {
              const agent =
                state.agents.find(
                  (item) => item.agent === state.selectedAgent && item.configuration === 'current',
                ) ?? state.agents.find((item) => item.configuration === 'current');
              if (agent === undefined) {
                requestAgentConfiguration();
                return;
              }
              messenger.send({ type: 'startAnnotationAnswer', annotationId, agent: agent.agent });
            }}
            onResolveAnnotation={(annotationId) => {
              messenger.send({ type: 'resolveAnnotation', annotationId });
            }}
            onCopyAnnotationTask={(annotationId) => {
              messenger.send({ type: 'copyAnnotationTask', annotationId });
            }}
            onApproveProposal={(proposalId, approvedScope) => {
              const agent =
                state.agents.find(
                  (item) => item.agent === state.selectedAgent && item.configuration === 'current',
                ) ?? state.agents.find((item) => item.configuration === 'current');
              messenger.send({
                type: 'approveProposal',
                proposalId,
                approvedScope,
                ...(agent === undefined ? {} : { autoStartAgent: agent.agent }),
              });
            }}
            onStartApprovedChange={(proposalId) => {
              const agent =
                state.agents.find(
                  (item) => item.agent === state.selectedAgent && item.configuration === 'current',
                ) ?? state.agents.find((item) => item.configuration === 'current');
              if (agent === undefined) {
                requestAgentConfiguration();
                return;
              }
              messenger.send({ type: 'startApprovedChange', proposalId, agent: agent.agent });
            }}
            onRejectProposal={(proposalId) => {
              messenger.send({ type: 'rejectProposal', proposalId });
            }}
            onCopyApprovedChangeTask={(proposalId) => {
              messenger.send({ type: 'copyApprovedChangeTask', proposalId });
            }}
          />
        )}
      </div>
      <StatusBar store={store} />
      <ChangeReview
        store={store}
        onOpenDiff={(path) => {
          messenger.send({ type: 'openDiff', path });
        }}
        onReview={(changeSetId, status, note) => {
          messenger.send({
            type: 'reviewChange',
            changeSetId,
            status,
            ...(note === undefined ? {} : { note }),
          });
        }}
        onInterrupt={(changeSetId) => {
          messenger.send({ type: 'interruptChange', changeSetId });
        }}
        onScopeExpansionDecision={(changeSetId, requestId, decision) => {
          messenger.send({
            type: 'decideScopeExpansion',
            changeSetId,
            requestId,
            decision,
          });
        }}
      />
      {state.agentPaneView.mode === 'docked' ? (
        <ResizableAgentPane
          height={state.agentPaneHeight}
          onResize={(height) => {
            store.setAgentPaneHeight(height);
          }}
          onResizeEnd={(height) => {
            messenger.send({ type: 'saveAgentPaneHeight', height });
          }}
        >
          {agentPanel()}
        </ResizableAgentPane>
      ) : (
        <FloatingAgentPane
          bounds={state.agentPaneView.floatingBounds}
          onChange={(floatingBounds) => {
            store.setAgentPaneView({ mode: 'floating', floatingBounds });
          }}
          onChangeEnd={(floatingBounds) => {
            savePaneView({ mode: 'floating', floatingBounds });
          }}
        >
          {agentPanel()}
        </FloatingAgentPane>
      )}
    </main>
  );

  function agentPanel(): React.JSX.Element {
    return (
      <AgentConversationPanel
        agent={configuredAgent?.agent}
        selectedNode={
          state.selectedId === undefined
            ? undefined
            : (() => {
                const node = state.map.nodes.get(state.selectedId);
                return node === undefined ? undefined : { id: node.id, label: node.label };
              })()
        }
        proposals={[...state.map.changeProposals.values()]}
        activeChanges={[...state.map.activeChanges.values()]}
        completedChanges={[...state.map.completedChanges.values()]}
        hasGit={state.map.capabilities?.hasGit ?? false}
        onOpenAgent={() => {
          if (configuredAgent === undefined) {
            requestAgentConfiguration();
            return;
          }
          messenger.send({ type: 'openAgentTerminal', agent: configuredAgent.agent });
        }}
        onSend={(message, mode) => {
          if (configuredAgent === undefined) {
            requestAgentConfiguration();
            return;
          }
          messenger.send({
            type: 'sendAgentMessage',
            agent: configuredAgent.agent,
            message,
            mode,
            ...(state.selectedId === undefined ? {} : { nodeIds: [state.selectedId] }),
          });
        }}
        paneMode={state.agentPaneView.mode}
        onTogglePaneMode={() => {
          savePaneView({
            ...state.agentPaneView,
            mode: state.agentPaneView.mode === 'docked' ? 'floating' : 'docked',
          });
        }}
        onApproveProposal={(proposalId, approvedScope) => {
          messenger.send({
            type: 'approveProposal',
            proposalId,
            approvedScope,
            ...(configuredAgent === undefined ? {} : { autoStartAgent: configuredAgent.agent }),
          });
        }}
        onStartApprovedChange={(proposalId) => {
          if (configuredAgent === undefined) {
            requestAgentConfiguration();
            return;
          }
          messenger.send({
            type: 'startApprovedChange',
            proposalId,
            agent: configuredAgent.agent,
          });
        }}
        onRejectProposal={(proposalId) => {
          messenger.send({ type: 'rejectProposal', proposalId });
        }}
        onCopyApprovedChangeTask={(proposalId) => {
          messenger.send({ type: 'copyApprovedChangeTask', proposalId });
        }}
      />
    );
  }
}
