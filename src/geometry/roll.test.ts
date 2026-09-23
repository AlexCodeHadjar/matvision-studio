import { BufferGeometry, Float32BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { MatRollDeformer } from './roll';

function strip() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [-0.45, 0.003, -0.2, 0.45, 0.003, -0.2, -0.45, 0.003, 0.2, 0.45, 0.003, 0.2],
      3,
    ),
  );
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  return geometry;
}

describe('showcase deformation', () => {
  it('lifts one corner and restores the saved roll pose without accumulating displacement', () => {
    const geometry = strip();
    const original = Array.from(geometry.getAttribute('position').array);
    const deformer = new MatRollDeformer();
    deformer.add(geometry);
    deformer.applyShowcase(0.9, 0.4, 0.003, 'corner-lift', 0.5, true);
    expect(geometry.getAttribute('position').getY(2)).toBeGreaterThan(0.05);
    expect(geometry.getAttribute('position').getY(3)).toBeCloseTo(0.003, 6);
    deformer.apply(0.4, 0.003, 0, true);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(original);
    geometry.dispose();
  });

  it.each(['soft-wave', 'dual-roll'] as const)('%s produces finite geometry', (animation) => {
    const geometry = strip();
    const deformer = new MatRollDeformer();
    deformer.add(geometry);
    deformer.applyShowcase(0.9, 0.4, 0.003, animation, 0.5, true);
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    geometry.dispose();
  });
});

it('keeps two rolled edges separated and returns both ends to the rest pose', () => {
  const geometry = strip();
  const original = Array.from(geometry.getAttribute('position').array);
  const deformer = new MatRollDeformer();
  deformer.add(geometry);
  deformer.applyShowcase(0.9, 0.4, 0.003, 'dual-roll', 0.5, true);
  const pos = geometry.getAttribute('position');
  expect(pos.getZ(0)).toBeLessThan(-0.025);
  expect(pos.getZ(2)).toBeGreaterThan(0.025);
  for (const animation of ['corner-lift', 'soft-wave', 'table-drop', 'dual-roll'] as const) {
    for (const progress of [0, 1]) {
      deformer.applyShowcase(0.9, 0.4, 0.003, animation, progress, true);
      expect(Array.from(pos.array)).toEqual(original);
    }
  }
  geometry.dispose();
});
