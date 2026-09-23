import { describe, expect, it } from 'vitest';
import { aspectRatio, getProduct, mmToMetres, PRODUCTS, validateProduct } from './index';

describe('physical product catalogue', () => {
  it('represents both manufactured products in SI metres', () => {
    const desk = getProduct('deskmat-900x400');
    const mouse = getProduct('mousepad-400x450');
    expect([
      mmToMetres(desk.widthMm),
      mmToMetres(desk.heightMm),
      mmToMetres(desk.thicknessMm),
    ]).toEqual([0.9, 0.4, 0.003]);
    expect([mmToMetres(mouse.widthMm), mmToMetres(mouse.heightMm)]).toEqual([0.4, 0.45]);
    expect(aspectRatio(desk.widthMm, desk.heightMm)).toBe(2.25);
    expect(aspectRatio(mouse.widthMm, mouse.heightMm)).toBeCloseTo(8 / 9);
  });

  it('has unique ids and valid printable rectangles', () => {
    expect(new Set(PRODUCTS.map((product) => product.id)).size).toBe(PRODUCTS.length);
    for (const product of PRODUCTS) expect(() => validateProduct(product)).not.toThrow();
  });

  it('rejects an unknown product and nonphysical input', () => {
    expect(() => getProduct('unavailable')).toThrow('Unknown product');
    expect(() => mmToMetres(Infinity)).toThrow();
    expect(() => aspectRatio(100, 0)).toThrow();
    expect(() => aspectRatio(-1, 2)).toThrow();
    expect(() =>
      validateProduct({ ...getProduct('deskmat-900x400'), cornerRadiusMm: 201 }),
    ).toThrow();
    expect(() =>
      validateProduct({
        ...getProduct('deskmat-900x400'),
        printableArea: { xMm: 1, yMm: 0, widthMm: 900, heightMm: 400 },
      }),
    ).toThrow();
  });
});
