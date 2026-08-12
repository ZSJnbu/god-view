import type { OutputChannel } from 'vscode';
import type { Clock } from './clock.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

/**
 * 结构化日志端口。
 *
 * 通过注入使用，避免隐藏的全局单例（CODING_STANDARDS.md §3.2）。
 */
export interface Logger {
  debug(operation: string, fields?: LogFields): void;
  info(operation: string, fields?: LogFields): void;
  warn(operation: string, fields?: LogFields): void;
  error(operation: string, fields?: LogFields): void;
  /** 派生一个携带相同 correlation ID 的子 Logger。 */
  child(component: string, correlationId?: string): Logger;
}

const secretLike = /(token|secret|password|apikey|api_key|authorization|cookie)/iu;

/**
 * 字段脱敏。
 *
 * 日志只记录事件类型、数量、耗时、结果码，不记录完整 payload、密钥或源码
 * （TECHNICAL_ARCHITECTURE.md §12.4）。
 */
function redact(fields: LogFields): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (secretLike.test(key)) {
      parts.push(`${key}=<redacted>`);
      continue;
    }
    const text = typeof value === 'string' ? value : String(value);
    parts.push(
      `${key}=${text.length > 200 ? `${text.slice(0, 200)}…(${String(text.length)})` : text}`,
    );
  }
  return parts.join(' ');
}

class ChannelLogger implements Logger {
  readonly #channel: OutputChannel;
  readonly #component: string;
  readonly #correlationId: string | undefined;
  readonly #now: Clock;

  constructor(channel: OutputChannel, component: string, now: Clock, correlationId?: string) {
    this.#channel = channel;
    this.#component = component;
    this.#now = now;
    this.#correlationId = correlationId;
  }

  debug(operation: string, fields: LogFields = {}): void {
    this.#write('debug', operation, fields);
  }

  info(operation: string, fields: LogFields = {}): void {
    this.#write('info', operation, fields);
  }

  warn(operation: string, fields: LogFields = {}): void {
    this.#write('warn', operation, fields);
  }

  error(operation: string, fields: LogFields = {}): void {
    this.#write('error', operation, fields);
  }

  child(component: string, correlationId?: string): Logger {
    return new ChannelLogger(
      this.#channel,
      `${this.#component}.${component}`,
      this.#now,
      correlationId ?? this.#correlationId,
    );
  }

  #write(level: LogLevel, operation: string, fields: LogFields): void {
    const head = [
      this.#now(),
      level.toUpperCase(),
      this.#component,
      operation,
      this.#correlationId === undefined ? undefined : `cid=${this.#correlationId}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' ');
    const tail = redact(fields);
    this.#channel.appendLine(tail === '' ? head : `${head} ${tail}`);
  }
}

export function createLogger(channel: OutputChannel, now: Clock, component = 'god-view'): Logger {
  return new ChannelLogger(channel, component, now);
}
