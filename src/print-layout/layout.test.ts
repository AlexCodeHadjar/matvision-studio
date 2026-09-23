import { describe, expect, it } from 'vitest';
import type { PreviewResolution, PrintableArea, PrintLayout } from '../contracts';
import {
  computeEffectiveDpi,
  computePreviewResolution,
  computePrintTransform,
  imageUvAt,
  qualityFromDpi,
} from './layout';

const area: PrintableArea = { xMm: 0, yMm: 0, widthMm: 900, heightMm: 400 };
const defaults: PrintLayout = { mode: 'cover', scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 };
const square: PreviewResolution = { widthPx: 1000, heightPx: 1000 };
const transform = (layout: Partial<PrintLayout> = {}, image = square, printable = area) =>
  computePrintTransform(image, printable, { ...defaults, ...layout });
function expectPoint(point: { x: number; y: number }, x: number, y: number) {
  expect(point.x).toBeCloseTo(x, 9);
  expect(point.y).toBeCloseTo(y, 9);
}

describe('physical print placement', () => {
  it.each([
    ['cover', 1000, 1000, 900, 900],
    ['contain', 1000, 1000, 400, 400],
    ['cover', 2000, 1000, 900, 450],
    ['contain', 2000, 1000, 800, 400],
    ['cover', 4000, 1000, 1600, 400],
    ['contain', 4000, 1000, 900, 225],
    ['cover', 1000, 3000, 900, 2700],
    ['contain', 1000, 3000, 400 / 3, 400],
    ['stretch', 1000, 3000, 900, 400],
  ] as const)('%s %i×%i has physical size %i×%i mm', (mode, widthPx, heightPx, w, h) => {
    const result = transform({ mode }, { widthPx, heightPx });
    expect(result.widthMm).toBeCloseTo(w);
    expect(result.heightMm).toBeCloseTo(h);
    if (mode !== 'stretch')
      expect(result.widthMm / result.heightMm).toBeCloseTo(widthPx / heightPx);
  });
  it('matches native-aspect artwork at every corner', () => {
    const result = transform({}, { widthPx: 900, heightPx: 400 });
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
      expectPoint(imageUvAt(u!, v!, result), u!, v!);
    expect(result.visibleFraction).toBeCloseTo(1);
  });
  it('crops a cover square equally on top/bottom', () => {
    const result = transform();
    expectPoint(imageUvAt(0, 0, result), 0, 0.5 - 200 / 900);
    expectPoint(imageUvAt(1, 1, result), 1, 0.5 + 200 / 900);
    expect(result.visibleFraction).toBeCloseTo(400 / 900);
    expect(result.visibleImageUv).toHaveLength(4);
  });
  it('contains the entire image and leaves physical margins', () => {
    const result = transform({ mode: 'contain' });
    expectPoint(result.footprintUv[0]!, 250 / 900, 0);
    expectPoint(result.footprintUv[2]!, 650 / 900, 1);
    expect(result.visibleFraction).toBeCloseTo(1);
    expect(imageUvAt(0, 0.5, result).x).toBeLessThan(0);
  });
  it('uses printable dimensions, independent of its product origin', () => {
    const a = transform({}, square, { ...area, widthMm: 400, heightMm: 450 });
    const b = transform({}, square, { xMm: 40, yMm: 20, widthMm: 400, heightMm: 450 });
    expect(a).toEqual(b);
    expect(a.widthMm).toBe(450);
  });
  it('positive offset moves the image right/up by printable-size fractions', () => {
    const result = transform({ offsetX: 0.2, offsetY: 0.1 });
    expectPoint(imageUvAt(0.7, 0.6, result), 0.5, 0.5);
    expect(imageUvAt(0.5, 0.5, result).x).toBeLessThan(0.5);
    expect(imageUvAt(0.5, 0.5, result).y).toBeLessThan(0.5);
  });
  it('rotation is counterclockwise in physical space without skew on non-square mats', () => {
    const result = transform({ mode: 'contain', rotationDeg: 90 });
    // Image bottom-right rotates to printable top-right.
    expectPoint(result.footprintUv[1]!, 0.5 + 200 / 900, 1);
    expectPoint(imageUvAt(0.5, 1, result), 1, 0.5);
    expectPoint(imageUvAt(0.5 + 200 / 900, 0.5, result), 0.5, 0);
  });
  it.each([-450, -30, 0, 45, 90, 123, 270, 720])(
    'inverse recovers corners at %i degrees with scale/offset',
    (rotationDeg) => {
      const result = transform({ rotationDeg, scale: 1.7, offsetX: 0.13, offsetY: -0.21 });
      const corners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      result.footprintUv.forEach((point, i) =>
        expectPoint(imageUvAt(point.x, point.y, result), corners[i]![0]!, corners[i]![1]!),
      );
    },
  );
  it('zoom doubles physical size and crops four times as much for native aspect', () => {
    const result = transform({ scale: 2 }, { widthPx: 900, heightPx: 400 });
    expect(result.widthMm).toBe(1800);
    expect(result.heightMm).toBe(800);
    expect(result.visibleFraction).toBeCloseTo(0.25);
  });
  it('computes exact rotated visible polygon rather than its bounding box', () => {
    const result = transform({ rotationDeg: 45 }, square, { ...area, widthMm: 400, heightMm: 400 });
    expect(result.visibleImageUv).toHaveLength(8);
    expect(result.visibleFraction).toBeCloseTo(2 * Math.SQRT2 - 2);
  });
  it('returns empty crop when image is completely outside printable area', () => {
    const result = transform({ offsetX: 3 });
    expect(result.visibleImageUv).toEqual([]);
    expect(result.visibleFraction).toBe(0);
  });
  it.each([
    { scale: 0 },
    { scale: -1 },
    { scale: Infinity },
    { rotationDeg: NaN },
    { offsetX: Infinity },
  ])('rejects invalid placement %j', (value) => {
    expect(() => transform(value)).toThrow(RangeError);
  });
});

