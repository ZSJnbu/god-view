import { describe, expect, it } from 'vitest';
import type { GraphNode } from '@god-view/protocol';
import { projectChangeContextNodeIds } from './map-panel-commands.js';

const timestamp = '2026-08-14T00:00:00.000Z';

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: 'module',
    label: id,
    source: { kind: 'agent_declared', actor: { kind: 'agent' }, declaredAt: timestamp },
    codeValidation: { status: 'unverified' },
    userConfirmation: { status: 'unconfirmed' },
    lifecycle: { status: 'active' },
    updatedAt: timestamp,
    revision: 1,
    ...extra,
  };
}

describe('projectChangeContextNodeIds', () => {
  it('未选择节点时只取稳定排序的活跃顶层语义节点', () => {
    const nodes = new Map<string, GraphNode>([
      ['child', node('child', { parentId: 'root.z' })],
      ['file', node('file', { type: 'file' })],
      ['removed', node('removed', { lifecycle: { status: 'removed' } })],
      ['root.z', node('root.z', { type: 'group' })],
      ['root.a', node('root.a', { type: 'entry' })],
    ]);

    expect(projectChangeContextNodeIds(nodes)).toEqual(['root.a', 'root.z']);
  });

  it('异常地图没有根节点时回退到非文件语义节点', () => {
    const nodes = new Map<string, GraphNode>([
      ['module.b', node('module.b', { parentId: 'module.a' })],
      ['module.a', node('module.a', { parentId: 'module.b' })],
      ['file', node('file', { type: 'file', parentId: 'module.a' })],
    ]);

    expect(projectChangeContextNodeIds(nodes)).toEqual(['module.a', 'module.b']);
  });
});
