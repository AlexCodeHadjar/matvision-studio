import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../products';
import { createRulerLayout, rulerFrameProduct, rulerGap } from './rulers';

describe('dimension rulers', () => {
  for (const product of PRODUCTS)
    it(`matches both complete edges of ${product.id}`, () => {
      const plan = createRulerLayout(product);
      const gap = rulerGap(product);
      expect(plan.positions.slice(0, 6)).toEqual([
        -product.widthMm / 2000,
        0.001,
        product.heightMm / 2000 + gap,
        product.widthMm / 2000,
        0.001,
        product.heightMm / 2000 + gap,
      ]);
      for (const [axis, length] of [
        ['width', product.widthMm],
        ['height', product.heightMm],
      ] as const) {
        const labels = plan.labels.filter((label) => label.axis === axis);
        expect(labels.find((label) => label.primary)?.text).toBe(`${length / 10} см`);
        expect(labels.filter((label) => label.endpoint).map((label) => label.valueMm)).toEqual([
          0,
          length,
        ]);
        expect(labels.every((label) => label.valueMm <= length)).toBe(true);
      }
      const frame = rulerFrameProduct(product);
      expect(frame.widthMm).toBeGreaterThan(product.widthMm);
      expect(frame.heightMm).toBeGreaterThan(product.heightMm);
      expect(product.widthMm).toBe(plan.widthMm);
    });
});
