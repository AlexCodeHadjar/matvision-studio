import { BufferGeometry, Float32BufferAttribute, Shape, Vector2 } from 'three';
import type { ProductDefinition } from '../contracts';
import { mmToMetres, validateProduct } from '../products';

// Three.js samples circular curves twice per segment: 12 steps per corner.
const CURVE_SEGMENTS = 6;

/** Bend around X: subdivide changes in Y/Z, keeping long straight X edges cheap. */
export function subdivideBendPerimeter(points: Vector2[]): Vector2[] {
  return points.flatMap((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const steps = Math.max(
      1,
      Math.abs(next.x - point.x) < 1e-12 ? Math.ceil(Math.abs(next.y - point.y) / 0.0015) : 1,
      Math.abs(next.y - point.y) < 1e-12 ? Math.ceil(Math.abs(next.x - point.x) / 0.015) : 1,
    );
    return Array.from({ length: steps }, (_, step) => point.clone().lerp(next, step / steps));
  });
}

/** Strip tessellation follows the exact bevel outline and retains physical print UVs. */
function appendCap(
  outline: { x: number; z: number }[],
  height: number,
  up: boolean,
  product: ProductDefinition,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
) {
  const rows = outline
    .map((p) => p.z)
    .sort((a, b) => a - b)
    .filter((z, i, sorted) => i === 0 || z - sorted[i - 1]! > 1e-9);
  const rowIndices: number[][] = [];
  const w = product.widthMm / 1000,
    h = product.heightMm / 1000;
  for (let row = 0; row < rows.length; row++) {
    const z = rows[row]!;
    let left = Infinity,
      right = -Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!,
        b = outline[(i + 1) % outline.length]!;
      if (z < Math.min(a.z, b.z) - 1e-9 || z > Math.max(a.z, b.z) + 1e-9) continue;
      if (Math.abs(a.z - b.z) < 1e-9) {
        left = Math.min(left, a.x, b.x);
        right = Math.max(right, a.x, b.x);
      } else {
        const f = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
        const x = a.x + (b.x - a.x) * f;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    const boundary = outline.filter((p) => Math.abs(p.z - z) < 1e-9).map((p) => p.x);
    const columns = Math.max(2, Math.ceil((right - left) / 0.015));
    const xs = (
      row === 0 || row === rows.length - 1
        ? boundary
        : [
            left,
            right,
            ...Array.from(
              { length: columns - 1 },
              (_, i) => left + ((right - left) * (i + 1)) / columns,
            ),
          ]
    )
      .sort((a, b) => a - b)
      .filter((x, i, all) => i === 0 || x - all[i - 1]! > 1e-9);
    const current: number[] = [];
    for (const x of xs) {
      current.push(positions.length / 3);
      positions.push(x, height, z);
      normals.push(0, up ? 1 : -1, 0);
      const area = product.printableArea;
      uvs.push(
        up ? ((x + w / 2) * 1000 - area.xMm) / area.widthMm : (x + w / 2) / w,
        up ? 1 - ((h / 2 + z) * 1000 - area.yMm) / area.heightMm : (-z + h / 2) / h,
      );
    }
    rowIndices.push(current);
    if (row === 0) continue;
    const previous = rowIndices[row - 1]!;
    let i = 0,
      j = 0;
    const triangle = (a: number, b: number, c: number) =>
      up ? indices.push(a, b, c) : indices.push(a, c, b);
    while (i < previous.length - 1 || j < current.length - 1) {
      if (
        j === current.length - 1 ||
        (i < previous.length - 1 &&
          positions[previous[i + 1]! * 3]! <= positions[current[j + 1]! * 3]!)
      ) {
        triangle(previous[i]!, current[j]!, previous[i + 1]!);
        i++;
      } else {
        triangle(previous[i]!, current[j]!, current[j + 1]!);
        j++;
      }
    }
  }
}

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
  let perimeter = sampled.filter(
    (point, i) => i === 0 || point.distanceToSquared(sampled[i - 1]!) > 1e-20,
  );
  if (perimeter[0]!.distanceToSquared(perimeter[perimeter.length - 1]!) < 1e-20) perimeter.pop();
  perimeter = subdivideBendPerimeter(perimeter);
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
  const bottomOutline = Array.from({ length: count }, (_, i) => ({
    x: positions[i * 3]!,
    z: positions[i * 3 + 2]!,
  }));
  const topOutline = Array.from({ length: count }, (_, i) => ({
    x: positions[((rings.length - 1) * count + i) * 3]!,
    z: positions[((rings.length - 1) * count + i) * 3 + 2]!,
  }));
  appendCap(bottomOutline, 0, false, product, positions, normals, uvs, indices);
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
  appendCap(topOutline, t, true, product, topPositions, topNormals, topUvs, topIndices);
  top.setAttribute('position', new Float32BufferAttribute(topPositions, 3));
  top.setAttribute('normal', new Float32BufferAttribute(topNormals, 3));
  top.setAttribute('uv', new Float32BufferAttribute(topUvs, 2));
  top.setIndex(topIndices);
  top.computeBoundingBox();
  top.computeBoundingSphere();
  return { body, top };
}
