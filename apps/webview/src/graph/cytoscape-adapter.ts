import cytoscape from 'cytoscape';
import type {
  CollectionReturnValue,
  Core,
  ElementDefinition,
  NodeSingular,
  Position,
} from 'cytoscape';
import type { GuidedStoryStep, Identifier } from '@god-view/protocol';
import type { LayoutPositions } from '../model/store.js';
import type { VisibleGraph } from '../model/view-model.js';
import { badgesFor, isFailed, isInProgress, nodeTypeLabels } from '../model/presentation.js';
import { edgeTypeLabels } from '../model/edge-presentation.js';
import { routeEdges } from './edge-routing.js';
import { graphStylesheet } from './graph-stylesheet.js';
import { measureRouting } from './routing-metrics.js';
import {
  countNodeOverlaps,
  resolveDraggedOverlap,
  resolveRenderedOverlaps,
  type NodeRectangle,
} from './node-overlap.js';

export interface GraphViewCallbacks {
  readonly onSelect: (id: Identifier | undefined) => void;
  readonly onActivate: (id: Identifier) => void;
  readonly onPositionsChanged: (positions: LayoutPositions) => void;
  readonly onRelationHover: (relation: RelationHover | undefined) => void;
}

export interface RelationHover {
  readonly id: Identifier;
  readonly title: string;
  readonly description: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
}

export interface RenderOptions {
  readonly positions: LayoutPositions;
  readonly selectedId: Identifier | undefined;
  readonly reducedMotion: boolean;
  readonly topologyRevision: number;
  readonly changedNodeIds: readonly Identifier[];
  readonly changedEdgeIds: readonly Identifier[];
}

interface ElementData {
  readonly id: string;
  readonly source: string | undefined;
  readonly target: string | undefined;
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
  readonly #container: HTMLElement;
  #rendered = false;
  #transitionToken = 0;
  #visibleGraph: VisibleGraph | undefined;

