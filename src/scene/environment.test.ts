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

it('gives four distinct finite HDR environments with physically overhead light', () => {
  const width = 64;
  const height = 32;
  const energies: number[] = [];
  for (const preset of ['neutral-studio', 'bright-studio', 'warm-room', 'desk-setup'] as const) {
    const data = generateStudioRadiance(width, height, preset);
    let lower = 0;
    let upper = 0;
    let red = 0;
    let blue = 0;
    let maximum = 0;
    for (let y = 0; y < height; y++) {
      const weight = Math.sin((Math.PI * y) / height);
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          expect(Number.isFinite(data[i + channel]!)).toBe(true);
          expect(data[i + channel]).toBeGreaterThan(0);
        }
        const value = data[i]!;
        red += value * weight;
        blue += data[i + 2]! * weight;
        maximum = Math.max(maximum, value);
        if (y < height / 2) lower += value * weight;
        else upper += value * weight;
      }
    }
    expect(maximum).toBeGreaterThan(1);
    expect(upper).toBeGreaterThan(lower * 2);
    if (preset === 'warm-room') expect(red).toBeGreaterThan(blue * 1.3);
    else if (preset === 'desk-setup') expect(blue).toBeGreaterThan(red * 1.1);
    else expect(red).toBeCloseTo(blue);
    energies.push(red);
  }
  expect(new Set(energies.map(Math.round)).size).toBe(4);
});

it('rejects invalid HDR dimensions before allocating memory', () => {
  expect(() => generateStudioRadiance(NaN, 64)).toThrow(RangeError);
  expect(() => generateStudioRadiance(0, 64)).toThrow(RangeError);
  expect(() => generateStudioRadiance(16384, 8192)).toThrow(RangeError);
});
