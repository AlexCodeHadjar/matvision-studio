import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { PRODUCTS } from '../products';
import { createStitchedGeometry } from './stitch';

describe('physical stitched binding', () => {
  for (const product of PRODUCTS) {
    it(`${product.id} has a narrow raised band with positive winding and a closed UV seam`, () => {
      const { geometry, perimeterM } = createStitchedGeometry(product, 3);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBeGreaterThan(0.003);
      expect(geometry.boundingBox!.max.y).toBeLessThan(0.0035);
      expect(geometry.boundingBox!.max.x).toBeLessThan(product.widthMm / 2000);
      expect(geometry.boundingBox!.max.z).toBeLessThan(product.heightMm / 2000);
      expect(perimeterM).toBeGreaterThan((product.widthMm + product.heightMm) / 500 - 0.05);
      const positions = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv');
      const index = geometry.getIndex()!;
      expect(index.count / 3).toBeLessThan(600);
      for (let i = 0; i < index.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(positions, index.getX(i));
        const b = new Vector3().fromBufferAttribute(positions, index.getX(i + 1)).sub(a);
        const c = new Vector3().fromBufferAttribute(positions, index.getX(i + 2)).sub(a);
        const normal = b.cross(c);
        expect(normal.length()).toBeGreaterThan(1e-12);
        expect(normal.y).toBeGreaterThan(0);
      }
      const ringCount = positions.count / 3;
      for (let ring = 0; ring < 3; ring++) {
        const start = ring * ringCount,
          end = start + ringCount - 1;
        expect(
          new Vector3()
            .fromBufferAttribute(positions, start)
            .distanceTo(new Vector3().fromBufferAttribute(positions, end)),
        ).toBeLessThan(1e-8);
        expect(uv.getX(start)).toBe(0);
        expect(uv.getX(end)).toBe(1);
      }
      geometry.dispose();
    });
  }
});
