import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';
import * as esbuild from 'esbuild';

/**
 * Extension Host 集成测试打包脚本。
 *
 * 测试源码用 ESM 写，但 VS Code 的 Mocha 运行器按 CJS 加载 `.js`；工作区依赖包
 * 又都是 ESM-only。因此这里和扩展本体一样，把每个用例文件打包成自包含的 CJS，
 * 避开 CJS/ESM 互操作问题。
 */

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, 'out', 'integration');

const entryPoints = [];
for await (const entry of glob('integration/**/*.test.ts', { cwd: here })) {
  entryPoints.push(join(here, entry));
}

await rm(outdir, { recursive: true, force: true });
await esbuild.build({
  entryPoints,
  outdir,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node20'],
  // vscode 由宿主注入；mocha 的 describe/it 是运行器注入的全局量。
  external: ['vscode', 'mocha'],
  sourcemap: 'inline',
  logLevel: 'info',
});
