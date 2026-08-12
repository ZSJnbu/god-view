/**
 * 领域内统一的成功/失败结果类型。
 *
 * 使用显式 Result 而不是抛异常，是因为事件归约、校验和协议解析属于
 * 「合法输入也可能被拒绝」的路径：调用方必须处理失败，而不是靠 try/catch
 * 兜住所有类别（见 CODING_STANDARDS.md §7.1）。
 */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** 用于 switch/if 的穷尽性检查，遗漏分支时在编译期报错。 */
export function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