  constructor(container: HTMLElement, callbacks: GraphViewCallbacks) {
    this.#callbacks = callbacks;
    this.#container = container;
    this.#cy = cytoscape({
      container,
      style: graphStylesheet(),
      // 位置全部由布局引擎给出，这里关闭 Cytoscape 自带布局，避免两套布局互相打架。
      layout: { name: 'preset' },
      wheelSensitivity: 0.2,
      pixelRatio: 1,
    });
    this.#bindEvents();
  }

  async render(graph: VisibleGraph, options: RenderOptions): Promise<boolean> {
    this.#visibleGraph = graph;
    this.#container.dataset['topologyRevision'] = String(options.topologyRevision);
    this.#container.dataset['inlineEdgeLabels'] = 'false';
    const elements = toElements(graph, options.positions);
    const token = ++this.#transitionToken;
    this.#cy.elements().stop(true, false);
    this.#cy.stop(true, false);
    // stop() 会把被中断动画的当前 opacity 留成 bypass style。若上一轮恰好停在
    // 淡入前，元素仍存在但会永久透明，表现为“局部重绘后其余内容消失”。每一轮
    // 都先清掉仅属于转场的透明度，再从当前可见画面继续。
    this.#restoreTransitionVisibility();
    if (!this.#rendered || options.reducedMotion) {
      this.#replaceImmediately(elements, options.selectedId);
      this.#resolveCurrentNodeOverlaps();
      this.#rendered = true;
      this.#setTransitioning(false);
      this.#routeCurrentEdges();
      this.#updateRenderMetrics();
      this.#pulseChanged(options);
      return true;
    }

    this.#setTransitioning(true);
    const targetIds = new Set(elements.map((element) => readElementData(element).id));
    const leaving = this.#cy.elements().filter((element) => !targetIds.has(element.id()));
    if (!leaving.empty()) {
      leaving.animate(
        { style: { opacity: 0 } },
        { duration: 140, easing: 'ease-out', queue: false },
      );
      await wait(150);
      if (token !== this.#transitionToken) return false;
      leaving.remove();
    }

    const previousPositions = new Map(
      this.#cy.nodes().map((node) => [node.id(), { ...node.position() }] as const),
    );
    const existingIds = new Set(this.#cy.elements().map((element) => element.id()));
    const newDefinitions = elements.filter(
      (element) => !existingIds.has(readElementData(element).id),
    );
    const newIds = new Set(newDefinitions.map((element) => readElementData(element).id));
    const existingDefinitions = elements.filter((element) =>
      existingIds.has(readElementData(element).id),
    );

    this.#cy.batch(() => {
      for (const definition of existingDefinitions) {
        const { id, source, target } = readElementData(definition);
        const current = this.#cy.getElementById(id);
        if (
          current.isEdge() &&
          (current.data('source') !== source || current.data('target') !== target)
        ) {
          current.remove();
          newDefinitions.push(definition);
        } else {
          current.data(definition.data);
        }
      }
      for (const definition of newDefinitions) {
        const { id } = readElementData(definition);
        const position =
          definition.group === 'nodes'
            ? entryPosition(id, graph, previousPositions, options.positions)
            : undefined;
        this.#cy.add({
          ...definition,
          ...(position === undefined ? {} : { position }),
        });
        this.#cy.getElementById(id).style('opacity', 0);
      }
      this.#applySelection(options.selectedId);
    });

    const movedNodes = graph.nodes.filter(({ node }) => {
      const target = options.positions[node.id];
      const current = this.#cy.getElementById(node.id);
      return (
        target !== undefined &&
        !current.empty() &&
        (newIds.has(node.id) ||
          Math.abs(current.position('x') - target.x) > 0.5 ||
          Math.abs(current.position('y') - target.y) > 0.5)
      );
    });
    const newEdges = [...newIds].some((id) => !this.#cy.getElementById(id).empty() && this.#cy.getElementById(id).isEdge());

    // 只有结构或坐标真的变化时才启动转场；文本/状态补丁只更新数据并立即完成，
    // 避免每次 MCP 事实更新都让整张图重新淡入淡出。
    if (leaving.empty() && movedNodes.length === 0 && !newEdges) {
      this.#restoreTransitionVisibility();
      this.#resolveCurrentNodeOverlaps();
      this.#routeCurrentEdges();
      this.#setTransitioning(false);
      this.#updateRenderMetrics();
      this.#pulseChanged(options);
      return true;
    }

    for (const { node } of movedNodes) {
      const target = options.positions[node.id];
      const element = this.#cy.getElementById(node.id);
      if (target === undefined || element.empty()) continue;
      element.animate(
        { position: target, style: { opacity: 1 } },
        { duration: 320, easing: 'ease-in-out-cubic', queue: false },
      );
    }
    if (newEdges) {
      this.#cy
        .edges()
        .animate({ style: { opacity: 1 } }, { duration: 260, easing: 'ease-in', queue: false });
    }
    await wait(330);
    if (token !== this.#transitionToken) return false;
    this.#restoreTransitionVisibility();
    this.#resolveCurrentNodeOverlaps();
    this.#routeCurrentEdges();
    this.#setTransitioning(false);
    this.#updateRenderMetrics();
    this.#pulseChanged(options);
    return true;
  }

  #pulseChanged(options: RenderOptions): void {
    if (options.reducedMotion) return;
    const changed = this.#cy.collection();
    let elements = changed;
    for (const id of [...options.changedNodeIds, ...options.changedEdgeIds]) {
      const element = this.#cy.getElementById(id);
      if (!element.empty()) elements = elements.union(element);
    }
    if (elements.empty()) return;
    elements.addClass('map-updated');
    setTimeout(() => {
      if (!this.#cy.destroyed()) elements.removeClass('map-updated');
    }, 900);
  }

  #replaceImmediately(elements: ElementDefinition[], selectedId: Identifier | undefined): void {
    this.#cy.batch(() => {
      this.#cy.elements().remove();
      this.#cy.add(elements);
      this.#applySelection(selectedId);
    });
  }

  #setTransitioning(value: boolean): void {
    this.#container.dataset['transitioning'] = String(value);
    this.#container.setAttribute('aria-busy', String(value));
  }

  #restoreTransitionVisibility(): void {
    this.#cy.elements().removeStyle('opacity');
  }

  #updateRenderMetrics(): void {
    const nodes = this.#cy.nodes();
    const edges = this.#cy.edges();
    this.#container.dataset['renderedNodes'] = String(nodes.length);
    this.#container.dataset['renderedEdges'] = String(edges.length);
    this.#container.dataset['visibleNodes'] = String(
      nodes.filter((node) => node.effectiveOpacity() > 0.01).length,
    );
    this.#container.dataset['visibleEdges'] = String(
      edges.filter((edge) => edge.effectiveOpacity() > 0.01).length,
    );
    this.#container.dataset['moduleColors'] = String(
      new Set(nodes.map((node) => String(node.data('fillColor')))).size,
    );
    this.#container.dataset['nodeOverlaps'] = String(countNodeOverlaps(this.#nodeRectangles()));
  }

  #nodeRectangles(): NodeRectangle[] {
    return this.#cy.nodes().map((node) => ({
      id: node.id(),
      position: { ...node.position() },
      width: node.outerWidth(),
      height: node.outerHeight(),
    }));
  }

  #resolveCurrentNodeOverlaps(): void {
    const nodes = this.#nodeRectangles();
    if (countNodeOverlaps(nodes) === 0) return;
    const positions = resolveRenderedOverlaps(nodes);
    this.#cy.batch(() => {
      for (const [id, position] of Object.entries(positions)) {
        this.#cy.getElementById(id).position(position);
      }
    });
    this.#callbacks.onPositionsChanged(positions);
  }

  #routeCurrentEdges(): void {
    const graph = this.#visibleGraph;
    if (graph === undefined) return;
    const routed = routeEdges(
      this.#cy.nodes().map((node) => ({
        id: node.id(),
        position: { ...node.position() },
        width: node.outerWidth(),
        height: node.outerHeight(),
      })),
      graph.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
    );
    const metrics = measureRouting(
      this.#cy.nodes().map((node) => ({
        id: node.id(),
        position: { ...node.position() },
        width: node.outerWidth(),
        height: node.outerHeight(),
      })),
      graph.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
      routed,
    );
    this.#container.dataset['edgeCrossings'] = String(metrics.crossings);
    this.#container.dataset['edgeNodeIntersections'] = String(metrics.nodeIntersections);
    this.#container.dataset['edgeOverlappingPairs'] = String(metrics.overlappingPairs);
    this.#container.dataset['edgeOverlapLength'] = String(Math.round(metrics.overlapLength));
    this.#cy.batch(() => {
      let bridgeCount = 0;
      for (const route of routed.values()) {
        const edge = this.#cy.getElementById(route.id);
        if (edge.empty()) continue;
        const controls = segmentControls(
          edge.source().position(),
          edge.target().position(),
          route.points.slice(1, -1),
        );
        edge.data({
          bridges: route.bridges,
        });
        if (controls.distances.length === 0) {
          // Cytoscape 会把空控制点数组解析成无效的 segments 样式，整条线有效透明度
          // 变为 0。拖动后直连关系最容易命中这个分支，因此必须显式恢复默认直线控制点。
          edge.style({ 'segment-distances': 0, 'segment-weights': 0.5 });
        } else {
          edge.style({
            'segment-distances': controls.distances,
            'segment-weights': controls.weights,
          });
        }
        bridgeCount += route.bridges;
      }
      this.#container.dataset['edgeBridges'] = String(bridgeCount);
    });
  }

  /**
   * 只更新选择高亮；普通点击不得改变镜头或重新布局。
   * 搜索和详情同样不能借 selection 偷偷移动镜头；需要恢复视口时由用户显式点「显示完整地图」。
   */
  select(id: Identifier | undefined): void {
    // 选择和拖动都不是结构转场；顺手清理任何被旧转场遗留的透明 bypass。
    this.#restoreTransitionVisibility();
    this.#applySelection(id);
    this.#updateRenderMetrics();
  }

  #applySelection(id: Identifier | undefined): void {
    this.#cy.nodes().unselect();
    this.#cy.edges().removeClass('selection-related');
    if (id === undefined) return;
    const target = this.#cy.getElementById(id);
    if (target.empty()) return;
    target.select();
    target.connectedEdges().addClass('selection-related');
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

  fit(animate = false): void {
    if (!animate) {
      this.#cy.fit(this.#cy.elements(), 60);
      return;
    }
    this.#cy
      .stop(true, false)
      .animate(
        { fit: { eles: this.#cy.elements(), padding: 60 } },
        { duration: 240, easing: 'ease-out-cubic', queue: false },
      );
  }

  resize(): void {
    this.#cy.resize();
  }

  destroy(): void {
    this.#transitionToken += 1;
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
    this.#cy.on('mouseover', 'node', (event) => {
      (event.target as NodeSingular).connectedEdges().addClass('hover-related');
    });
    this.#cy.on('mouseout', 'node', (event) => {
      (event.target as NodeSingular).connectedEdges().removeClass('hover-related');
    });
    this.#cy.on('mouseover', 'edge', (event) => {
      const edge = event.target as CollectionReturnValue;
      edge.addClass('hovered');
      const rendered = readRenderedPosition(event);
      this.#callbacks.onRelationHover({
        id: edge.id(),
        title: String(edge.data('relationTitle') ?? '关系'),
        description: String(edge.data('description') ?? ''),
        fromLabel: String(edge.source().data('label') ?? edge.source().id()),
        toLabel: String(edge.target().data('label') ?? edge.target().id()),
        color: String(edge.data('color') ?? '#94a3b8'),
        x: rendered.x,
        y: rendered.y,
      });
    });
    this.#cy.on('mouseout', 'edge', (event) => {
      (event.target as CollectionReturnValue).removeClass('hovered');
      this.#callbacks.onRelationHover(undefined);
    });
    this.#cy.on('dragfreeon', 'node', (event) => {
      this.#restoreTransitionVisibility();
      const node = event.target as NodeSingular;
      const moved: NodeRectangle = {
        id: node.id(),
        position: { ...node.position() },
        width: node.outerWidth(),
        height: node.outerHeight(),
      };
      const position = resolveDraggedOverlap(
        moved,
        this.#nodeRectangles().filter((other) => other.id !== moved.id),
      );
      node.position(position);
      this.#routeCurrentEdges();
      this.#callbacks.onPositionsChanged({ [node.id()]: position });
      this.#updateRenderMetrics();
    });
  }
}

