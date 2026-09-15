import { BufferGeometry, Float32BufferAttribute, Shape } from 'three';
import type { ProductDefinition } from '../contracts';
import { mmToMetres, validateProduct } from '../products';

// Three.js samples circular curves twice per segment: 12 steps per corner.
const CURVE_SEGMENTS = 6;

export function roundedRectangle(width: number, height: number, radius: number): Shape {
  if (![width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius < 0) {
    throw new RangeError('Rounded rectangle dimensions must be positive and radius nonnegative.');
  }
  const x = width / 2;
  const y = height / 2;
  const r = Math.min(radius, x, y);
  const shape = new Shape();
  if (r === 0) {
    shape.moveTo(-x, -y);
    shape.lineTo(x, -y);
    shape.lineTo(x, y);
    shape.lineTo(-x, y);
  } else {
    shape.moveTo(-x + r, -y);
    shape.lineTo(x - r, -y);
    shape.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x, y - r);
    shape.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    shape.lineTo(-x + r, y);
    shape.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(-x, -y + r);
    shape.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  }
  shape.closePath();
  return shape;
}

/** Closed SI volume with smooth corner/bevel normals and a separate print cap. */
export function createMatGeometry(product: ProductDefinition, thicknessMm: number) {
  validateProduct({ ...product, thicknessMm });
  const w = mmToMetres(product.widthMm);
  const h = mmToMetres(product.heightMm);
  const t = mmToMetres(thicknessMm);
  const r = mmToMetres(product.cornerRadiusMm);
  // At most 0.25 mm; never expand catalogue extents or consume a tiny corner.
  const bevel = Math.min(0.00025, t / 5, r / 2);
  const sampled = roundedRectangle(w, h, r).extractPoints(CURVE_SEGMENTS).shape;
  const perimeter = sampled.filter(
    (point, i) => i === 0 || point.distanceToSquared(sampled[i - 1]!) > 1e-20,
  );
  if (perimeter[0]!.distanceToSquared(perimeter[perimeter.length - 1]!) < 1e-20) perimeter.pop();
  const count = perimeter.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const diagonal = Math.SQRT1_2;
  const rings =
    bevel > 0
      ? [
          { y: 0, inset: bevel, horizontal: 0, vertical: -1 },
          {
            y: bevel * (1 - diagonal),
            inset: bevel * (1 - diagonal),
            horizontal: diagonal,
            vertical: -diagonal,
          },
          { y: bevel, inset: 0, horizontal: 1, vertical: 0 },
          { y: t - bevel, inset: 0, horizontal: 1, vertical: 0 },
          {
            y: t - bevel * (1 - diagonal),
            inset: bevel * (1 - diagonal),
            horizontal: diagonal,
            vertical: diagonal,
          },
          { y: t, inset: bevel, horizontal: 0, vertical: 1 },
        ]
      : [
          { y: 0, inset: 0, horizontal: 1, vertical: 0 },
          { y: t, inset: 0, horizontal: 1, vertical: 0 },
        ];
  for (const ring of rings) {
    for (const point of perimeter) {
      const centerX = Math.max(-w / 2 + r, Math.min(w / 2 - r, point.x));
      const centerY = Math.max(-h / 2 + r, Math.min(h / 2 - r, point.y));
      let nx = point.x - centerX;
      let ny = point.y - centerY;
      const length = Math.hypot(nx, ny);
      if (length > 0) {
        nx /= length;
        ny /= length;
      } else {
        nx = Math.sign(point.x) * diagonal;
        ny = Math.sign(point.y) * diagonal;
      }
      positions.push(point.x - nx * ring.inset, ring.y, -point.y + ny * ring.inset);
      normals.push(nx * ring.horizontal, ring.vertical, -ny * ring.horizontal);
      uvs.push((point.x + w / 2) / w, ring.y / t);
    }
  }
  for (let layer = 0; layer < rings.length - 1; layer++) {
    for (let i = 0; i < count; i++) {
      const a = layer * count + i;
      const b = layer * count + ((i + 1) % count);
      indices.push(a, b, b + count, a, b + count, a + count);
    }
  }
  // Only one cap at each height: the fabric mesh closes the top. A second rubber
  // cap under an epsilon-offset print caused severe depth fighting at long views.
  const bottomStart = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!;
    const z = positions[i * 3 + 2]!;
    positions.push(x, 0, z);
    normals.push(0, -1, 0);
    uvs.push((x + w / 2) / w, (-z + h / 2) / h);
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, 0, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < count; i++) {
    indices.push(bottomCenter, bottomStart + ((i + 1) % count), bottomStart + i);
  }
  const body = new BufferGeometry();
  body.setAttribute('position', new Float32BufferAttribute(positions, 3));
  body.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  body.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  body.setIndex(indices);
  body.computeBoundingBox();
  body.computeBoundingSphere();

  const top = new BufferGeometry();
  const topPositions: number[] = [];
  const topNormals: number[] = [];
  const topUvs: number[] = [];
  const topIndices: number[] = [];
  const area = product.printableArea;
  for (let i = 0; i <= count; i++) {
    const source = ((rings.length - 1) * count + i) * 3;
    const x = i === count ? 0 : positions[source]!;
    const z = i === count ? 0 : positions[source + 2]!;
    topPositions.push(x, t, z);
    topNormals.push(0, 1, 0);
    // Image top is negative scene Z. Bounds outside a custom printable rectangle
    // intentionally extend past 0..1 for the print shader to clip.
    topUvs.push(
      ((x + w / 2) * 1000 - area.xMm) / area.widthMm,
      1 - ((h / 2 + z) * 1000 - area.yMm) / area.heightMm,
    );
    if (i < count) topIndices.push(count, i, (i + 1) % count);
  }
  top.setAttribute('position', new Float32BufferAttribute(topPositions, 3));
  top.setAttribute('normal', new Float32BufferAttribute(topNormals, 3));
  top.setAttribute('uv', new Float32BufferAttribute(topUvs, 2));
  top.setIndex(topIndices);
  top.computeBoundingBox();
  top.computeBoundingSphere();
  return { body, top };
}
