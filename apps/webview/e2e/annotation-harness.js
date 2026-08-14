(() => {
  /* global setTimeout */
  function dispatch(data) {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  function patchAnnotation(snapshot, annotation) {
    snapshot.document.annotations = snapshot.document.annotations
      .filter((item) => item.id !== annotation.id)
      .concat(annotation);
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
        upsertedAnnotations: [annotation],
      },
      drift: [],
    });
  }

  function answer(snapshot, annotationId, timestamp) {
    const current = snapshot.document.annotations.find((item) => item.id === annotationId);
    if (current === undefined || current.status === 'answered') return;
    patchAnnotation(snapshot, {
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
    });
  }

  window.__godViewAnnotationHarness = {
    handle(command, snapshot, timestamp) {
      if (command.type === 'createAnnotation') {
        const id = 'annotation.e2e';
        patchAnnotation(snapshot, {
          id,
          type: command.annotationType,
          status: 'sent',
          target: { nodeIds: command.nodeIds, mapRevision: snapshot.document.revision },
          messages: [
            { id: `${id}.question`, author: 'user', body: command.body, createdAt: timestamp },
          ],
          createdAt: timestamp,
        });
        if (command.autoAnswerAgent !== undefined)
          setTimeout(() => answer(snapshot, id, timestamp), 40);
        return true;
      }
      if (command.type === 'startAnnotationAnswer' || command.type === 'copyAnnotationTask') {
        queueMicrotask(() => answer(snapshot, command.annotationId, timestamp));
        return true;
      }
      if (command.type === 'resolveAnnotation') {
        const current = snapshot.document.annotations.find(
          (item) => item.id === command.annotationId,
        );
        if (current !== undefined) {
          patchAnnotation(snapshot, { ...current, status: 'resolved', resolvedAt: timestamp });
        }
        return true;
      }
      return false;
    },
  };
})();
