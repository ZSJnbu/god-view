(() => {
  /* global setTimeout */
  function dispatch(data) {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  function patchAnnotation(snapshot, annotation) {
    snapshot.document.annotations = [annotation];
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

  function emitRun(command, annotationId, state, output, runId) {
    dispatch({
      type: 'agent/run',
      run: {
        runId,
        agent: command.autoAnswerAgent ?? command.agent,
        state,
        output,
        detail:
          state === 'completed'
            ? '标注解释已完成并通过最终复核；地图已刷新。'
            : 'Agent 已启动，正在分析标注问题…',
        restartRequired: false,
        purpose: 'annotation_answer',
        annotationId,
      },
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
        if (command.autoAnswerAgent !== undefined) {
          setTimeout(() => {
            emitRun(
              command,
              id,
              'running',
              ['Agent 会话已建立。', '正在读取地图与允许的代码位置…'],
              'annotation-run-e2e',
            );
            setTimeout(() => {
              emitRun(
                command,
                id,
                'running',
                [
                  'Agent 会话已建立。',
                  '正在读取地图与允许的代码位置…',
                  '已读取权威地图：r3 · 3 个节点 · 2 条关系 · 0 个未分类文件。',
                  'God View 写入已接受：地图推进至 r4。',
                ],
                'annotation-run-e2e',
              );
              setTimeout(() => {
                emitRun(
                  command,
                  id,
                  'running',
                  [
                    'Agent 会话已建立。',
                    '正在读取地图与允许的代码位置…',
                    '已读取权威地图：r3 · 3 个节点 · 2 条关系 · 0 个未分类文件。',
                    'God View 写入已接受：地图推进至 r4。',
                    'Agent 已完成写入，正在等待权威地图同步…',
                  ],
                  'annotation-run-e2e',
                );
                setTimeout(() => {
                  answer(snapshot, id, timestamp);
                  emitRun(
                    command,
                    id,
                    'completed',
                    [
                      'Agent 会话已建立。',
                      '正在读取地图与允许的代码位置…',
                      '已读取权威地图：r3 · 3 个节点 · 2 条关系 · 0 个未分类文件。',
                      'God View 写入已接受：地图推进至 r4。',
                      'answer_annotation 已接受，标注答案已回写。',
                    ],
                    'annotation-run-e2e',
                  );
                }, 80);
              }, 40);
            }, 20);
          }, 5);
        }
        return true;
      }
      if (command.type === 'startAnnotationAnswer') {
        queueMicrotask(() => {
          emitRun(
            command,
            command.annotationId,
            'running',
            ['正在重新回答标注…'],
            'annotation-run-retry-e2e',
          );
        });
        return true;
      }
      if (command.type === 'copyAnnotationTask') {
        answer(snapshot, command.annotationId, timestamp);
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
