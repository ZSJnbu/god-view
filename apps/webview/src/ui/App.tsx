import { useCallback } from 'react';
import type { Identifier } from '@god-view/protocol';
import type { AppStore } from '../app-store.js';
import type { Messenger } from '../messaging.js';
import type { LayoutClient } from '../layout/layout-client.js';
import type { CytoscapeAdapter, GraphViewCallbacks } from '../graph/cytoscape-adapter.js';
import { GraphCanvas } from './GraphCanvas.js';
import { Toolbar } from './Toolbar.js';
import { DetailsPanel } from './DetailsPanel.js';
import { EmptyMap } from './EmptyMap.js';
import { StatusBar } from './StatusBar.js';
import { StoryPlayer } from './StoryPlayer.js';
import { ChangeReview } from './ChangeReview.js';
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
          onGenerateAgentTask={() => {
            messenger.send({ type: 'generateAgentTask' });
          }}
          onCopyAgentSetup={() => {
            messenger.send({ type: 'copyAgentSetup' });
          }}
          onConfigureAgent={(agent) => {
            messenger.send({ type: 'configureAgent', agent });
          }}
        />
        <StatusBar store={store} />
      </main>
    );
  }

  return (
    <main className="app">
      <Toolbar store={store} />
      <StoryPlayer store={store} />
      <div className="app__body">
        <GraphCanvas
          store={store}
          layoutClient={layoutClient}
          createAdapter={createAdapter}
          onOpenSource={openNodeSource}
          onPersistLayout={persistLayout}
        />
        <DetailsPanel
          store={store}
          onOpenSource={openSource}
          onCreateAnnotation={(annotationType, body, nodeIds, excludedPaths) => {
            messenger.send({
              type: 'createAnnotation',
              annotationType,
              body,
              nodeIds,
              ...(excludedPaths.length === 0 ? {} : { excludedPaths }),
            });
          }}
          onResolveAnnotation={(annotationId) => {
            messenger.send({ type: 'resolveAnnotation', annotationId });
          }}
          onCopyAnnotationTask={(annotationId) => {
            messenger.send({ type: 'copyAnnotationTask', annotationId });
          }}
          onApproveProposal={(proposalId, approvedScope) => {
            messenger.send({ type: 'approveProposal', proposalId, approvedScope });
          }}
          onRejectProposal={(proposalId) => {
            messenger.send({ type: 'rejectProposal', proposalId });
          }}
          onCopyApprovedChangeTask={(proposalId) => {
            messenger.send({ type: 'copyApprovedChangeTask', proposalId });
          }}
        />
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
      />
    </main>
  );
}
