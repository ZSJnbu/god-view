import { describe, expect, it } from 'vitest';
import {
  currentProtocolVersion,
  isProtocolVersionSupported,
  negotiateProtocolVersion,
  parseProtocolVersion,
} from './version.js';

describe('协议版本解析', () => {
  it('解析 major.minor', () => {
    expect(parseProtocolVersion('2.7')).toEqual({ major: 2, minor: 7 });
  });

  it.each(['1', '1.2.3', 'v1.2', '', '1.x'])('拒绝非法版本 %s', (value) => {
    expect(parseProtocolVersion(value)).toBeUndefined();
  });
});

describe('兼容判定', () => {
  it('接受当前版本', () => {
    expect(isProtocolVersionSupported(currentProtocolVersion)).toBe(true);
  });

  it('接受同 major 的更高 minor：读取方忽略未知可选字段', () => {
    expect(isProtocolVersionSupported('2.9', '2.4')).toBe(true);
  });

  it('接受当前 major 的兼容窗口', () => {
    expect(isProtocolVersionSupported('2.3', '2.4')).toBe(true);
    expect(isProtocolVersionSupported('1.0', currentProtocolVersion)).toBe(true);
  });

  it('拒绝过旧的 minor', () => {
    expect(isProtocolVersionSupported('2.0', '2.5')).toBe(false);
  });

  it('拒绝不同 major，不做宽松猜测', () => {
    expect(isProtocolVersionSupported('3.0', '2.4')).toBe(false);
    expect(isProtocolVersionSupported('1.9', '2.0')).toBe(false);
  });

  it.each([
    ['bad', '2.0'],
    ['2.0', 'bad'],
  ])('版本串非法时返回 false（%s / %s）', (incoming, current) => {
    expect(isProtocolVersionSupported(incoming, current)).toBe(false);
  });
});

describe('版本协商', () => {
  it('取双方都支持的最高 minor', () => {
    expect(negotiateProtocolVersion(['2.2', '2.5', '3.1'], '2.4')).toBe('2.4');
  });

  it('对端 minor 更低时降级到对端', () => {
    expect(negotiateProtocolVersion(['2.3'], '2.4')).toBe('2.3');
  });

  it('没有兼容版本时返回 undefined，而不是猜一个', () => {
    expect(negotiateProtocolVersion(['3.0', '1.0'], '2.4')).toBeUndefined();
    expect(negotiateProtocolVersion([], '2.4')).toBeUndefined();
    expect(negotiateProtocolVersion(['2.0'], '2.5')).toBeUndefined();
  });

  it('忽略无法解析的版本串', () => {
    expect(negotiateProtocolVersion(['garbage', '2.4'], '2.4')).toBe('2.4');
  });

  it('当前版本非法时返回 undefined', () => {
    expect(negotiateProtocolVersion(['2.4'], 'nope')).toBeUndefined();
  });
});
