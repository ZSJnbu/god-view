/**
 * 依赖边界门禁。
 *
 * 规则来源：docs/TECHNICAL_ARCHITECTURE.md §4.1「依赖方向」。
 * 箭头表示「左侧允许依赖右侧」，未列出的反向依赖一律禁止。
 */

/** 生成「只允许依赖白名单内 God View 包」的规则。 */
function allowOnly(name, from, allowed) {
  // testkit 是仅供测试使用的包，只依赖 protocol，允许任何包在测试中引用。
  const withTestkit = [...allowed, 'testkit'];
  const allowedPattern = `^(?:apps|packages)/(?:${withTestkit.join('|')})/`;
  return {
    name,
    severity: 'error',
    comment: `${from} 只允许依赖：${withTestkit.join(', ')}`,
    from: { path: `^${from}/` },
    to: {
      path: '^(?:apps|packages)/',
      pathNot: [allowedPattern, `^${from}/`],
    },
  };
}

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '禁止循环依赖（CODE_QUALITY_STANDARD.md §3.7）。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-deep-package-import',
      severity: 'error',
      comment: '跨包必须通过公开入口，禁止深层导入其他包的 src/ 内部文件。',
      from: { path: '^(?:apps|packages)/([^/]+)/' },
      to: {
        path: '^(?:apps|packages)/([^/]+)/src/.+',
        pathNot: '^(?:apps|packages)/$1/',
      },
    },
    allowOnly('packages/protocol', 'packages/protocol', []),
    allowOnly('packages/graph-core', 'packages/graph-core', ['protocol']),
    allowOnly('packages/validation-core', 'packages/validation-core', ['protocol']),
    allowOnly('packages/storage', 'packages/storage', ['protocol', 'graph-core']),
    allowOnly('packages/webview-bridge', 'packages/webview-bridge', ['protocol']),
    // Gateway 复用 storage 的原子写工具，避免两处各自实现 fsync + rename。
    allowOnly('apps/agent-gateway', 'apps/agent-gateway', ['protocol', 'storage']),
    allowOnly('apps/webview', 'apps/webview', ['webview-bridge', 'protocol']),
    allowOnly('apps/vscode-extension', 'apps/vscode-extension', [
      'protocol',
      'graph-core',
      'validation-core',
      'storage',
      'webview-bridge',
    ]),
    {
      name: 'domain-packages-no-vscode',
      severity: 'error',
      comment: '领域包不得依赖 vscode、DOM 或具体渲染库（CODING_STANDARDS.md §3.2）。',
      from: {
        path: '^packages/(?:protocol|graph-core|validation-core|annotation-core|webview-bridge)/',
      },
      to: { path: 'node_modules/(?:vscode|cytoscape|react|elkjs)' },
    },
    {
      name: 'graph-core-no-io',
      severity: 'error',
      comment: 'graph-core 必须是纯函数包，不得触碰文件系统、子进程或网络。',
      from: { path: '^packages/graph-core/src/(?!.*\\.test\\.ts$)' },
      to: { path: '^(?:node:)?(?:fs|child_process|net|http|https|os)(?:/|$)' },
    },
    {
      name: 'webview-no-vscode-api',
      severity: 'error',
      comment: 'Webview 不得导入 vscode 模块或直接访问工作区文件。',
      // 只约束运行在 Webview 里的源码；打包脚本运行在 Node 上，读写磁盘是它的本职。
      from: { path: '^apps/webview/src/' },
      to: { path: '^(?:node:)?(?:fs|child_process)(?:/|$)|node_modules/vscode' },
    },
    {
      name: 'no-orphan-source',
      severity: 'warn',
      comment: '孤立模块通常是遗留文件。',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)(?:eslint|vitest|vite)\\.config\\.[^/]+$',
          '^apps/webview/e2e/(?:map\\.spec\\.ts|harness\\.js)$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(?:dist|out|coverage|node_modules|fixtures)(/|$)' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
