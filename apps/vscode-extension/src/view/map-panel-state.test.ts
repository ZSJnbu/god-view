import { describe, expect, it } from 'vitest';
import { parseMapPanelState } from './map-panel-state.js';

describe('parseMapPanelState', () => {
  it('读取有效 workspaceId 并忽略多余字段', () => {
    expect(parseMapPanelState({ workspaceId: 'ws-1', stale: true })).toEqual({
      workspaceId: 'ws-1',
    });
  });

  it.each([undefined, null, [], {}, { workspaceId: '' }, { workspaceId: 1 }])(
    '拒绝无效或旧版状态 %#',
    (input) => {
      expect(parseMapPanelState(input)).toBeUndefined();
    },
  );
});
