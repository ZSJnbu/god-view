/**
 * 判断文件系统路径是否位于指定根目录内。
 *
 * 调用方传入平台语义，便于在非 Windows CI 上锁住盘符大小写回归。
 */
export function isFsPathWithinRoot(
  rootFsPath: string,
  targetFsPath: string,
  caseInsensitive = process.platform === 'win32',
): boolean {
  const normalizedRoot = rootFsPath.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const normalizedTarget = targetFsPath.replace(/\\/gu, '/');
  if (normalizedRoot === '' || normalizedTarget === '') return false;
  const prefix = `${normalizedRoot}/`;
  return caseInsensitive
    ? normalizedTarget.toLowerCase().startsWith(prefix.toLowerCase())
    : normalizedTarget.startsWith(prefix);
}
