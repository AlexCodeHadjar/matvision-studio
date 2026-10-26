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

  it('includes the requested centimetre sizes with a full print area and 3 mm thickness', () => {
    const sizes: readonly [number, number][] = [
      [80, 30],
      [70, 30],
      [40, 30],
      [40, 40],
      [18, 22],
      [20, 24],
      [20, 25],
      [25, 25],
    ];
    for (const [width, height] of sizes) {
      const product = getProduct(`mat-${width * 10}x${height * 10}`);
      expect([product.widthMm, product.heightMm, product.thicknessMm]).toEqual([
        width * 10,
        height * 10,
        3,
      ]);
      expect(product.printableArea).toEqual({
        xMm: 0,
        yMm: 0,
        widthMm: width * 10,
        heightMm: height * 10,
      });
    }
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
