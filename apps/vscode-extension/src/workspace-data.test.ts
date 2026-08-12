import { describe, expect, it } from 'vitest';
import {
  agentDataBoundaryKey,
  isWorkspaceLayoutKey,
  layoutStateKey,
  workspaceStorageSegment,
} from './workspace-data.js';

describe('工作区本地数据定位', () => {
  it('布局同时包含 workspace 与 branch，避免多根同名分支串数据', () => {
    expect(layoutStateKey('ws-a', 'main')).toBe('godView.layout:ws-a:main');
    expect(layoutStateKey('ws-a', 'main')).not.toBe(layoutStateKey('ws-b', 'main'));
  });

  it('清理只匹配目标工作区的布局', () => {
    expect(isWorkspaceLayoutKey('godView.layout:ws-a:feature/x', 'ws-a')).toBe(true);
    expect(isWorkspaceLayoutKey('godView.layout:ws-ab:main', 'ws-a')).toBe(false);
    expect(isWorkspaceLayoutKey('other:ws-a:main', 'ws-a')).toBe(false);
  });

  it('存储目录不允许 workspaceId 形成路径穿越', () => {
    expect(workspaceStorageSegment('../workspace/a')).not.toMatch(/[/.]/u);
  });

  it('Agent 数据边界确认按工作区和声明版本隔离', () => {
    expect(agentDataBoundaryKey('ws-a')).toBe('godView.agentDataBoundaryAccepted:v1:ws-a');
    expect(agentDataBoundaryKey('ws-a')).not.toBe(agentDataBoundaryKey('ws-b'));
  });
});