function readRenderedPosition(event: unknown): Position {
  const candidate = event as { renderedPosition?: unknown; position?: unknown };
  for (const value of [candidate.renderedPosition, candidate.position]) {
    if (typeof value !== 'object' || value === null) continue;
    const position = value as { x?: unknown; y?: unknown };
    if (typeof position.x === 'number' && typeof position.y === 'number') {
      return { x: position.x, y: position.y };
    }
  }
  return { x: 24, y: 24 };
}

function readElementData(definition: ElementDefinition): ElementData {
  const value: unknown = definition.data;
  if (typeof value !== 'object' || value === null) {
    throw new Error('Graph element is missing data');
  }
  const data = value as Record<string, unknown>;
  const id = data['id'];
  if (typeof id !== 'string') {
    throw new Error('Graph element is missing a string id');
  }
  return {
    id,
    source: typeof data['source'] === 'string' ? data['source'] : undefined,
    target: typeof data['target'] === 'string' ? data['target'] : undefined,
  };
}

function entryPosition(
  id: Identifier,
  graph: VisibleGraph,
  previous: ReadonlyMap<Identifier, Position>,
  targets: LayoutPositions,
): Position | undefined {
  const neighbours = graph.edges.flatMap((edge) =>
    edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [],
  );
  const anchors = neighbours
    .map((neighbour) => previous.get(neighbour))
    .filter((position): position is Position => position !== undefined);
  const fallback = [...previous.values()];
  const candidates = anchors.length > 0 ? anchors : fallback;
  if (candidates.length === 0) return targets[id];
  return {
    x: candidates.reduce((sum, position) => sum + position.x, 0) / candidates.length,
    y: candidates.reduce((sum, position) => sum + position.y, 0) / candidates.length,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toElements(graph: VisibleGraph, positions: LayoutPositions): ElementDefinition[] {
  const colors = assignModuleColors(graph);
  const nodes: ElementDefinition[] = graph.nodes.map(({ node, rolledUpCount }) => {
    const badges = badgesFor(node);
    const position = positions[node.id];
    const color = colors.get(node.id) ?? defaultModuleColor;
    return {
      group: 'nodes',
      data: {
        id: node.id,
        label: rolledUpCount > 0 ? `${node.label}  (+${String(rolledUpCount)})` : node.label,
        kind: nodeTypeLabels[node.type],
        trust: badges.trust,
        state: isFailed(node) ? 'failed' : isInProgress(node) ? 'pending' : 'settled',
        fillColor: color.fill,
        edgeColor: color.edge,
        textColor: color.text,
      },
      ...(position === undefined ? {} : { position: { x: position.x, y: position.y } }),
    };
  });

  const edges: ElementDefinition[] = graph.edges.map((edge) => {
    return {
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        color: (colors.get(edge.from) ?? defaultModuleColor).edge,
        relationTitle: `${edgeTypeLabels[edge.type]}${edge.count > 1 ? ` ×${String(edge.count)}` : ''}`,
        description: shorten(edge.description, 180),
      },
    };
  });

  return [...nodes, ...edges];
}

function shorten(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

interface ModuleColor {
  readonly fill: string;
  readonly edge: string;
  readonly text: string;
}

const modulePalette: readonly ModuleColor[] = [
  { fill: '#1d4ed8', edge: '#60a5fa', text: '#ffffff' },
  { fill: '#047857', edge: '#34d399', text: '#ffffff' },
  { fill: '#6d28d9', edge: '#a78bfa', text: '#ffffff' },
  { fill: '#9a3412', edge: '#fb923c', text: '#ffffff' },
  { fill: '#be123c', edge: '#fb7185', text: '#ffffff' },
  { fill: '#0e7490', edge: '#22d3ee', text: '#ffffff' },
  { fill: '#3f6212', edge: '#a3e635', text: '#ffffff' },
  { fill: '#7e22ce', edge: '#d8b4fe', text: '#ffffff' },
  { fill: '#334155', edge: '#94a3b8', text: '#ffffff' },
  { fill: '#a16207', edge: '#facc15', text: '#ffffff' },
  { fill: '#0f766e', edge: '#5eead4', text: '#ffffff' },
  { fill: '#4338ca', edge: '#818cf8', text: '#ffffff' },
];
const defaultModuleColor: ModuleColor = modulePalette[0] ?? {
  fill: '#1d4ed8',
  edge: '#60a5fa',
  text: '#ffffff',
};

function assignModuleColors(graph: VisibleGraph): ReadonlyMap<Identifier, ModuleColor> {
  const result = new Map<Identifier, ModuleColor>();
  const used = new Set<number>();
  for (const { node } of [...graph.nodes].sort((left, right) =>
    left.node.id.localeCompare(right.node.id),
  )) {
    const preferred = stableHash(node.id) % modulePalette.length;
    let slot = preferred;
    while (used.has(slot) && used.size < modulePalette.length) {
      slot = (slot + 1) % modulePalette.length;
    }
    used.add(slot);
    result.set(node.id, modulePalette[slot] ?? defaultModuleColor);
  }
  return result;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function segmentControls(
  source: Position,
  target: Position,
  points: readonly Position[],
): { readonly distances: number[]; readonly weights: number[] } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const lengthSquared = dx * dx + dy * dy;
  const length = Math.sqrt(lengthSquared);
  if (length < 0.001 || points.length === 0) return { distances: [], weights: [] };
  return {
    weights: points.map(
      (point) =>
        Math.round(
          (((point.x - source.x) * dx + (point.y - source.y) * dy) / lengthSquared) * 1000,
        ) / 1000,
    ),
    distances: points.map(
      (point) =>
        Math.round((((point.x - source.x) * -dy + (point.y - source.y) * dx) / length) * 1000) /
        1000,
    ),
  };
}
