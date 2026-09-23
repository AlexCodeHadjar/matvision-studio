import { describe, expect, it } from 'vitest';
import { createMatGeometry, roundedRectangle } from './mat';
import { PRODUCTS } from '../products';
import { BufferGeometry, Vector3 } from 'three';

function triangles(geometry: BufferGeometry): [Vector3, Vector3, Vector3][] {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const result: [Vector3, Vector3, Vector3][] = [];
  for (let i = 0; i < (index?.count ?? pos.count); i += 3) {
    const point = (j: number) => new Vector3().fromBufferAttribute(pos, index ? index.getX(j) : j);
    result.push([point(i), point(i + 1), point(i + 2)]);
  }
  return result;
}

function assertClosedVolume(geometries: BufferGeometry[], expectedMaxVolume: number): void {
  const edges = new Map<string, { count: number; balance: number }>();
  let volume = 0;
  const key = (v: Vector3) =>
    v
      .toArray()
      .map((n) => Math.round(n * 1e7))
      .join(',');
  for (const geometry of geometries) {
    for (const [a, b, c] of triangles(geometry)) {
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      expect(cross.length(), 'no zero-area triangle').toBeGreaterThan(1e-12);
      volume += a.dot(b.clone().cross(c)) / 6;
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const from = key(p);
        const to = key(q);
        const id = [from, to].sort().join('|');
        const edge = edges.get(id) ?? { count: 0, balance: 0 };
        edge.count++;
        edge.balance += from < to ? 1 : -1;
        edges.set(id, edge);
      }
    }
  }
  for (const edge of edges.values()) {
    expect(edge.count, 'each welded edge meets exactly two faces').toBe(2);
    expect(edge.balance, 'adjacent faces use opposite directed edges').toBe(0);
  }
  // A tiny bevel removes less than 1% of the rounded extrusion's volume.
  expect(volume, 'positive signed volume means outward winding').toBeGreaterThan(
    expectedMaxVolume * 0.99,
  );
  expect(volume).toBeLessThanOrEqual(expectedMaxVolume * 1.000001);
}

describe('physical mat geometry', () => {
  for (const product of PRODUCTS) {
    it(`${product.id} has exact configurable SI extents and closed outward volume`, () => {
      for (const thickness of [2, 3, 5]) {
        const { body, top } = createMatGeometry(product, thickness);
        const size = body.boundingBox!.getSize(new Vector3());
        expect(size.x).toBeCloseTo(product.widthMm / 1000, 7);
        expect(size.z).toBeCloseTo(product.heightMm / 1000, 7);
        expect(size.y).toBeCloseTo(thickness / 1000, 8);
        expect(body.boundingBox!.min.y).toBeCloseTo(0, 8);
        expect(top.boundingBox!.min.y).toBeCloseTo(thickness / 1000, 8);
        const w = product.widthMm / 1000;
        const h = product.heightMm / 1000;
        const r = product.cornerRadiusMm / 1000;
        assertClosedVolume([body, top], ((w * h - (4 - Math.PI) * r * r) * thickness) / 1000);
        // A two-dimensional mesh supports local corner bends and travelling waves.
        expect(triangles(body).length + triangles(top).length).toBeLessThan(100_000);
        body.dispose();
        top.dispose();
      }
    }, 30_000); // Exhaustive topology checks cover every face at three thicknesses.

    it(`${product.id} maps print right to +X and print top to -Z without stretching`, () => {
      const { body, top } = createMatGeometry(product, product.thicknessMm);
      const pos = top.getAttribute('position');
      const uv = top.getAttribute('uv');
      const normal = top.getAttribute('normal');
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / (product.widthMm / 1000) + 0.5, 6);
        expect(uv.getY(i)).toBeCloseTo(0.5 - pos.getZ(i) / (product.heightMm / 1000), 6);
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
        expect(normal.getY(i)).toBe(1);
      }
      body.dispose();
      top.dispose();
    });
  }

  it('has true circular corner radius and smoothly varying unit bevel normals', () => {
    const product = PRODUCTS[0]!;
    const { body, top } = createMatGeometry(product, 3);
    const pos = body.getAttribute('position');
    const normal = body.getAttribute('normal');
    let curvedVertices = 0;
    let bevelVertices = 0;
    for (let i = 0; i < pos.count; i++) {
      const n = new Vector3().fromBufferAttribute(normal, i);
      expect(n.length()).toBeCloseTo(1, 6);
      if (Math.abs(n.y) > 0.1 && Math.abs(n.y) < 0.9) bevelVertices++;
      if (Math.abs(n.y) < 1e-5 && Math.abs(n.x) > 0.1 && Math.abs(n.z) > 0.1) {
        const cx =
          Math.sign(pos.getX(i)) * (product.widthMm / 2000 - product.cornerRadiusMm / 1000);
        const cz =
          Math.sign(pos.getZ(i)) * (product.heightMm / 2000 - product.cornerRadiusMm / 1000);
        expect(Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz)).toBeCloseTo(
          product.cornerRadiusMm / 1000,
          7,
        );
        curvedVertices++;
      }
    }
    expect(curvedVertices).toBeGreaterThan(20);
    expect(bevelVertices).toBeGreaterThan(20);
    // Body must never contain a second face at the print's elevation (depth fighting regression).
    expect(
      triangles(body).some((points) => points.every((p) => Math.abs(p.y - 0.003) < 1e-8)),
    ).toBe(false);
    body.dispose();
    top.dispose();
  });

  it('maps a custom printable rectangle in physical millimetres', () => {
    const product = {
      ...PRODUCTS[0]!,
      printableArea: { xMm: 50, yMm: 20, widthMm: 800, heightMm: 350 },
    };
    const { body, top } = createMatGeometry(product, 3);
    const pos = top.getAttribute('position');
    const uv = top.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      expect(uv.getX(i)).toBeCloseTo((pos.getX(i) * 1000 + 450 - 50) / 800, 6);
      expect(uv.getY(i)).toBeCloseTo(1 - (pos.getZ(i) * 1000 + 200 - 20) / 350, 6);
    }
    body.dispose();
    top.dispose();
  });

  it('handles zero-radius products without holes or invalid normals', () => {
    const product = { ...PRODUCTS[0]!, cornerRadiusMm: 0 };
    const { body, top } = createMatGeometry(product, 3);
    assertClosedVolume([body, top], 0.9 * 0.4 * 0.003);
    body.dispose();
    top.dispose();
  });

  it('rejects invalid dimensions and thickness', () => {
    expect(() => roundedRectangle(0, 1, 0)).toThrow(RangeError);
    expect(() => roundedRectangle(1, 1, -1)).toThrow(RangeError);
    for (const thickness of [0, -1, Number.NaN, Infinity]) {
      expect(() => createMatGeometry(PRODUCTS[0]!, thickness)).toThrow(RangeError);
    }
  });
});
