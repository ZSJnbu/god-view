import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Uri, workspace } from 'vscode';
import type { GodViewEvent } from '@god-view/protocol';
import { MapService, type MapUpdate } from '../src/engine/map-service.js';
import { identityForRoot } from '../src/workspace/workspace-identity.js';
import type { LogFields, Logger } from '../src/logger.js';

/** 集成测试的共用装配。这里只做搭台，断言留在各个用例里。 */

/** 丢弃输出的 Logger。失败诊断靠断言消息，不靠日志。 */
export function silentLogger(): Logger {
  const noop = (_operation: string, _fields?: LogFields): void => {
    // 集成测试不需要日志输出。
  };
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}

export function workspaceRoot(): Uri {
  const folder = workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    throw new Error('集成测试需要一个已打开的工作区');
  }
  return folder.uri;
}

/** 工作区身份。事件信封的 workspaceId 必须与它一致，否则会被 WORKSPACE_MISMATCH 拒绝。 */
export function identity(): { id: string; root: Uri } {
  const root = workspaceRoot();
  return { id: identityForRoot(root, 'sample').id, root };
}

export async function createService(): Promise<MapService> {
  const root = workspaceRoot();
  const storageRoot = Uri.file(await mkdtemp(join(tmpdir(), 'god-view-storage-')));
  return new MapService({
    identity: identityForRoot(root, 'sample'),
    storageRoot,
    logger: silentLogger(),
    // eslint-disable-next-line no-restricted-syntax -- 集成测试装配点，等价于扩展的组合根
    now: () => new Date().toISOString(),
    extraExcludes: [],
  });
}

/** 把事件写进收件箱，模拟 Agent 通过 Gateway 投递。 */
export async function deliver(events: readonly GodViewEvent[]): Promise<void> {
  const inbox = Uri.joinPath(workspaceRoot(), '.godview', 'inbox');
  await workspace.fs.createDirectory(inbox);
  let sequence = 0;
  for (const event of events) {
    sequence += 1;
    const name = `${String(sequence).padStart(6, '0')}-${event.eventId}.json`;
    await workspace.fs.writeFile(
      Uri.joinPath(inbox, name),
      Buffer.from(JSON.stringify(event), 'utf8'),
    );
  }
}

export interface UpdateWaiter {
  /** 等待下一条满足条件的更新。超时即失败，避免测试静默通过。 */
  next(predicate: (update: MapUpdate) => boolean, reason: string): Promise<MapUpdate>;
  dispose(): void;
}

/**
 * 订阅式等待器。
 *
 * 必须在触发动作**之前**创建：文件监听是异步的，先动手再订阅会漏掉更新，
 * 让测试变成偶尔通过。
 */
export function watchUpdates(service: MapService, timeoutMs = 15000): UpdateWaiter {
  const received: MapUpdate[] = [];
  const pending: { predicate: (u: MapUpdate) => boolean; resolve: (u: MapUpdate) => void }[] = [];
  const subscription = service.onDidUpdate((update) => {
    const index = pending.findIndex((entry) => entry.predicate(update));
    if (index >= 0) {
      pending.splice(index, 1)[0]?.resolve(update);
      return;
    }
    received.push(update);
  });

  return {
    async next(predicate, reason) {
      const buffered = received.findIndex(predicate);
      const [replayed] = buffered >= 0 ? received.splice(buffered, 1) : [];
      if (replayed !== undefined) {
        return replayed;
      }
      return new Promise<MapUpdate>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`等待更新超时：${reason}`));
        }, timeoutMs);
        pending.push({
          predicate,
          resolve: (update) => {
            clearTimeout(timer);
            resolve(update);
          },
        });
      });
    },
    dispose() {
      subscription.dispose();
    },
  };
}

export function writeFile(relative: string, contents: string): Thenable<void> {
  return workspace.fs.writeFile(
    Uri.joinPath(workspaceRoot(), relative),
    Buffer.from(contents, 'utf8'),
  );
}

export function deletePath(relative: string, recursive = false): Thenable<void> {
  return workspace.fs.delete(Uri.joinPath(workspaceRoot(), relative), { recursive });
}

export function renamePath(from: string, to: string): Thenable<void> {
  return workspace.fs.rename(
    Uri.joinPath(workspaceRoot(), from),
    Uri.joinPath(workspaceRoot(), to),
    { overwrite: true },
  );
}

/**
 * 等到系统安静下来。
 *
 * 用例之间必须隔离：上一个用例末尾的文件恢复会触发自己的防抖刷新，那条更新会漂到
 * 下一个用例里，把「这次变化引起的更新」和「上次的尾巴」混在一起。
 */
export async function settle(
  service: MapService,
  quietMs = 1500,
  maxWaitMs = 15000,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let lastSeen = Date.now();
  const subscription = service.onDidUpdate(() => {
    lastSeen = Date.now();
  });
  try {
    while (Date.now() - lastSeen < quietMs) {
      if (Date.now() > deadline) {
        throw new Error('等待系统安静超时：仍在持续产生更新');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    subscription.dispose();
  }
}
