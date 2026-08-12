import type { Timestamp } from '@god-view/protocol';

/**
 * 确定性时钟与 ID 生成器。
 *
 * 测试不得依赖真实时钟或随机数：事件回放要求相同输入产生相同输出
 * （CODING_STANDARDS.md §17）。
 */
export interface DeterministicClock {
  now(): Timestamp;
  /** 推进指定秒数，用于测试超时、过期与保留期逻辑。 */
  advance(seconds: number): void;
}

export function createDeterministicClock(start = '2026-08-07T10:00:00.000Z'): DeterministicClock {
  let current = Date.parse(start);
  return {
    now: () => new Date(current).toISOString(),
    advance: (seconds: number) => {
      current += seconds * 1000;
    },
  };
}

/** 顺序 ID 生成器，替代 UUID，使断言可预测。 */
export function createSequentialIds(prefix: string): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter)}`;
  };
}
