import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Webview 打包脚本。
 *
 * 产物直接写进扩展的 `dist/webview`：Webview 只允许从扩展目录加载资源，
 * `localResourceRoots` 也只授权了这一个目录（TECHNICAL_ARCHITECTURE.md §9.3）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, '..', 'vscode-extension', 'dist', 'webview');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  format: 'esm',
  target: ['chrome128'],
  platform: 'browser',
  sourcemap: watch ? 'inline' : 'linked',
  minify: !watch,
  logLevel: 'info',
  // Webview 里没有 process：把常量在构建期折掉，避免 React 运行时读取未定义全局。
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    ...shared,
    entryPoints: [join(here, 'src', 'main.tsx')],
    outdir,
    entryNames: 'index',
    assetNames: 'assets/[name]',
    loader: { '.css': 'css' },
  },
  {
    ...shared,
    entryPoints: [join(here, 'src', 'layout', 'layout.worker.ts')],
    outdir,
    entryNames: 'layout-worker',
  },
];

if (watch) {
  const contexts = await Promise.all(targets.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('webview: watching');
} else {
  await rm(outdir, { recursive: true, force: true });
  await Promise.all(targets.map((options) => esbuild.build(options)));
}
