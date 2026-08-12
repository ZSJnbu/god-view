import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

/**
 * Extension Host 集成测试配置。
 *
 * 这些测试跑在真实的 VS Code 里，覆盖单元测试触碰不到的部分：FileSystemWatcher
 * 的实际触发、防抖时序、workspace.fs 行为。这条链路上已经连续出现过三次
 * 「单元测试全绿、真实链路不通」，因此它必须有自动化回归。
 */

const here = dirname(fileURLToPath(import.meta.url));

// 测试会删改工作区文件，因此复制一份夹具到临时目录，不污染仓库。
const workspace = await mkdtemp(join(tmpdir(), 'god-view-itest-'));
await rm(join(workspace, 'sample'), { recursive: true, force: true });
await cp(join(here, '..', '..', 'fixtures', 'sample-project'), join(workspace, 'sample'), {
  recursive: true,
});

/**
 * VS Code 来源。
 *
 * 默认下载 stable（CI 用这条路径）。在 TLS 被代理拦截、Node 无法下载的机器上，
 * 设 `GOD_VIEW_VSCODE_PATH` 指向本地已安装的可执行文件即可复用它，例如 macOS：
 *   GOD_VIEW_VSCODE_PATH="/Applications/Visual Studio Code.app/Contents/MacOS/Electron"
 */
const localVsCode = process.env.GOD_VIEW_VSCODE_PATH;
const requestedVersion = process.env.GOD_VIEW_VSCODE_VERSION ?? 'stable';

export default defineConfig({
  label: 'integration',
  files: 'out/integration/**/*.test.js',
  workspaceFolder: join(workspace, 'sample'),
  ...(localVsCode === undefined
    ? { version: requestedVersion }
    : { useInstallation: { fromPath: localVsCode } }),
  mocha: {
    ui: 'bdd',
    color: true,
    // 文件监听 + 750ms 防抖 + 校验，单条用例给足时间。
    timeout: 20000,
  },
  launchArgs: ['--disable-extensions'],
});
