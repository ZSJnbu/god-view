import {
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  type Event,
  type TreeDataProvider,
} from 'vscode';
import { listChildren, listRootNodes } from '@god-view/graph-core';
import type { GraphNode } from '@god-view/protocol';
import { commandIds } from '../constants.js';
import type { MapService } from '../engine/map-service.js';

/**
 * 侧边栏结构树。
 *
 * 与地图共享同一份快照，不维护第二份状态：树只是同一真源的另一种呈现。
 * 它也是无障碍路径——不依赖画布交互就能浏览整个项目结构。
 */
export class StructureTreeProvider implements TreeDataProvider<GraphNode> {
  readonly #service: MapService;
  readonly #changed = new EventEmitter<GraphNode | undefined>();

  readonly onDidChangeTreeData: Event<GraphNode | undefined> = this.#changed.event;

  constructor(service: MapService) {
    this.#service = service;
  }

  refresh(): void {
    this.#changed.fire(undefined);
  }

  getTreeItem(element: GraphNode): TreeItem {
    const hasChildren = listChildren(this.#service.snapshot, element.id).length > 0;
    const item = new TreeItem(
      element.label,
      hasChildren ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.description = describe(element);
    item.tooltip = element.responsibility ?? element.label;
    item.iconPath = new ThemeIcon(iconFor(element));
    item.command = {
      command: commandIds.openProjectMap,
      title: '在地图中查看',
      arguments: [element.id],
    };
    return item;
  }

  getChildren(element?: GraphNode): GraphNode[] {
    const snapshot = this.#service.snapshotOrUndefined;
    if (snapshot === undefined) {
      return [];
    }
    const nodes =
      element === undefined ? listRootNodes(snapshot) : listChildren(snapshot, element.id);
    return [...nodes].sort((left, right) => left.label.localeCompare(right.label));
  }
}

/**
 * 描述文本区分「代码可证实」和「仅 Agent 声明」。
 *
 * 树视图同样不得把声明呈现为事实（TECHNICAL_ARCHITECTURE.md §11）。
 */
function describe(node: GraphNode): string {
  const parts: string[] = [];
  if (node.codeValidation.status === 'verified') {
    parts.push(`已证实 ${node.codeValidation.level ?? 'L0'}`);
  } else if (node.codeValidation.status === 'drifted') {
    parts.push('已漂移');
  } else if (node.source.kind === 'agent_declared') {
    parts.push('Agent 声明');
  }
  if (node.lifecycle.status === 'in_progress' || node.lifecycle.status === 'planned') {
    parts.push('进行中');
  }
  return parts.join(' · ');
}

function iconFor(node: GraphNode): string {
  switch (node.type) {
    case 'entry':
      return 'rocket';
    case 'group':
      return 'folder';
    case 'file':
      return 'file-code';
    case 'service':
      return 'server-process';
    case 'storage':
      return 'database';
    case 'external_system':
      return 'globe';
    case 'unclassified':
      return 'question';
    case 'module':
      return 'symbol-namespace';
  }
}
