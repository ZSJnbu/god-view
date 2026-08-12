import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * 扩展打包脚本。
 *
 * 产出单个 CJS 文件交给 Extension Host：`vscode` 由宿主注入，必须标为 external。
 * Webview 资源由 apps/webview 单独打包进同一个 dist 目录，因此这里不清空 dist。
 */

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: [join(here, 'src', 'extension.ts')],
  outfile: join(here, 'dist', 'extension.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node22'],
  external: ['vscode'],
  sourcemap: watch ? 'inline' : 'linked',
  minify: !watch,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const gatewayOptions = {
  entryPoints: [join(here, '..', 'agent-gateway', 'src', 'bin', 'god-view.ts')],
  outfile: join(here, 'dist', 'gateway', 'god-view.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: watch ? 'inline' : 'linked',
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const extensionContext = await esbuild.context(extensionOptions);
  const gatewayContext = await esbuild.context(gatewayOptions);
  await Promise.all([extensionContext.watch(), gatewayContext.watch()]);
  console.log('extension: watching');
} else {
  await Promise.all([
    rm(extensionOptions.outfile, { force: true }),
    rm(gatewayOptions.outfile, { force: true }),
  ]);
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(gatewayOptions)]);
}
