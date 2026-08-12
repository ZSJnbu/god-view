import type { Identifier } from '@god-view/protocol';
import { listNodes } from '@god-view/graph-core';
import type { GraphSnapshot } from '@god-view/graph-core';

/**
 * 文件变化 → 受影响实体的映射。
 *
 * 增量刷新只重新校验这里选出的实体（TECHNICAL_ARCHITECTURE.md §9.2）。选漏一个
 * 实体的后果不是报错，而是漂移结论停留在上一次的状态——UI 看起来一切正常，
 * 实际已经不再反映磁盘。因此这段逻辑必须独立可测，不能埋在依赖 `vscode` 的服务里。
 */

/** 统一分隔符、去掉 `./` 前缀与结尾斜杠，便于前缀比较。 */
function normalize(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

/**
 * 声明路径是否被这次变化波及。
 *
 * 三种情况都算：路径本身变化、声明的是目录而变化发生在目录内部、
 * 以及变化的是声明路径的**祖先目录**——删除或重命名 `src/` 时，
 * 文件系统只报告 `src` 一条，声明 `src/payment` 的节点同样受影响。
 */
function isImpacted(declared: string, changed: string): boolean {
  const target = normalize(declared);
  const source = normalize(changed);
  if (target === '' || source === '') {
    return false;
  }
  return target === source || source.startsWith(`${target}/`) || target.startsWith(`${source}/`);
}

/**
 * 变化路径命中的实体 ID。
 *
 * 同时考虑 `paths` 与 `locations`：只看 `paths` 会漏掉「节点仅通过 locations 引用
 * 某个文件」的情况，而全量校验是把两者合并后一起验证的。这种不一致的表现正是
 * 「全量校验结果正确、增量刷新没反应」。
 */
export function affectedNodeIds(
  snapshot: GraphSnapshot,
  changedPaths: readonly string[],
): readonly Identifier[] {
  if (changedPaths.length === 0) {
    return [];
  }
  const ids = new Set<Identifier>();
  for (const node of listNodes(snapshot)) {
    const declared = [...(node.paths ?? []), ...(node.locations ?? []).map((one) => one.path)];
    if (declared.some((entry) => changedPaths.some((changed) => isImpacted(entry, changed)))) {
      ids.add(node.id);
    }
  }
  return [...ids];
}

/**
 * 绝对路径转工作区相对路径。
 *
 * 返回 undefined 表示不在工作区内或就是工作区根本身，调用方应当忽略。
 * Windows 上盘符大小写可能与工作区根不一致，因此前缀比较不区分大小写，
 * 但返回的仍是原始大小写的后缀——路径要拿去和地图里的声明比对，不能被改写。
 */
export function toWorkspaceRelative(rootFsPath: string, targetFsPath: string): string | undefined {
  const root = normalize(rootFsPath);
  const target = normalize(targetFsPath);
  if (root === '' || target === '' || target.length <= root.length) {
    return undefined;
  }
  const prefix = target.slice(0, root.length);
  const matches = prefix === root || prefix.toLowerCase() === root.toLowerCase();
  if (!matches || target[root.length] !== '/') {
    return undefined;
  }
  const relative = target.slice(root.length + 1);
  return relative === '' ? undefined : relative;
}
