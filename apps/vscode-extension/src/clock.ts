/**
 * 真实时钟。
 *
 * CODING_STANDARDS.md §3.2 要求时间通过注入的 Clock 端口获取。组合根是唯一
 * 允许构造真实时钟的位置，其余模块一律接收 `() => string` 参数，
 * 因此可以在测试中替换为确定性时钟。
 */
export type Clock = () => string;

// eslint-disable-next-line no-restricted-syntax -- 组合根：这里是系统时间进入应用的唯一入口
export const systemClock: Clock = () => new Date().toISOString();
