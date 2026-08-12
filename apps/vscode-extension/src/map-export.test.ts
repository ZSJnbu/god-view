import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, toSnapshotDocument } from '@god-view/graph-core';
import { createProtocolValidator } from '@god-view/protocol';
import { mapExportFileName, serializeMapExport } from './map-export.js';

describe('地图快照导出', () => {
  it('输出可由协议校验器重新读取的格式化 JSON', () => {
    const document = toSnapshotDocument(
      createEmptySnapshot({
        workspaceId: 'ws',
        branchKey: 'main',
        createdAt: '2026-08-12T00:00:00.000Z',
      }),
    );
    const text = serializeMapExport(document);
    expect(text.endsWith('\n')).toBe(true);
    expect(createProtocolValidator().validateSnapshot(JSON.parse(text)).ok).toBe(true);
    expect(text).not.toContain('sourceContents');
  });

  it('分支名不能形成导出路径穿越', () => {
    expect(mapExportFileName('feature/../../escape')).toBe('god-view-map-feature-escape.json');
    expect(mapExportFileName('功能/支付')).not.toContain('/');
  });
});
