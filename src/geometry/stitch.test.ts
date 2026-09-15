import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { PRODUCTS } from '../products';
import { createStitchedGeometry, STITCH_PITCH_M } from './stitch';

describe('physical overlock binding', () => {
  for (const product of PRODUCTS) {
    it(`${product.id} wraps top, side and underside with uniformly spaced shared yarn`, () => {
      const { geometry, threadGeometry, matrices, colors, stitchCount, perimeterM } =
        createStitchedGeometry(product, 3);
      const bounds = geometry.boundingBox!;
      expect(bounds.min.y).toBeLessThan(0);
      expect(bounds.max.y).toBeGreaterThan(0.003);
      expect(bounds.max.y).toBeLessThan(0.0035);
      expect(bounds.max.x).toBeLessThan(product.widthMm / 2000 + 0.0001);
      expect(bounds.max.z).toBeLessThan(product.heightMm / 2000 + 0.0001);
      expect(perimeterM).toBeGreaterThan((product.widthMm + product.heightMm) / 500 - 0.05);
      expect(perimeterM / stitchCount).toBeCloseTo(STITCH_PITCH_M, 6);
      expect(matrices.length).toBe(stitchCount * 16);
      expect(colors.length).toBe(stitchCount * 3);
      expect(geometry.getIndex()!.count / 3).toBeLessThan(40_000);
      expect(threadGeometry.getIndex()!.count / 3).toBeLessThan(400);
      for (const mesh of [geometry, threadGeometry]) {
        const positions = mesh.getAttribute('position'),
          index = mesh.getIndex()!;
        for (let i = 0; i < index.count; i += 3) {
          const a = new Vector3().fromBufferAttribute(positions, index.getX(i));
          const b = new Vector3().fromBufferAttribute(positions, index.getX(i + 1)).sub(a);
          const c = new Vector3().fromBufferAttribute(positions, index.getX(i + 2)).sub(a);
          expect(b.cross(c).lengthSq()).toBeGreaterThan(1e-24);
        }
      }
      geometry.dispose();
      threadGeometry.dispose();
    });
  }
});
