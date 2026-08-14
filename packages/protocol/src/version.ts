import type { ProtocolVersion } from './generated/protocol-types.js';

/** 当前实现的协议版本。 */
export const currentProtocolVersion = '1.4' as ProtocolVersion;

/**
 * 兼容策略（TECHNICAL_ARCHITECTURE.md §6.2）：
 * - 新增可选字段属于 minor 兼容变更；
 * - 至少支持当前 major 的最近两个 minor；
 * - 读取方忽略未知可选字段，写入方只发送协商版本支持的字段。
 */
export const supportedMinorRange = 5;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
}

export function parseProtocolVersion(value: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)$/u.exec(value);
  if (match === null) {
    return undefined;
  }
  const [, rawMajor, rawMinor] = match;
  /* v8 ignore next 3 -- 正则已保证两个捕获组存在；此守卫仅满足 noUncheckedIndexedAccess。 */
  if (rawMajor === undefined || rawMinor === undefined) {
    return undefined;
  }
  return { major: Number.parseInt(rawMajor, 10), minor: Number.parseInt(rawMinor, 10) };
}

/**
 * 判断对端版本是否可被当前实现接受。
 *
 * 更高的 minor 允许通过：读取方忽略未知可选字段即可，这是 minor 兼容的定义。
 * major 不同一律拒绝，避免用宽松猜测掩盖语义变化。
 */
export function isProtocolVersionSupported(
  value: string,
  current: string = currentProtocolVersion,
): boolean {
  const incoming = parseProtocolVersion(value);
  const supported = parseProtocolVersion(current);
  if (incoming === undefined || supported === undefined) {
    return false;
  }
  if (incoming.major !== supported.major) {
    return false;
  }
  // 更高的 minor 也接受：读取方忽略未知可选字段正是 minor 兼容的定义。
  return incoming.minor >= supported.minor - supportedMinorRange + 1;
}

/** 协商出双方都能处理的版本：取较低的 minor。 */
export function negotiateProtocolVersion(
  peerVersions: readonly string[],
  current: string = currentProtocolVersion,
): string | undefined {
  const supported = parseProtocolVersion(current);
  if (supported === undefined) {
    return undefined;
  }
  const candidates = peerVersions
    .map(parseProtocolVersion)
    .filter((version): version is ParsedVersion => version !== undefined)
    .filter((version) => version.major === supported.major)
    .map((version) => Math.min(version.minor, supported.minor))
    .filter((minor) => minor >= supported.minor - supportedMinorRange + 1);

  if (candidates.length === 0) {
    return undefined;
  }
  return `${String(supported.major)}.${String(Math.max(...candidates))}`;
}
