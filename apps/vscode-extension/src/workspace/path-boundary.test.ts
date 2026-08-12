import { describe, expect, it } from 'vitest';
import { isFsPathWithinRoot } from './path-boundary.js';

describe('isFsPathWithinRoot', () => {
  it('按 Windows 语义接受盘符大小写不同的子路径', () => {
    expect(isFsPathWithinRoot('d:\\repo', 'D:\\repo\\src\\index.ts', true)).toBe(true);
  });

  it('不把同名前缀的兄弟目录当成子目录', () => {
    expect(isFsPathWithinRoot('/repo', '/repo-backup/src/index.ts', false)).toBe(false);
  });

  it('在大小写敏感平台拒绝大小写不一致的路径', () => {
    expect(isFsPathWithinRoot('/Repo', '/repo/src/index.ts', false)).toBe(false);
  });
});
