import type { ExtensionEvent } from '@god-view/webview-bridge';
import type { MapUpdate } from '../engine/map-service.js';

type IncrementalMapEvent = Extract<ExtensionEvent, { type: 'map/facts' | 'map/patch' }>;

/**
 * MapService 更新在面板侧的投递方式。
 *
 * 这层必须独立可测：文件事实更新如果误走 `map/patch`，会再次被图 revision 判成
 * 过期消息；分支切换如果误走补丁，则无法清掉旧分支节点。MapPanel 只负责执行这里
 * 给出的决定，不再在 VS Code 生命周期代码里复制协议分支。
 */
export type MapUpdateDelivery =
  { readonly kind: 'snapshot' } | { readonly kind: 'event'; readonly event: IncrementalMapEvent };

export function routeMapUpdate(update: MapUpdate): MapUpdateDelivery {
  switch (update.kind) {
    case 'reload':
      return { kind: 'snapshot' };
    case 'facts':
      return {
        kind: 'event',
        event: {
          type: 'map/facts',
          factsRevision: update.factsRevision,
          drift: update.drift,
          ...(update.coverage === undefined ? {} : { coverage: update.coverage }),
        },
      };
    case 'patch':
      return {
        kind: 'event',
        event: {
          type: 'map/patch',
          revision: update.revision,
          factsRevision: update.factsRevision,
          patch: update.patch,
          drift: update.drift,
          ...(update.coverage === undefined ? {} : { coverage: update.coverage }),
        },
      };
  }
}
