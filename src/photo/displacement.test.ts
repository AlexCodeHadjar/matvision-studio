import { describe, expect, it } from 'vitest';
import { PlaneGeometry } from 'three';
import { displacePhotoGeometry, type HeightPixels } from './displacement';

const map: HeightPixels = {
  width: 2,
  height: 2,
  rgba: new Uint8ClampedArray(Array(4).fill([255, 0, 0, 255]).flat()),
  repeatX: 1,
  repeatY: 1,
  offsetX: 0,
  offsetY: 0,
  flipY: true,
};

describe('Photo-only geometry displacement', () => {
  it('adds bounded triangles and moves interior vertices in metres', async () => {
    const original = new PlaneGeometry(1, 1);
    const displaced = await displacePhotoGeometry(original, map, 0.2, new AbortController().signal);
    const positions = displaced.getAttribute('position');
    expect(positions.count / 3).toBe(32);
    expect(
      Array.from({ length: positions.count }, (_, i) => positions.getZ(i)).some((z) => z > 0.00009),
    ).toBe(true);
    expect(original.getAttribute('position').count).toBe(4);
    displaced.dispose();
    original.dispose();
  });

  it('rejects over-budget geometry and cancellation', async () => {
    const original = new PlaneGeometry(1, 1);
    await expect(
      displacePhotoGeometry(original, map, 0.2, new AbortController().signal, 4),
    ).rejects.toThrow('слишком детальна');
    const abort = new AbortController();
    abort.abort();
    await expect(displacePhotoGeometry(original, map, 0.2, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    original.dispose();
  });
});
