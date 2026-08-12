import type { GodViewEvent } from '@god-view/protocol';
import type { DomainError } from './domain-error.js';
import { reduce } from './reduce.js';
import type { GraphSnapshot } from './snapshot.js';

export interface RejectedEvent {
  readonly event: GodViewEvent;
  readonly error: DomainError;
}

export interface ReplayResult {
  readonly snapshot: GraphSnapshot;
  /**
   * 被拒绝的事件。
   *
   * 单个事件失败不会中断回放：地图必须在部分事件损坏时仍然可用
   * （PRD §11.2、TECHNICAL_ARCHITECTURE.md §8.3）。
   */
  readonly rejected: readonly RejectedEvent[];
}

export function replay(initial: GraphSnapshot, events: readonly GodViewEvent[]): ReplayResult {
  let snapshot = initial;
  const rejected: RejectedEvent[] = [];
  for (const event of events) {
    const result = reduce(snapshot, event);
    if (result.ok) {
      snapshot = result.value;
    } else {
      rejected.push({ event, error: result.error });
    }
  }
  return { snapshot, rejected };
}
