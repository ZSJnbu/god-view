import { defineConfig } from 'vitest/config';

/**
 * 覆盖率阈值来自 docs/CODE_QUALITY_STANDARD.md §5.1。
 * 未列出的区域（渲染样式、VS Code 平台集成）由集成测试与人工验证覆盖，
 * 不通过行覆盖率判断。
 */
export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['{packages,apps}/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test-utils.ts',
        '**/index.ts',
        'packages/protocol/src/generated/**',
        'packages/testkit/**',
        'apps/vscode-extension/**',
        'apps/agent-gateway/src/bin/**',
        // Cytoscape 适配与 Worker 入口只做渲染映射与消息搬运，
        // 真正的逻辑在 model/ 与 layout/ 的纯函数里，由单测覆盖。
        'apps/webview/src/graph/**',
        'apps/webview/src/layout/layout.worker.ts',
      ],
      thresholds: {
        'packages/protocol/src/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'packages/graph-core/src/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'packages/storage/src/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
        'packages/validation-core/src/**': {
          lines: 90,
          branches: 85,
          functions: 90,
          statements: 90,
        },
        'packages/webview-bridge/src/**': {
          lines: 90,
          branches: 85,
          functions: 90,
          statements: 90,
        },
        'apps/webview/src/**': { lines: 85, branches: 80, functions: 85, statements: 85 },
        'apps/agent-gateway/src/**': { lines: 80, branches: 75, functions: 80, statements: 80 },
      },
    },
  },
});
