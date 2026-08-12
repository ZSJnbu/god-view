import { RelativePattern, workspace, type Disposable, type Uri } from 'vscode';
import { toWorkspaceRelative } from './path-impact.js';

/** 聚合工作区源码变化；排除 God View 运行时目录，避免发布 map.json 引起自激。 */
export function watchSourceChanges(input: {
  readonly root: Uri;
  readonly runtimeDirectoryName: string;
  readonly debounceMs: number;
  readonly refresh: (paths: readonly string[]) => void;
}): Disposable {
  const changedPaths = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = workspace.createFileSystemWatcher(new RelativePattern(input.root, '**/*'));
  const onChange = (uri: Uri): void => {
    const relative = toWorkspaceRelative(input.root.fsPath, uri.fsPath);
    if (relative === undefined || relative.startsWith(`${input.runtimeDirectoryName}/`)) return;
    changedPaths.add(relative);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const paths = [...changedPaths];
      changedPaths.clear();
      input.refresh(paths);
    }, input.debounceMs);
  };
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);
  return {
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      watcher.dispose();
    },
  };
}
