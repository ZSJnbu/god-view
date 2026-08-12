import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * God View ESLint 配置。
 *
 * 规则直接对应 docs/CODING_STANDARDS.md 与 docs/CODE_QUALITY_STANDARD.md：
 * warning 一律配置为 error，因为质量门禁要求 ESLint warning 为 0。
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
      'packages/protocol/src/generated/**',
      'fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // 构建脚本与配置文件不属于任何 tsconfig 工程，按默认工程解析即可。
          allowDefaultProject: [
            'eslint.config.mjs',
            'vitest.config.ts',
            '.dependency-cruiser.cjs',
            'apps/*/esbuild.mjs',
            'apps/*/esbuild.integration.mjs',
            'apps/*/.vscode-test.mjs',
            'apps/webview/e2e/*.js',
            'apps/webview/e2e/*.mjs',
            'playwright.config.ts',
            'packages/protocol/scripts/generate-types.mts',
            'scripts/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // §4.1 禁止逃逸类型系统
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        // 协议保留但未实现的事件类型必须落到 default 并返回 UNSUPPORTED_EVENT_TYPE，
        // 因此允许用 default 覆盖剩余联合成员；缺少 default 时仍要求穷尽。
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // §16 日志：生产代码禁止 console
      'no-console': 'error',

      // §6.1 复杂度与嵌套（>15 属于门禁失败）
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],

      // §8 异步与生命周期：禁止悬空 Promise
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      // §7 错误处理
      '@typescript-eslint/only-throw-error': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '时间必须通过注入的 Clock 端口获取，见 CODING_STANDARDS.md §3.2。',
        },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // 测试代码放宽复杂度与长度，但类型安全规则保持
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.test-utils.ts',
      '**/test/**/*.ts',
      'apps/webview/e2e/**/*.ts',
      'packages/testkit/**/*.ts',
    ],
    rules: {
      'max-lines': 'off',
      complexity: 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    // 构建脚本与配置文件运行在 Node 上，且不属于任何 tsconfig 工程：
    // 关闭需要类型信息的规则，并显式声明用到的 Node 全局。
    files: [
      'eslint.config.mjs',
      'vitest.config.ts',
      '.dependency-cruiser.cjs',
      'apps/*/esbuild.mjs',
      'apps/*/esbuild.integration.mjs',
      'apps/*/.vscode-test.mjs',
      'apps/webview/e2e/*.{js,mjs}',
      'playwright.config.ts',
      'packages/protocol/scripts/**/*.{ts,mts,js,mjs}',
      'scripts/*.{js,mjs}',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: 'readonly',
        MessageEvent: 'readonly',
        module: 'writable',
        process: 'readonly',
        queueMicrotask: 'readonly',
        require: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
