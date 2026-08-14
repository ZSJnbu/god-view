import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, type GraphSnapshot } from '@god-view/graph-core';
import type { GraphEdge, GraphNode } from '@god-view/protocol';
import { buildAnnotationContext, formatAnnotationTask } from './annotation-context.js';

function snapshot(): GraphSnapshot {
  const base = createEmptySnapshot({
    workspaceId: 'ws-test',
    branchKey: 'main',
    createdAt: '2026-08-12T00:00:00Z',
    baseGitRevision: 'abc123',
  });
  const common = {
    source: {
      kind: 'agent_declared' as const,
      actor: { kind: 'agent' as const },
      declaredAt: base.createdAt,
    },
    codeValidation: { status: 'unverified' as const },
    userConfirmation: { status: 'unconfirmed' as const },
    lifecycle: { status: 'active' as const },
    updatedAt: base.createdAt,
    revision: 1,
  };
  const nodes: GraphNode[] = [
    {
      ...common,
      id: 'orders',
      type: 'module',
      label: 'Orders',
      paths: ['src/orders.ts'],
      locations: [{ path: 'src/orders.ts', startLine: 3 }],
    },
    { ...common, id: 'payments', type: 'service', label: 'Payments', paths: ['src/payments.ts'] },
    { ...common, id: 'unrelated', type: 'module', label: 'Other' },
  ];
  const edge: GraphEdge = {
    ...common,
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    type: 'depends_on',
  };
  return {
    ...base,
    revision: 1,
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map([[edge.id, edge]]),
  };
}

describe('标注上下文', () => {
  it('只收集目标、一跳邻居和相关边，不读取源码内容', () => {
    const context = buildAnnotationContext(snapshot(), ['orders']);
    expect(context).toMatchObject({
      neighborNodeIds: ['payments'],
      relatedEdgeIds: ['orders-payments'],
      target: {
        nodeIds: ['orders'],
        edgeIds: ['orders-payments'],
        mapRevision: 1,
        baseGitRevision: 'abc123',
      },
    });
    expect(context?.target.codeLocations).toEqual([{ path: 'src/orders.ts', startLine: 3 }]);
  });

  it('用户能移除无关路径，未知目标被拒绝', () => {
    expect(
      buildAnnotationContext(snapshot(), ['orders'], ['src/orders.ts'])?.target.codeLocations,
    ).toBeUndefined();
    expect(buildAnnotationContext(snapshot(), ['missing'])).toBeUndefined();
  });

  it('复制任务明确只读并指示 answer_annotation', () => {
    const map = snapshot();
    const annotation = {
      id: 'annotation.orders',
      type: 'explain' as const,
      status: 'sent' as const,
      target: { nodeIds: ['orders'], mapRevision: 1 },
      messages: [{ id: 'q', author: 'user' as const, body: '为什么？', createdAt: map.createdAt }],
      createdAt: map.createdAt,
    };
    const task = formatAnnotationTask(annotation.id, {
      ...map,
      annotations: new Map([[annotation.id, annotation]]),
    });
    expect(task).toContain('answer_annotation');
    expect(task).toContain('不包含代码写入授权');
    expect(task).toContain('payments');
  });

  it('模糊修改请求要求先向用户提问并在同一会话形成方案', () => {
    const map = snapshot();
    const annotation = {
      id: 'annotation.continue',
      type: 'change' as const,
      status: 'sent' as const,
      target: { nodeIds: ['orders'], mapRevision: 1 },
      messages: [{ id: 'q', author: 'user' as const, body: '继续处理', createdAt: map.createdAt }],
      createdAt: map.createdAt,
    };
    const task = formatAnnotationTask(annotation.id, {
      ...map,
      annotations: new Map([[annotation.id, annotation]]),
    });

    expect(task).toContain('GOD_VIEW_USER_QUESTION:');
    expect(task).toContain('不要输出完成标记');
    expect(task).toContain('用户回答后在同一会话继续');
  });
});
