import { BufferGeometry, Float32BufferAttribute, Vector2 } from 'three';
import type { ProductDefinition } from '../contracts';
import { roundedRectangle } from './mat';

/** Raised 2.4 mm sewn binding with perimeter UVs for repeating thread normals. */
export function createStitchedGeometry(product: ProductDefinition, thicknessMm: number) {
  const w = product.widthMm / 1000,
    h = product.heightMm / 1000,
    t = thicknessMm / 1000;
  const r = product.cornerRadiusMm / 1000,
    edgeInset = 0.0003,
    binding = 0.0024;
  const raw = roundedRectangle(
    w - edgeInset * 2,
    h - edgeInset * 2,
    Math.max(0, r - edgeInset),
  ).getPoints(12);
  const points = raw.filter((p, i) => i === 0 || p.distanceToSquared(raw[i - 1]!) > 1e-15);
  if (points[0]!.distanceToSquared(points.at(-1)!) < 1e-15) points.pop();
  const distances = [0];
  for (let i = 1; i <= points.length; i++)
    distances.push(distances[i - 1]! + points[i % points.length]!.distanceTo(points[i - 1]!));
  const perimeterM = distances.at(-1)!;
  const positions: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let ring = 0; ring < 3; ring++)
    for (let i = 0; i <= points.length; i++) {
      const p = points[i % points.length]!;
      const normal = new Vector2(
        p.x - Math.max(-w / 2 + r, Math.min(w / 2 - r, p.x)),
        p.y - Math.max(-h / 2 + r, Math.min(h / 2 - r, p.y)),
      ).normalize();
      const inset = (ring * binding) / 2;
      positions.push(
        p.x - normal.x * inset,
        t + [0.00002, 0.00022, 0.00006][ring]!,
        -p.y + normal.y * inset,
      );
      uv.push(distances[i]! / perimeterM, ring / 2);
    }
  const n = points.length + 1;
  for (let ring = 0; ring < 2; ring++)
    for (let i = 0; i < points.length; i++) {
      const a = ring * n + i,
        b = a + n;
      index.push(a, a + 1, b + 1, a, b + 1, b);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, perimeterM };
}
