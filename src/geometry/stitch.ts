import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Matrix4,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProductDefinition } from '../contracts';
import { roundedRectangle, subdivideBendPerimeter } from './mat';
import { validateProduct } from '../products';

export const STITCH_PITCH_M = 0.00062;

/** Closed, padded overlock cross-section. Coordinates are outward / height / tangent. */
function bindingProfile(t: number, pitch: number, thread: boolean) {
  const topLift = thread ? 0.00032 : 0.00021;
  const side = thread ? -0.00015 : -0.00021;
  const under = thread ? -0.00012 : -0.00004;
  const points = [
    [-0.0027, t + 0.000025],
    [-0.0022, t + topLift * 0.8],
    [-0.00125, t + topLift],
    [-0.0004, t + topLift * 0.65],
    [side, t - Math.min(t * 0.15, 0.00032)],
    [side, Math.min(t * 0.15, 0.00032)],
    [-0.0004, under * 0.5],
    [-0.00135, under],
    [-0.00245, under * 0.5],
    [-0.0027, 0.00008],
    [-0.0027, t * 0.5],
  ].map(([d, y], i, all) => {
    const phase = (i / all.length) * Math.PI * 2;
    // Diagonal looper travel is visible across the top and around the side.
    const along = thread ? pitch * (0.72 * Math.sin(phase) + 0.24 * Math.sin(phase * 2)) : 0;
    return new Vector3(d!, y!, along);
  });
  return new CatmullRomCurve3(points, true, 'centripetal');
}

/** Rounded perimeter sampled by exact arclength: stitch spacing stays constant at corners. */
function perimeterSampler(w: number, h: number, r: number) {
  const horizontal = w - 2 * r;
  const vertical = h - 2 * r;
  const arc = (Math.PI * r) / 2;
  const lengths = [horizontal, arc, vertical, arc, horizontal, arc, vertical, arc];
  const total = lengths.reduce((a, b) => a + b, 0);
  return {
    total,
    sample(distance: number) {
      let s = ((distance % total) + total) % total;
      let segment = 0;
      while (segment < 7 && s > lengths[segment]!) s -= lengths[segment++]!;
      const f = lengths[segment]! > 0 ? s / lengths[segment]! : 0;
      let x: number, y: number, nx: number, ny: number;
      if (segment % 2 === 0) {
        const side = segment / 2;
        [x, y, nx, ny] = [
          [-w / 2 + r + s, -h / 2, 0, -1],
          [w / 2, -h / 2 + r + s, 1, 0],
          [w / 2 - r - s, h / 2, 0, 1],
          [-w / 2, h / 2 - r - s, -1, 0],
        ][side]! as [number, number, number, number];
      } else {
        const corner = (segment - 1) / 2;
        const angle = -Math.PI / 2 + ((corner + f) * Math.PI) / 2;
        const center = [
          [w / 2 - r, -h / 2 + r],
          [w / 2 - r, h / 2 - r],
          [-w / 2 + r, h / 2 - r],
          [-w / 2 + r, -h / 2 + r],
        ][corner]!;
        nx = Math.cos(angle);
        ny = Math.sin(angle);
        x = center[0]! + r * nx;
        y = center[1]! + r * ny;
      }
      return { point: new Vector3(x, 0, -y), outward: new Vector3(nx, 0, -ny) };
    },
  };
}

/** Full wrap binding plus a shared interlocking yarn mesh for GPU instancing at close range. */
export function createStitchedGeometry(product: ProductDefinition, thicknessMm: number) {
  validateProduct({ ...product, thicknessMm });
  const w = product.widthMm / 1000,
    h = product.heightMm / 1000,
    t = thicknessMm / 1000;
  const r = Math.min(product.cornerRadiusMm / 1000, w / 2, h / 2);
  const sampler = perimeterSampler(w, h, r);
  const perimeterM = sampler.total;
  const stitchCount = Math.max(1, Math.round(perimeterM / STITCH_PITCH_M));
  const pitch = perimeterM / stitchCount;
  const core = bindingProfile(t, pitch, false);
  const raw = roundedRectangle(w, h, r).getPoints(8);
  let points = raw.filter((p, i) => i === 0 || p.distanceToSquared(raw[i - 1]!) > 1e-18);
  if (points[0]!.distanceToSquared(points.at(-1)!) < 1e-18) points.pop();
  points = subdivideBendPerimeter(points);
  const distances = [0];
  for (let i = 1; i <= points.length; i++) {
    distances.push(distances[i - 1]! + points[i % points.length]!.distanceTo(points[i - 1]!));
  }
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const crossSegments = 24;
  for (let i = 0; i <= points.length; i++) {
    const p = points[i % points.length]!;
    const nx = p.x - Math.max(-w / 2 + r, Math.min(w / 2 - r, p.x));
    const ny = p.y - Math.max(-h / 2 + r, Math.min(h / 2 - r, p.y));
    const outward = new Vector3(nx, 0, -ny).normalize();
    if (outward.lengthSq() === 0) outward.set(Math.sign(p.x), 0, -Math.sign(p.y)).normalize();
    for (let j = 0; j <= crossSegments; j++) {
      const c = core.getPoint(j / crossSegments);
      positions.push(p.x + outward.x * c.x, c.y, -p.y + outward.z * c.x);
      uv.push(distances[i]! / distances.at(-1)!, j / crossSegments);
      if (i < points.length && j < crossSegments) {
        const a = i * (crossSegments + 1) + j;
        const b = a + crossSegments + 1;
        indices.push(a, b + 1, b, a, a + 1, b + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const wrap = new TubeGeometry(bindingProfile(t, pitch, true), 24, 0.00016, 5, true);
  const chainPoints = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    return new Vector3(
      -0.00262 + 0.00017 * Math.cos(angle),
      t + 0.0001 + 0.000055 * Math.sin(angle * 2),
      pitch * 0.57 * Math.sin(angle),
    );
  });
  const chain = new TubeGeometry(new CatmullRomCurve3(chainPoints, true), 12, 0.000067, 4, true);
  const threadGeometry = mergeGeometries([wrap, chain]);
  wrap.dispose();
  chain.dispose();
  if (!threadGeometry) {
    geometry.dispose();
    throw new Error('Could not build overlock yarn.');
  }
  const matrices = new Float32Array(stitchCount * 16);
  const colors = new Float32Array(stitchCount * 3);
  const matrix = new Matrix4(),
    up = new Vector3(0, 1, 0);
  for (let i = 0; i < stitchCount; i++) {
    const variation = Math.sin(i * 2.399963);
    const { point, outward } = sampler.sample((i + 0.035 * variation) * pitch);
    const tangent = new Vector3(-outward.z, 0, outward.x);
    // Small fixed manufacturing variation; the attachment height stays unchanged.
    outward.multiplyScalar(1 + 0.015 * variation);
    tangent.multiplyScalar(1 + 0.025 * Math.sin(i * 1.73205));
    matrix
      .makeBasis(outward, up, tangent)
      .setPosition(point)
      .toArray(matrices, i * 16);
    const shade = 0.83 + 0.17 * (0.5 + 0.5 * Math.sin(i * 2.399963));
    colors.set([shade, shade, shade], i * 3);
  }
  return { geometry, threadGeometry, matrices, colors, stitchCount, perimeterM };
}
