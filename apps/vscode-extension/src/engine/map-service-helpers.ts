import { workspace } from 'vscode';
import { listNodes, type GraphSnapshot } from '@god-view/graph-core';
import type { WorkspacePath } from '@god-view/protocol';
export { publicDocument } from './public-document.js';

export function declaredPaths(snapshot: GraphSnapshot): readonly WorkspacePath[] {
  return listNodes(snapshot).flatMap((node) => node.paths ?? []);
}

export function readReducedMotion(): boolean {
  const setting = workspace.getConfiguration('workbench').get<string>('reduceMotion');
  return setting === 'on' || setting === 'auto';
}
