/**
 * 集中的排除规则。
 *
 * 所有组件必须使用同一份名单：各处维护不同名单会让「覆盖率可核对」失效
 * （CODING_STANDARDS.md §15）。
 */

interface ExclusionRule {
  readonly reason: string;
  readonly test: (path: string) => boolean;
}

function segmentMatcher(names: readonly string[], reason: string): ExclusionRule {
  const set = new Set(names);
  return {
    reason,
    test: (path) => path.split('/').some((segment) => set.has(segment)),
  };
}

function extensionMatcher(extensions: readonly string[], reason: string): ExclusionRule {
  return {
    reason,
    test: (path) => extensions.some((extension) => path.toLowerCase().endsWith(extension)),
  };
}

const rules: readonly ExclusionRule[] = [
  segmentMatcher(['.git'], 'Git 内部目录'),
  segmentMatcher(
    ['node_modules', 'vendor', 'bower_components', 'Pods', 'third_party'],
    '第三方依赖',
  ),
  segmentMatcher(['.venv', 'venv', 'env', 'virtualenv', 'site-packages'], '虚拟环境'),
  segmentMatcher(
    ['dist', 'build', 'out', 'target', '.next', '.nuxt', '.output', '.svelte-kit'],
    '构建产物',
  ),
  segmentMatcher(
    ['.cache', '.turbo', '.parcel-cache', '__pycache__', '.pytest_cache', '.gradle', '.mypy_cache'],
    '缓存',
  ),
  segmentMatcher(['coverage', '.nyc_output', 'htmlcov'], '覆盖率结果'),
  segmentMatcher(['.godview'], 'God View 运行时数据'),
  extensionMatcher(
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.otf'],
    '二进制资源',
  ),
  extensionMatcher(['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.jar', '.dmg'], '压缩包'),
  extensionMatcher(['.exe', '.dll', '.so', '.dylib', '.wasm', '.class', '.o', '.a'], '二进制产物'),
  extensionMatcher(['.min.js', '.min.css', '.map'], '生成产物'),
];

export interface ExclusionDecision {
  readonly excluded: boolean;
  readonly reason?: string;
}

/**
 * 判断某个工作区相对路径是否排除。
 *
 * 排除原因必须可查看：产品要求覆盖率可核对，不允许静默丢弃第一方内容。
 */
export function decideExclusion(
  path: string,
  extraGlobSegments: readonly string[] = [],
): ExclusionDecision {
  const normalized = path.replace(/\\/gu, '/');
  for (const rule of rules) {
    if (rule.test(normalized)) {
      return { excluded: true, reason: rule.reason };
    }
  }
  for (const pattern of extraGlobSegments) {
    if (matchesSimpleGlob(normalized, pattern)) {
      return { excluded: true, reason: '用户配置的排除规则' };
    }
  }
  return { excluded: false };
}

/**
 * 极简 glob：只支持 `*` 与 `**`。
 *
 * 用户配置的排除规则不需要完整 glob 语义；引入完整实现会带来一个仅为
 * 少量配置服务的依赖（CODING_STANDARDS.md §19）。
 */
function matchesSimpleGlob(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*\//gu, '(?:.*/)?')
    .replace(/\*\*/gu, '.*')
    .replace(/\*/gu, '[^/]*');
  return new RegExp(`^${escaped}$`, 'u').test(path);
}
