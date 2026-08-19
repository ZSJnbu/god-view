import type cytoscape from 'cytoscape';

/** VS Code 主题样式；可信度同时用颜色和边框编码，避免只靠颜色传达状态。 */
export function graphStylesheet(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-size': 12,
        color: 'data(textColor)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '160px',
        shape: 'round-rectangle',
        width: 'label',
        height: 36,
        padding: '12px',
        'background-color': 'data(fillColor)',
        'border-width': 1,
        'border-color': 'var(--vscode-panel-border)',
      },
    },
    {
      // 历史回放用体量表达代码规模。三档离散，最大档仍在布局占位内，不会压住邻居。
      selector: 'node[magnitude = "small"]',
      style: { height: 28, 'font-size': 11, padding: '8px' },
    },
    {
      selector: 'node[magnitude = "large"]',
      style: { height: 52, 'font-size': 14, padding: '16px' },
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
      style: { 'border-width': 3, 'border-color': 'var(--vscode-focusBorder)' },
    },
    {
      selector: 'edge',
      style: {
        label: '',
        'curve-style': 'round-segments',
        'segment-distances': 0,
        'segment-weights': 0.5,
        'segment-radii': [9],
        'radius-type': 'influence-radius',
        'edge-distances': 'node-position',
        width: 2,
        'line-color': 'data(color)',
        'line-opacity': 0.82,
        'line-outline-width': 3,
        'line-outline-color': 'var(--vscode-editor-background)',
        'line-cap': 'round',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'data(color)',
        'target-arrow-fill': 'filled',
        'source-distance-from-node': 4,
        'target-distance-from-node': 4,
      },
    },
    {
      selector: 'edge.selection-related, edge.hover-related, edge.hovered, edge:selected',
      style: {
        width: 3,
        'line-opacity': 1,
        'z-index': 10,
      },
    },
    {
      selector: 'node.map-updated',
      style: {
        'border-width': 5,
        'border-color': 'var(--vscode-charts-yellow)',
        'overlay-opacity': 0.12,
        'overlay-color': 'var(--vscode-charts-yellow)',
        'overlay-padding': 10,
      },
    },
    {
      selector: 'edge.map-updated',
      style: {
        width: 4,
        'line-opacity': 1,
        'overlay-opacity': 0.1,
        'overlay-color': 'var(--vscode-charts-yellow)',
        'overlay-padding': 6,
      },
    },
    { selector: '.story-dimmed', style: { opacity: 0.18 } },
    {
      selector: 'node.story-highlighted',
      style: { opacity: 1, 'border-width': 4, 'border-color': 'var(--vscode-focusBorder)' },
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
    { selector: 'edge.story-flow', style: { 'line-style': 'dashed' } },
  ];
}
