import type { GraphSnapshot } from '@god-view/graph-core';
import type { GodViewEvent, Identifier } from '@god-view/protocol';
import { interruptChangeEvent } from './user-events.js';

export interface ChangeInterruptionOptions {
  readonly repository: () =>
    | {
        readonly snapshot: GraphSnapshot;
        append(event: GodViewEvent): Promise<unknown>;
        flush(): Promise<void>;
      }
    | undefined;
  readonly observe?: (snapshot: GraphSnapshot) => Promise<void>;
  readonly apply?: (event: GodViewEvent) => Promise<void>;
  readonly nextEventId: () => Identifier;
  readonly now: () => string;
  readonly actor?: 'user' | 'system';
}

/** 结束唯一活动 ChangeSet；调用方决定是否先观察当前 Git 以及如何发布 UI 补丁。 */
export async function interruptActiveChange(
  options: ChangeInterruptionOptions,
  reason: string,
): Promise<Identifier | undefined> {
  let repository = options.repository();
  const [change] = [...(repository?.snapshot.activeChanges.values() ?? [])];
  if (repository === undefined || change === undefined) return undefined;
  await options.observe?.(repository.snapshot);
  repository = options.repository();
  const active = repository?.snapshot.activeChanges.get(change.changeSetId);
  if (repository === undefined || active === undefined) return undefined;
  const event = interruptChangeEvent(
    {
      snapshot: repository.snapshot,
      eventId: options.nextEventId(),
      timestamp: options.now(),
    },
    active.changeSetId,
    reason,
    options.actor,
  );
  if (options.apply !== undefined) await options.apply(event);
  else {
    await repository.append(event);
    if (repository.snapshot.activeChanges.has(active.changeSetId)) return undefined;
    await repository.flush();
  }
  return active.changeSetId;
}
