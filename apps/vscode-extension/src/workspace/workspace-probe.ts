import { workspace, type Uri } from 'vscode';
import type { WorkspaceProbe } from '@god-view/validation-core';
import type { WorkspacePath } from '@god-view/protocol';
import { resolveWorkspacePath } from './workspace-identity.js';

/**
 * 基于 VS Code 文件系统的只读探针。
 *
 * 把文件访问收敛到 validation-core 定义的端口，使校验逻辑保持可测试，
 * 并让远程/容器环境下的路径解析交由 VS Code 处理。
 */
export class VsCodeWorkspaceProbe implements WorkspaceProbe {
  readonly #root: Uri;
  readonly #firstPartyFiles: () => Promise<readonly WorkspacePath[]>;

  constructor(root: Uri, firstPartyFiles: () => Promise<readonly WorkspacePath[]>) {
    this.#root = root;
    this.#firstPartyFiles = firstPartyFiles;
  }

  async exists(path: WorkspacePath): Promise<boolean> {
    const uri = resolveWorkspacePath(this.#root, path);
    if (uri === undefined) {
      // 工作区外路径一律视为不存在，而不是去读取它。
      return false;
    }
    try {
      await workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  async readText(path: WorkspacePath): Promise<string | undefined> {
    const uri = resolveWorkspacePath(this.#root, path);
    if (uri === undefined) return undefined;
    try {
      const bytes = await workspace.fs.readFile(uri);
      if (bytes.byteLength > 1024 * 1024) return undefined;
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }

  listFirstPartyFiles(): Promise<readonly WorkspacePath[]> {
    return this.#firstPartyFiles();
  }
}
