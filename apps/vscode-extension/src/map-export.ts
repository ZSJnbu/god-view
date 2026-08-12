import type { GraphSnapshotDocument } from '@god-view/protocol';

/** 导出的是可校验协议快照，不包含源码正文；格式化便于代码审查与选择性提交。 */
export function serializeMapExport(document: GraphSnapshotDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function mapExportFileName(branchKey: string): string {
  const safeBranch = branchKey.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return `god-view-map-${safeBranch === '' ? 'default' : safeBranch}.json`;
}
