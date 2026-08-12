import { describe, expect, it } from 'vitest';
import { assertNever, err, isOk, ok } from './result.js';

describe('Result', () => {
  it('ok 携带值', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(result.ok && result.value).toBe(42);
  });

  it('err 携带错误', () => {
    const result = err('boom');
    expect(isOk(result)).toBe(false);
    expect(!result.ok && result.error).toBe('boom');
  });
});

describe('assertNever', () => {
  it('遇到未覆盖的分支时抛出可诊断的错误', () => {
    const unexpected = 'surprise' as never;
    expect(() => assertNever(unexpected, '未处理的节点类型')).toThrow(
      /未处理的节点类型: "surprise"/u,
    );
  });
});
