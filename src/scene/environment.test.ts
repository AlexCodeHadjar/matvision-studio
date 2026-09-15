import { expect, it } from 'vitest';
import { generateStudioRadiance } from './environment';

it('places neutral HDR softboxes above the surface in Three equirectangular coordinates', () => {
  const width = 128;
  const height = 64;
  const data = generateStudioRadiance(width, height);
  let lower = 0;
  let upper = 0;
  let maximum = 0;
  for (let y = 0; y < height; y++) {
    // Latitude area weighting gives equal solid-angle contributions.
    const weight = Math.sin((Math.PI * y) / height);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const red = data[i]!;
      expect(Number.isFinite(red)).toBe(true);
      expect(red).toBeGreaterThanOrEqual(0);
      expect(data[i + 1]).toBe(red);
      expect(data[i + 2]).toBe(red);
      expect(data[i + 3]).toBe(1);
      maximum = Math.max(maximum, red);
      if (y < height / 2) lower += red * weight;
      else upper += red * weight;
    }
  }
  expect(maximum).toBeGreaterThan(1);
  expect(upper).toBeGreaterThan(lower * 2);
});
