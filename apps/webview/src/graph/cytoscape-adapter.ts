import cytoscape from 'cytoscape';
import type { CollectionReturnValue, Core, ElementDefinition, NodeSingular } from 'cytoscape';
import type { GuidedStoryStep, Identifier } from '@god-view/protocol';
import type { LayoutPositions } from '../model/store.js';
import type { VisibleGraph } from '../model/view-model.js';
import { badgesFor, isFailed, isInProgress, nodeTypeLabels } from '../model/presentation.js';

export interface GraphViewCallbacks {
  readonly onSelect: (id: Identifier | undefined) => void;
  readonly onActivate: (id: Identifier) => void;
  readonly onPositionsChanged: (positions: LayoutPositions) => void;
}

export interface RenderOptions {
  readonly positions: LayoutPositions;
  readonly selectedId: Identifier | undefined;
  readonly reducedMotion: boolean;
}

/**
 * Cytoscape 适配层。
 *
 * 只负责把可见图映射成渲染元素与交互事件，不持有业务状态：所有真源在 AppStore
 * 中（TECHNICAL_ARCHITECTURE.md §10.1）。选择与悬停不触发重新布局（§10.2）。
 */
export class CytoscapeAdapter {
  readonly #cy: Core;
  readonly #callbacks: GraphViewCallbacks;

  constructor(container: HTMLElement, callbacks: GraphViewCallbacks) {
    this.#callbacks = callbacks;
    this.#cy = cytoscape({
      container,
      style: stylesheet(),
      // 位置全部由布局引擎给出，这里关闭 Cytoscape 自带布局，避免两套布局互相打架。
      layout: { name: 'preset' },
      wheelSensitivity: 0.2,
      pixelRatio: 1,
    });
    this.#bindEvents();
  }

  render(graph: VisibleGraph, options: RenderOptions): void {
    const elements = toElements(graph, options.positions);
    this.#cy.batch(() => {
      this.#cy.elements().remove();
      this.#cy.add(elements);
      this.#cy.nodes().unselect();
      if (options.selectedId !== undefined) {
        this.#cy.getElementById(options.selectedId).select();
      }
    });
  }

  /** 把镜头移到目标节点。减少动态效果时直接跳转，不做补间。 */
  focus(id: Identifier, reducedMotion: boolean): void {
    const target = this.#cy.getElementById(id);
    if (target.empty()) {
      return;
    }
    if (reducedMotion) {
      this.#cy.center(target);
      return;
    }
    this.#cy.animate({ center: { eles: target }, zoom: 1 }, { duration: 200 });
  }

  /** 应用讲解高亮与镜头；只改样式和视口，不重新布局。 */
  setStoryStep(step: GuidedStoryStep | undefined, reducedMotion: boolean): void {
    const all = this.#cy.elements();
    all.removeClass('story-dimmed story-highlighted story-flow');
    if (step === undefined) {
      return;
    }
    all.addClass('story-dimmed');
    let targets: CollectionReturnValue = this.#cy.collection();
    for (const id of step.focusNodeIds) {
      const node = this.#cy.getElementById(id);
      node.removeClass('story-dimmed').addClass('story-highlighted');
      targets = targets.union(node);
    }
    for (const id of step.focusEdgeIds ?? []) {
      const edge = this.#cy.getElementById(id);
      edge.removeClass('story-dimmed').addClass('story-highlighted story-flow');
    }
    this.#moveStoryCamera(targets, step.cameraHint ?? 'focus', reducedMotion);
  }

  #moveStoryCamera(
    targets: CollectionReturnValue,
    hint: NonNullable<GuidedStoryStep['cameraHint']>,
    reducedMotion: boolean,
  ): void {
    if (hint === 'overview') {
      this.fit();
      return;
    }
    if (targets.empty()) {
      return;
    }
    if (reducedMotion) {
      if (hint === 'fit') {
        this.#cy.fit(targets, 60);
      } else {
        this.#cy.center(targets);
      }
      return;
    }
    this.#cy.animate(
      hint === 'fit'
        ? { fit: { eles: targets, padding: 60 } }
        : { center: { eles: targets }, zoom: 1 },
      { duration: 240 },
    );
  }

  fit(): void {
    this.#cy.fit(this.#cy.elements(), 60);
  }

  resize(): void {
    this.#cy.resize();
  }

  destroy(): void {
    this.#cy.destroy();
  }

  #bindEvents(): void {
    this.#cy.on('tap', 'node', (event) => {
      this.#callbacks.onSelect((event.target as NodeSingular).id());
    });
    this.#cy.on('tap', (event) => {
      if (event.target === this.#cy) {
        this.#callbacks.onSelect(undefined);
      }
    });
    this.#cy.on('dbltap', 'node', (event) => {
      this.#callbacks.onActivate((event.target as NodeSingular).id());
    });
    this.#cy.on('dragfreeon', 'node', (event) => {
      const node = event.target as NodeSingular;
      const { x, y } = node.position();
      this.#callbacks.onPositionsChanged({ [node.id()]: { x, y } });
    });
  }
}

