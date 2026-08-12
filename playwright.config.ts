import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/webview/e2e',
  outputDir: './test-results/playwright',
  reporter: process.env['CI'] === undefined ? 'list' : [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:41739',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions:
      process.env['GOD_VIEW_BROWSER_PATH'] === undefined
        ? undefined
        : { executablePath: process.env['GOD_VIEW_BROWSER_PATH'] },
  },
  webServer: {
    command: 'node apps/webview/e2e/server.mjs',
    port: 41739,
    // 不复用端口上的任意现有服务；否则可能对另一个本地应用执行整套验收并给出误判。
    reuseExistingServer: false,
  },
});
