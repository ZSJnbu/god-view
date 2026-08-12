import { createHash } from 'node:crypto';
import { Uri, workspace } from 'vscode';
import type { Identifier } from '@god-view/protocol';
import { isFsPathWithinRoot } from './path-boundary.js';

export interface WorkspaceIdentity {
  readonly id: Identifier;
  readonly root: Uri;
  readonly name: string;
}

/**
 * 工作区身份。
 *
 * 多根工作区中每个 root 有独立 identity、覆盖率与分支状态，禁止默认取第一个 root
 * （CODING_STANDARDS.md §11）。调用方必须显式选择 root。
 */
export function identityForRoot(root: Uri, name: string): WorkspaceIdentity {
  // 使用规范化路径哈希：工作区移动后路径变化会产生新身份，
  // 由 storage 的迁移路径处理，而不是让两个工作区共用一份地图。
  const digest = createHash('sha256').update(root.fsPath).digest('hex').slice(0, 16);
  return { id: `ws-${digest}`, root, name };
}

export function listWorkspaceIdentities(): readonly WorkspaceIdentity[] {
  return (workspace.workspaceFolders ?? []).map((folder) =>
    identityForRoot(folder.uri, folder.name),
  );
}

/**
 * 把 Agent 或 Webview 提供的路径解析回工作区内的 URI。
 *
 * 拒绝绝对路径、`..` 穿越和解析后逃逸出工作区的路径
 * （TECHNICAL_ARCHITECTURE.md §12.1）。
 */
export function resolveWorkspacePath(root: Uri, relativePath: string): Uri | undefined {
  const normalized = relativePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
    return undefined;
  }
  if (normalized.split('/').includes('..')) {
    return undefined;
  }
  const candidate = Uri.joinPath(root, normalized);
  // Windows 的 `Uri`/文件系统会把盘符大小写规范化为不同形态（`d:`/`D:`）。
  // 路径逃逸判断必须遵循平台大小写语义，否则合法工作区文件会被误判为工作区外。
  return isFsPathWithinRoot(root.fsPath, candidate.fsPath) ? candidate : undefined;
}
