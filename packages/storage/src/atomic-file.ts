import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 原子写入：先写临时文件并 fsync，再 rename 覆盖目标。
 *
 * 直接覆盖关键快照会在进程崩溃时留下半写文件，而 rename 在同一文件系统上是原子的
 * （CODING_STANDARDS.md §11）。
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // 固定的 `${filePath}.tmp` 在两个调用并发写同一目标时并不安全：先完成的 rename
  // 会拿走共享临时文件，后完成者随后得到 ENOENT。窗口重载时扩展激活和 Webview
  // 反序列化曾真实触发这条竞态。每次写入使用独立临时文件，最终仍由 rename 原子竞争；
  // 最后完成的完整写入获胜，不会出现半写内容或丢失临时文件。
  const temporaryPath = `${filePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    // 写入或 rename 失败时不把孤儿临时文件留在用户工作区。
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/** 追加并 fsync：事件被确认写入后才对 Agent 返回 accepted。 */
export async function appendLineDurable(filePath: string, line: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'a');
  try {
    await handle.writeFile(`${line}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** 追加但不强制刷盘，用于隔离区等非关键路径。 */
export async function appendLine(filePath: string, line: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${line}\n`, 'utf8');
}

export async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
