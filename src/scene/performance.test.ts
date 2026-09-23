import { describe, expect, it } from 'vitest';
import { estimateSceneTextureBytes, estimateTextureBytes } from './performance';

describe('owned texture storage estimates', () => {
  it('counts every mip level for square, NPOT and one-pixel panorama textures', () => {
    expect(estimateTextureBytes(4, 4)).toBe((16 + 4 + 1) * 4);
    expect(estimateTextureBytes(3, 5)).toBe((15 + 2 + 1) * 4);
    expect(estimateTextureBytes(1, 8192)).toBe((16384 - 1) * 4);
    expect(estimateTextureBytes(768, 1024, 8, false)).toBe(768 * 1024 * 8);
  });

  it('keeps cached sample and ruler storage in the estimate after user print loads', () => {
    const base = {
      fallback: { widthPx: 1800, heightPx: 800 },
      print: null,
      referenceLabelCount: 6,
      materialBytes: 1_400_000,
      environmentWidth: 336,
      environmentHeight: 512,
      shadowSize: 1024,
    };
    const cached = estimateSceneTextureBytes(base);
    const print = { widthPx: 4096, heightPx: 2048 };
    expect(estimateSceneTextureBytes({ ...base, print }) - cached).toBe(
      estimateTextureBytes(4096, 2048),
    );
    expect(cached - estimateSceneTextureBytes({ ...base, referenceLabelCount: 0 })).toBe(
      6 * estimateTextureBytes(128, 64),
    );
  });

  it('rejects invalid dimensions instead of publishing misleading metrics', () => {
    for (const size of [0, -1, 1.5, NaN, Infinity])
      expect(() => estimateTextureBytes(size, 1)).toThrow(RangeError);
  });
});
