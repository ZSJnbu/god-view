import { describe, expect, it } from 'vitest';
import { clampFloatingBounds } from './FloatingAgentPane.js';

describe('floating Agent pane bounds', () => {
  it('keeps a moved and resized pane inside the viewport', () => {
    expect(clampFloatingBounds({ x: 900, y: -40, width: 700, height: 500 }, 1200, 800)).toEqual({
      x: 484,
      y: 16,
      width: 700,
      height: 500,
    });
  });

  it('enforces a usable minimum while adapting to a small viewport', () => {
    expect(clampFloatingBounds({ x: 0, y: 0, width: 100, height: 80 }, 500, 360)).toEqual({
      x: 16,
      y: 16,
      width: 360,
      height: 240,
    });
  });
});