describe('effective original-pixel DPI', () => {
  it('calculates ~300 and ~150 DPI for reference deskmat resolutions', () => {
    expect(
      computeEffectiveDpi({ widthPx: 10630, heightPx: 4724 }, area, defaults).minimum,
    ).toBeCloseTo(299.974, 2);
    expect(
      computeEffectiveDpi({ widthPx: 5315, heightPx: 2362 }, area, defaults).minimum,
    ).toBeCloseTo(149.987, 2);
  });
  it('scale halves DPI, while rotation and offsets do not affect pixel density', () => {
    const base = computeEffectiveDpi(square, area, defaults);
    const next = computeEffectiveDpi(square, area, {
      ...defaults,
      scale: 2,
      rotationDeg: 37,
      offsetX: 0.2,
    });
    expect(next.minimum).toBeCloseTo(base.minimum / 2);
  });
  it('reports both stretch-axis densities and classifies the lower one', () => {
    const result = computeEffectiveDpi({ widthPx: 3000, heightPx: 3000 }, area, {
      ...defaults,
      mode: 'stretch',
    });
    expect(result.x).toBeCloseTo(84.6666667);
    expect(result.y).toBeCloseTo(190.5);
    expect(result.minimum).toBe(result.x);
    expect(result.quality).toBe('Low');
  });
  it.each([
    [300, 'Excellent'],
    [299.99, 'Good'],
    [150, 'Good'],
    [149.99, 'Low'],
    [75, 'Low'],
    [74.99, 'Very Low'],
    [0, 'Very Low'],
  ] as const)('classifies %f DPI as %s', (dpi, level) => expect(qualityFromDpi(dpi)).toBe(level));
  it('allows configured production thresholds', () =>
    expect(qualityFromDpi(120, { excellent: 200, good: 100, low: 50 })).toBe('Good'));
  it('rejects malformed thresholds and DPI', () => {
    expect(() => qualityFromDpi(100, { excellent: 50, good: 100, low: 25 })).toThrow();
    expect(() => qualityFromDpi(NaN)).toThrow();
  });
});

describe('GPU preview allocation', () => {
  it.each([
    [12000, 6000, 16384, 'balanced', 4096, 2048],
    [12000, 6000, 2048, 'ultra', 2048, 1024],
    [6000, 12000, 16384, 'ultra', 4096, 8192],
    [12000, 6000, 16384, 'low', 2048, 1024],
    [12000, 6000, 16384, 'high', 4096, 2048],
    [100, 50, 16384, 'balanced', 100, 50],
    [65535, 1, 4096, 'balanced', 4096, 1],
  ] as const)('limits %i×%i at GPU %i / %s to %i×%i', (w, h, gpu, quality, widthPx, heightPx) => {
    expect(computePreviewResolution({ widthPx: w, heightPx: h }, gpu, quality)).toEqual({
      widthPx,
      heightPx,
    });
  });
  it('rejects invalid GPU limits', () =>
    expect(() => computePreviewResolution(square, 0, 'balanced')).toThrow());
});
