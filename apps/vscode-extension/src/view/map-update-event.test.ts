import { describe, expect, it } from 'vitest';
import type { MapUpdate } from '../engine/map-service.js';
import { routeMapUpdate } from './map-update-event.js';

const emptyPatch = {
  upsertedNodes: [],
  upsertedEdges: [],
  removedNodeIds: [],
  removedEdgeIds: [],
};

function update(kind: MapUpdate['kind']): MapUpdate {
  return {
    kind,
    revision: 3,
    factsRevision: 7,
    patch: emptyPatch,
    drift: [{ kind: 'missing_file', targetId: 'module.payment', detail: '文件不存在' }],
  };
}

describe('routeMapUpdate', () => {
  it('纯事实更新必须走 map/facts，不携带图版本与空补丁', () => {
    expect(routeMapUpdate(update('facts'))).toEqual({
      kind: 'event',
      event: {
        type: 'map/facts',
        factsRevision: 7,
        drift: [{ kind: 'missing_file', targetId: 'module.payment', detail: '文件不存在' }],
      },
    });
  });

  it('图变化走 map/patch，并同时携带两条时间线的版本', () => {
    expect(routeMapUpdate(update('patch'))).toEqual({
      kind: 'event',
      event: {
        type: 'map/patch',
        revision: 3,
        factsRevision: 7,
        patch: emptyPatch,
        drift: [{ kind: 'missing_file', targetId: 'module.payment', detail: '文件不存在' }],
      },
    });
  });

  it('分支切换要求完整快照', () => {
    expect(routeMapUpdate(update('reload'))).toEqual({ kind: 'snapshot' });
  });
});
