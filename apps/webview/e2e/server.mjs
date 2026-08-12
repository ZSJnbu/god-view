import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webviewDist = join(here, '..', '..', 'vscode-extension', 'dist', 'webview');
// 使用专用高位端口，避免与开发服务器常用的 Vite 4173 端口相撞。
const port = 41739;
const routes = new Map([
  ['/', { path: join(here, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/harness.js', { path: join(here, 'harness.js'), type: 'text/javascript; charset=utf-8' }],
  ['/index.js', { path: join(webviewDist, 'index.js'), type: 'text/javascript; charset=utf-8' }],
  ['/index.css', { path: join(webviewDist, 'index.css'), type: 'text/css; charset=utf-8' }],
  [
    '/layout-worker.js',
    { path: join(webviewDist, 'layout-worker.js'), type: 'text/javascript; charset=utf-8' },
  ],
]);

createServer((request, response) => {
  const route = routes.get(
    new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`).pathname,
  );
  if (route === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': route.type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'",
  });
  createReadStream(route.path).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`God View Webview E2E server listening on http://127.0.0.1:${String(port)}`);
});
