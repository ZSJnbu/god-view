import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { AppStore } from './app-store.js';
import { createMessenger } from './messaging.js';
import type { VsCodeHost } from './messaging.js';
import { LayoutClient, type WorkerLike } from './layout/layout-client.js';
import { CytoscapeAdapter } from './graph/cytoscape-adapter.js';
import { App } from './ui/App.js';

interface StatefulVsCodeHost extends VsCodeHost {
  setState<T>(state: T): T;
}

declare function acquireVsCodeApi(): StatefulVsCodeHost;

/**
 * Webview 组合根。
 *
 * 唯一装配依赖的地方：其余模块都通过参数拿到协作者，因此可以脱离浏览器单测
 * （CODING_STANDARDS.md §3.2）。
 */
function bootstrap(): void {
  const root = document.getElementById('root');
  if (root === null) {
    return;
  }

  const store = new AppStore();
  const host = acquireVsCodeApi();
  const messenger = createMessenger({
    host,
    addEventListener: (type, listener) => {
      window.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      window.removeEventListener(type, listener);
    },
  });

  messenger.subscribe((event) => {
    store.receive(event);
    if (event.type === 'map/snapshot') {
      // VS Code 把这份状态交给 WebviewPanelSerializer。只保存恢复绑定所需的工作区 ID，
      // 不复制地图或源码内容。
      host.setState({ workspaceId: event.document.workspaceId });
    }
  });

  const layoutClient = new LayoutClient(() => spawnLayoutWorker(root.dataset['workerSrc']));

  createRoot(root).render(
    <StrictMode>
      <App
        store={store}
        messenger={messenger}
        layoutClient={layoutClient}
        createAdapter={(container, callbacks) => new CytoscapeAdapter(container, callbacks)}
      />
    </StrictMode>,
  );

  // 首帧由扩展推送：Webview 不自己读文件，只声明「我准备好了」。
  messenger.send({ type: 'ready' });
}

/**
 * 创建布局 Worker。
 *
 * 地址由扩展通过 data 属性注入，因为只有扩展知道 webview 资源的最终 URI。
 * 缺失或被 CSP 拦截时抛错，由 {@link LayoutClient} 同步降级。
 */
function spawnLayoutWorker(src: string | undefined): WorkerLike {
  if (src === undefined || src === '') {
    throw new Error('未提供布局 Worker 地址');
  }
  return new Worker(src, { type: 'module' });
}

bootstrap();
