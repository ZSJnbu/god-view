import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, type GraphSnapshot } from '@god-view/graph-core';
import type { GodViewEvent } from '@god-view/protocol';
import { interruptActiveChange } from './change-interruption.js';

const now = '2026-08-12T06:00:00.000Z';

function snapshot(): GraphSnapshot {
  const empty = createEmptySnapshot({ workspaceId: 'ws', branchKey: 'main', createdAt: now });
  return {
    ...empty,
    activeChanges: new Map([
      [
        'change.one',
        {
          changeSetId: 'change.one',
          sessionId: 'agent',
          intent: '修改',
          startedAt: now,
          touchedNodeIds: [],
          touchedEdgeIds: [],
        },
      ],
    ]),
  };
}

describe('ChangeSet 中断编排', () => {
  it('用户中断先观察再应用，并保留用户权威身份', async () => {
    const calls: string[] = [];
    const events: GodViewEvent[] = [];
    const repository = {
      snapshot: snapshot(),
      append: () => Promise.resolve(),
      flush: () => Promise.resolve(),
    };
    const id = await interruptActiveChange(
      {
        repository: () => repository,
        observe: () => {
          calls.push('observe');
          return Promise.resolve();
        },
        apply: (event) => {
          calls.push('apply');
          events.push(event);
          return Promise.resolve();
        },
        nextEventId: () => 'interrupt.user',
        now: () => now,
        actor: 'user',
      },
      '用户停止',
    );
    expect(id).toBe('change.one');
    expect(calls).toEqual(['observe', 'apply']);
    expect(events[0]).toMatchObject({
      actor: { kind: 'user' },
      type: 'change_complete',
      payload: { changeSetId: 'change.one', status: 'interrupted' },
    });
  });

  it('分支守卫中断直接落旧仓库并刷盘', async () => {
    const events: GodViewEvent[] = [];
    let flushed = false;
    let current = snapshot();
    const repository = {
      get snapshot() {
        return current;
      },
      append: (event: GodViewEvent) => {
        events.push(event);
        current = { ...current, activeChanges: new Map() };
        return Promise.resolve();
      },
      flush: () => {
        flushed = true;
        return Promise.resolve();
      },
    };
    await interruptActiveChange(
      {
        repository: () => repository,
        nextEventId: () => 'interrupt.branch',
        now: () => now,
        actor: 'system',
      },
      '分支已切换',
    );
    expect(events[0]?.branchKey).toBe('main');
    expect(events[0]?.actor?.kind).toBe('system');
    expect(flushed).toBe(true);
  });

  it('领域拒绝中断时不刷盘并报告失败', async () => {
    let flushed = false;
    const repository = {
      snapshot: snapshot(),
      append: () => Promise.resolve(),
      flush: () => {
        flushed = true;
        return Promise.resolve();
      },
    };
    await expect(
      interruptActiveChange(
        {
          repository: () => repository,
          nextEventId: () => 'rejected',
          now: () => now,
        },
        '拒绝',
      ),
    ).resolves.toBeUndefined();
    expect(flushed).toBe(false);
  });

  it('没有活动 ChangeSet 时不产生事件', async () => {
    const empty = createEmptySnapshot({ workspaceId: 'ws', branchKey: 'main', createdAt: now });
    await expect(
      interruptActiveChange(
        {
          repository: () => ({
            snapshot: empty,
            append: () => Promise.resolve(),
            flush: () => Promise.resolve(),
          }),
          nextEventId: () => 'unused',
          now: () => now,
        },
        '无任务',
      ),
    ).resolves.toBeUndefined();
  });
});
