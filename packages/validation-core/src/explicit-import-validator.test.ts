import { describe, expect, it } from 'vitest';
import { ExplicitImportValidator } from './explicit-import-validator.js';
import type { ValidationTarget, WorkspaceProbe } from './ports.js';

const checkedAt = '2026-08-12T05:00:00.000Z';

function probe(files: Readonly<Record<string, string>>): WorkspaceProbe {
  return {
    exists: (path) => Promise.resolve(path in files),
    readText: (path) => Promise.resolve(files[path]),
    listFirstPartyFiles: () => Promise.resolve(Object.keys(files)),
  };
}

function edge(extra: Partial<ValidationTarget> = {}): ValidationTarget {
  return {
    kind: 'edge',
    id: 'edge.orders-payment',
    paths: [],
    locations: [],
    sourcePaths: ['src/orders/index.ts'],
    targetPaths: ['src/payment/index.ts'],
    declaredEvidence: [{ kind: 'explicit_import' }],
    ...extra,
  };
}

describe('TypeScript/JavaScript 显式 import 校验', () => {
  it.each([
    ["import { pay } from '../payment';", 1],
    ["export { pay } from '../payment/index.js';", 1],
    ["const payment = require('../payment');", 1],
    ["async function load() { return import('../payment'); }", 1],
    ["// header\nimport '../payment/index.ts';", 2],
  ])('识别相对静态依赖并给出行号：%s', async (source, line) => {
    const result = await new ExplicitImportValidator(
      probe({ 'src/orders/index.ts': source, 'src/payment/index.ts': 'export const pay = 1;' }),
    ).validate(edge(), { checkedAt });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('verified');
      expect(result.value.level).toBe('L1');
      expect(result.value.evidence[0]?.location?.startLine).toBe(line);
    }
  });

  it('声明与源码不一致时返回 conflicting_declaration 漂移', async () => {
    const result = await new ExplicitImportValidator(
      probe({ 'src/orders/index.ts': "import '../shipping';" }),
    ).validate(edge(), { checkedAt });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('drifted');
      expect(result.value.driftKind).toBe('conflicting_declaration');
    }
  });

  it('节点声明目录时，目录下 index import 同样成立', async () => {
    const result = await new ExplicitImportValidator(
      probe({ 'src/orders/index.ts': "import '../payment/index.js';" }),
    ).validate(edge({ targetPaths: ['src/payment'] }), { checkedAt });
    expect(result.ok && result.value.status).toBe('verified');
  });

  it.each([
    edge({ kind: 'node' }),
    edge({ declaredEvidence: [{ kind: 'agent_claim' }] }),
    edge({ sourcePaths: ['src/orders/orders.py'] }),
    edge({ targetPaths: [] }),
  ])('不支持的声明明确返回 unsupported：%j', async (target) => {
    const validator = new ExplicitImportValidator(probe({}));
    expect(validator.supports(target)).toBe(false);
    const result = await validator.validate(target, { checkedAt });
    expect(result.ok && result.value.status).toBe('unsupported');
  });

  it('文件不可读时返回 unsupported，不伪装成缺少 import', async () => {
    const result = await new ExplicitImportValidator(probe({})).validate(edge(), { checkedAt });
    expect(result.ok && result.value.status).toBe('unsupported');
  });

  it('包别名 import 不推断为相对源码关系', async () => {
    const result = await new ExplicitImportValidator(
      probe({ 'src/orders/index.ts': "import { pay } from '@app/payment';" }),
    ).validate(edge(), { checkedAt });
    expect(result.ok && result.value.status).toBe('drifted');
  });

  it('识别 @/ 映射到 src/ 的项目内部 import', async () => {
    const result = await new ExplicitImportValidator(
      probe({
        'src/orders/index.ts': "import { pay } from '@/payment';",
        'src/payment/index.ts': 'export const pay = 1;',
      }),
    ).validate(edge(), { checkedAt });

    expect(result.ok && result.value.status).toBe('verified');
    if (result.ok) expect(result.value.evidence[0]?.detail).toContain('@/payment → src/payment');
  });
});