function toElements(graph: VisibleGraph, positions: LayoutPositions): ElementDefinition[] {
  const nodes: ElementDefinition[] = graph.nodes.map(({ node, rolledUpCount }) => {
    const badges = badgesFor(node);
    const position = positions[node.id];
    return {
      group: 'nodes',
      data: {
        id: node.id,
        label: rolledUpCount > 0 ? `${node.label}  (+${String(rolledUpCount)})` : node.label,
        kind: nodeTypeLabels[node.type],
        trust: badges.trust,
        state: isFailed(node) ? 'failed' : isInProgress(node) ? 'pending' : 'settled',
      },
      ...(position === undefined ? {} : { position: { x: position.x, y: position.y } }),
    };
  });

  const edges: ElementDefinition[] = graph.edges.map((edge) => ({
    group: 'edges',
    data: {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      // 远景聚合边显示计数，让用户知道这里被折叠了多少条关系。
      label: edge.count > 1 ? `${edge.type} ×${String(edge.count)}` : edge.type,
    },
  }));

  return [...nodes, ...edges];
}

/**
 * 样式全部取 VS Code 主题变量，保证跟随用户主题而不是硬编码颜色。
 *
 * 可信度用颜色 + 边框样式双重编码：只靠颜色区分对色觉障碍用户不可用
 * （CODE_QUALITY_STANDARD.md 无障碍要求）。
 */
function stylesheet(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-size': 12,
        color: 'var(--vscode-foreground)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '160px',
        shape: 'round-rectangle',
        width: 'label',
        height: 36,
        padding: '12px',
        'background-color': 'var(--vscode-editorWidget-background)',
        'border-width': 1,
        'border-color': 'var(--vscode-panel-border)',
      },
    },
    {
      selector: 'node[trust = "code-verified"]',
      style: {
        'border-width': 2,
        'border-style': 'solid',
        'border-color': 'var(--vscode-charts-green)',
      },
    },
    {
      selector: 'node[trust = "declared"]',
      style: {
        'border-width': 2,
        // 虚线表示「只有声明、尚无代码证据」，不与已证实的实线混淆。
        'border-style': 'dashed',
        'border-color': 'var(--vscode-charts-blue)',
      },
    },
    {
      selector: 'node[trust = "conflicting"]',
      style: {
        'border-width': 2,
        'border-style': 'double',
        'border-color': 'var(--vscode-charts-red)',
      },
    },
    {
      selector: 'node[state = "pending"]',
      style: { 'background-color': 'var(--vscode-inputValidation-infoBackground)' },
    },
    {
      selector: 'node[state = "failed"]',
      style: { 'background-color': 'var(--vscode-inputValidation-errorBackground)' },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': 'var(--vscode-focusBorder)',
      },
    },
    {
      selector: 'edge',
      style: {
        label: 'data(label)',
        'font-size': 10,
        color: 'var(--vscode-descriptionForeground)',
        'curve-style': 'bezier',
        width: 1,
        'line-color': 'var(--vscode-panel-border)',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'var(--vscode-panel-border)',
        'text-background-color': 'var(--vscode-editor-background)',
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
      },
    },
    {
      selector: '.story-dimmed',
      style: { opacity: 0.18 },
    },
    {
      selector: 'node.story-highlighted',
      style: {
        opacity: 1,
        'border-width': 4,
        'border-color': 'var(--vscode-focusBorder)',
      },
    },
    {
      selector: 'edge.story-highlighted',
      style: {
        opacity: 1,
        width: 3,
        'line-color': 'var(--vscode-focusBorder)',
        'target-arrow-color': 'var(--vscode-focusBorder)',
      },
    },
    {
      selector: 'edge.story-flow',
      style: { 'line-style': 'dashed' },
    },
  ];
}
