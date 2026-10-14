import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  ShapeUtils,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProductDefinition } from '../contracts';
import { createCatalogAccessory } from './catalogAccessories.ts';
import { referenceFold } from './referenceFolds.ts';

type Point = [number, number];
type Surface = (x: number, y: number) => Vector3;
export interface CatalogGeometry {
  front: BufferGeometry;
  back?: BufferGeometry;
  details: BufferGeometry;
  lining?: BufferGeometry;
  ribbing?: BufferGeometry;
  /** Dark woven neck tape and size label, rendered with its own material. */
  trim?: BufferGeometry;
}
const TAU = Math.PI * 2;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, w: number) => Math.exp(-((x / w) ** 2));
const v3 = (p: number[]) => new Vector3(p[0]!, p[1]!, p[2]!);

function mesh(p: number[], uv: number[], ix: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

function combine(parts: BufferGeometry[]) {
  if (!parts.length) return mesh([], [], []);
  const g = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return g;
}

function reverse(g: BufferGeometry) {
  const ix = g.index!,
    n = g.getAttribute('normal');
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i);
    ix.setX(i, ix.getX(i + 2));
    ix.setX(i + 2, a);
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

function inside(g: BufferGeometry, thickness = 0.001) {
  const result = g.clone(),
    p = result.getAttribute('position'),
    n = result.getAttribute('normal');
  for (let i = 0; i < p.count; i++)
    p.setXYZ(
      i,
      p.getX(i) - n.getX(i) * thickness,
      p.getY(i) - n.getY(i) * thickness,
      p.getZ(i) - n.getZ(i) * thickness,
    );
  return reverse(result);
}

function grid(
  nu: number,
  nv: number,
  at: (u: number, v: number) => Vector3,
  uvAt: (p: Vector3, u: number, v: number) => number[] = (_p, u, v) => [u, v],
  flip = false,
) {
  const p: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu,
        v = j / nv,
        a = at(u, v);
      p.push(a.x, a.y, a.z);
      uv.push(...uvAt(a, u, v));
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i,
        b = a + 1,
        c = a + nu + 1,
        d = c + 1;
      ix.push(a, b, c, b, d, c);
    }
  const result = mesh(p, uv, ix);
  return flip ? reverse(result) : result;
}

function curve(points: number[][], count: number, closed = false) {
  return new CatmullRomCurve3(points.map(v3), closed, 'centripetal').getPoints(count);
}

function line(points: Vector3[], radius = 0.00045, segments = 96, closed = false) {
  return new TubeGeometry(
    new CatmullRomCurve3(points, closed, 'centripetal'),
    segments,
    radius,
    5,
    closed,
  );
}

function sample2(points: Point[], count: number) {
  return curve(
    points.map(([x, y]) => [x, y, 0]),
    count,
  ).map((p) => new Vector2(p.x, p.y));
}

/** Clip a regular cloth grid against the sewn contour. This avoids skinny earcut
 * fans while preserving each curved boundary and the exact physical print UVs. */
function tessellate(outline: Vector2[], spacing = 0.007) {
  const points: Vector2[] = [],
    ix: number[] = [],
    vertices = new Map<string, number>();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const nx = Math.ceil((maxX - minX) / spacing),
    ny = Math.ceil((maxY - minY) / spacing);
  const dx = (maxX - minX) / nx,
    dy = (maxY - minY) / ny;
  const clip = (poly: Vector2[], axis: 'x' | 'y', value: number, above: boolean) => {
    const result: Vector2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!,
        b = poly[(i + 1) % poly.length]!;
      const ain = above ? a[axis] >= value - 1e-12 : a[axis] <= value + 1e-12;
      const bin = above ? b[axis] >= value - 1e-12 : b[axis] <= value + 1e-12;
      if (ain) result.push(a);
      if (ain !== bin) result.push(a.clone().lerp(b, (value - a[axis]) / (b[axis] - a[axis])));
    }
    return result;
  };
  for (let row = 0; row < ny; row++)
    for (let col = 0; col < nx; col++) {
      const x = minX + col * dx,
        y = minY + row * dy;
      let poly = clip(outline, 'x', x, true);
      poly = clip(poly, 'x', x + dx, false);
      poly = clip(poly, 'y', y, true);
      poly = clip(poly, 'y', y + dy, false);
      const clean: Vector2[] = [];
      for (const p of poly)
        if (!clean.length || p.distanceToSquared(clean.at(-1)!) > 1e-18) clean.push(p);
      if (clean.length > 1 && clean[0]!.distanceToSquared(clean.at(-1)!) < 1e-18) clean.pop();
      if (clean.length < 3 || Math.abs(ShapeUtils.area(clean)) < 1e-13) continue;
      const local = clean.map((p) => {
        const key = `${Math.round(p.x * 1e10)}:${Math.round(p.y * 1e10)}`;
        let id = vertices.get(key);
        if (id === undefined) {
          id = points.length;
          points.push(p);
          vertices.set(key, id);
        }
        return id;
      });
      for (const tri of ShapeUtils.triangulateShape(clean, []))
        ix.push(...tri.map((i) => local[i]!));
    }
  return { points, ix };
}
function distance(x: number, y: number, lines: Vector2[][]) {
  const distances: number[] = [];
  for (const line of lines) {
    let min = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!,
        b = line[i]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy));
      min = Math.min(min, (x - a.x - dx * t) ** 2 + (y - a.y - dy * t) ** 2);
    }
    distances.push(Math.sqrt(min));
  }
  let rounded = distances[0]!;
  for (const d of distances.slice(1)) {
    const blend = Math.max(0.04 - Math.abs(rounded - d), 0) / 0.04;
    rounded = Math.min(rounded, d) - blend * blend * 0.01;
  }
  return Math.max(0, rounded);
}

function seamNormal(x: number, y: number, lines: Vector2[][]) {
  let best = Infinity;
  const normal = new Vector3();
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!,
        b = line[i]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy));
      const d = (x - a.x - dx * t) ** 2 + (y - a.y - dy * t) ** 2;
      if (d < best) {
        best = d;
        const mirror = line[0]!.x < 0 ? -1 : 1;
        normal.set(mirror * dy, -mirror * dx, 0).normalize();
      }
    }
  return normal;
}

function refineSeams(points: Vector2[], initial: number[], sewn: Vector2[][]) {
  let ix = initial;
  const distances = points.map((p) => distance(p.x, p.y, sewn));
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let pass = 0; pass < 3; pass++) {
    const split = new Map<string, number>();
    for (let i = 0; i < ix.length; i += 3)
      for (let e = 0; e < 3; e++) {
        const a = ix[i + e]!,
          b = ix[i + ((e + 1) % 3)]!,
          k = key(a, b);
        if (
          Math.min(distances[a]!, distances[b]!) < 0.013 &&
          points[a]!.distanceToSquared(points[b]!) > 0.0017 ** 2 &&
          !split.has(k)
        ) {
          const p = points[a]!.clone().lerp(points[b]!, 0.5);
          split.set(k, points.length);
          points.push(p);
          distances.push(distance(p.x, p.y, sewn));
        }
      }
    if (!split.size) break;
    const next: number[] = [];
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i]!,
        b = ix[i + 1]!,
        c = ix[i + 2]!;
      const ab = split.get(key(a, b)),
        bc = split.get(key(b, c)),
        ca = split.get(key(c, a));
      if (ab !== undefined && bc !== undefined && ca !== undefined)
        next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (ab !== undefined && bc !== undefined) next.push(a, ab, c, ab, bc, c, ab, b, bc);
      else if (bc !== undefined && ca !== undefined) next.push(b, bc, a, bc, ca, a, bc, c, ca);
      else if (ca !== undefined && ab !== undefined) next.push(c, ca, b, ca, ab, b, ca, a, ab);
      else if (ab !== undefined) next.push(a, ab, c, ab, b, c);
      else if (bc !== undefined) next.push(b, bc, a, bc, c, a);
      else if (ca !== undefined) next.push(c, ca, b, ca, a, b);
      else next.push(a, b, c);
    }
    ix = next;
  }
  return ix;
}

function panel(
  outline: Vector2[],
  at: Surface,
  product: ProductDefinition,
  sign: number,
  spacing = 0.018,
  sewn?: Vector2[][],
) {
  const { points, ix: baseIndices } = tessellate(outline, spacing);
  const ix = sewn ? refineSeams(points, baseIndices, sewn) : baseIndices;
  const p: number[] = [],
    uv: number[] = [];
  for (const a of points) {
    p.push(...at(a.x, a.y).toArray());
    uv.push(0.5 + (sign * a.x) / (product.widthMm / 1000), a.y / (product.heightMm / 1000));
  }
  // Earcut's triangles face +Z independently of input contour winding.
  const g = mesh(p, uv, ix);
  if (sign < 0) reverse(g);
  // Analytic surface normals make shading independent of earcut's narrow fans.
  // This is essential for soft cloth around the concave armhole and curved hem.
  const normals = g.getAttribute('normal');
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!,
      e = 0.00004;
    const n =
      sewn && distance(p.x, p.y, sewn) < 0.00001
        ? seamNormal(p.x, p.y, sewn)
        : at(p.x + e, p.y)
            .sub(at(p.x - e, p.y))
            .cross(at(p.x, p.y + e).sub(at(p.x, p.y - e)))
            .normalize()
            .multiplyScalar(sign);
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function sewnButton() {
  const circle = (x: number, y: number, radius: number, count: number) =>
    Array.from({ length: count }, (_, i) => new Vector2(x + radius * Math.cos(i / count * TAU), y + radius * Math.sin(i / count * TAU)));
  const outline = circle(0, 0, 0.0041, 48);
  const holes = [-1, 1].flatMap((x) => [-1, 1].map((y) => circle(x * 0.0012, y * 0.0012, 0.00057, 16).reverse()));
  const all = [...outline, ...holes.flat()];
  const indices = ShapeUtils.triangulateShape(outline, holes).flat();
  const face = mesh(all.flatMap((p) => [p.x, p.y, 0.0012]), all.flatMap((p) => [0.5 + p.x / 0.0082, 0.5 + p.y / 0.0082]), indices);
  const rear = reverse(face.clone());
  rear.translate(0, 0, -0.0012);
  const walls = [outline, ...holes].map((ring) => {
    const p: number[] = [], uv: number[] = [], ix: number[] = [];
    for (let i = 0; i <= ring.length; i++) {
      const a = ring[i % ring.length]!;
      p.push(a.x, a.y, 0, a.x, a.y, 0.0012);
      uv.push(i / ring.length, 0, i / ring.length, 1);
      if (i < ring.length) ix.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    return mesh(p, uv, ix);
  });
  return combine([face, rear, ...walls]);
}

// These separate blank patterns are traced from the user's alpha PNGs. A
// uniform scale keeps the photographed body/sleeve lengths and shoulder slope;
// widthMm remains the physical UV canvas, not the hanging garment width.
const REFERENCE_PATTERNS: Record<string, {
  axis: number; bottom: number; height: number; neck: Point; frontDrop: number; backDrop: number;
  lower: Point[]; upper: Point[]; seam: Point[]; hemBand: number; cuffBand: number;
}> = {
  sweatshirt: {
    axis: 347, bottom: 662, height: 621, neck: [423, 53], frontDrop: 32, backDrop: -10,
    lower: [[497,619],[500,592],[501,570],[501,536],[500,497],[500,455],[500,421],[502,399],[506,391],[510,412],[515,455],[519,500],[523,540],[521,581],[522,610],[519,657]],
    upper: [[590,662],[596,633],[603,616],[608,579],[611,531],[611,482],[611,431],[608,381],[605,340],[601,291],[598,246],[596,202],[593,170],[584,143],[575,128],[554,113],[522,99],[486,86],[452,73],[423,53]],
    seam: [[593,170],[552,188],[547,245],[531,317],[506,391]], hemBand: 49, cuffBand: 47,
  },
  longsleeve: {
    axis: 350, bottom: 683, height: 659, neck: [432,29], frontDrop: 41, backDrop: -3,
    lower: [[504,624],[504,580],[504,539],[503,500],[501,460],[499,420],[498,380],[497,340],[496,300],[498,266],[503,246],[506,238],[511,251],[517,274],[522,303],[529,326],[535,352],[541,382],[545,424],[548,462],[552,505],[557,546],[562,585],[567,622],[571,660],[574,681]],
    upper: [[637,683],[635,663],[634,628],[634,585],[633,543],[635,503],[636,462],[635,423],[632,381],[628,342],[624,307],[620,278],[616,248],[611,223],[603,188],[596,157],[587,128],[575,106],[559,89],[533,74],[500,59],[466,44],[432,29]],
    seam: [[559,89],[548,127],[532,174],[519,215],[506,238]], hemBand: 20, cuffBand: 21,
  },
  // Traced from 05_Поло_белый.png (1000 × 1000): set-in short sleeves with a
  // slanted rib cuff, straight body and a placket below the folded collar.
  polo: {
    axis: 500, bottom: 955, height: 855, neck: [600,110], frontDrop: 112, backDrop: -4,
    lower: [[728,950],[729,905],[728,850],[727,780],[726,700],[725,620],[725,540],[725,475],[726,438],[729,414]],
    upper: [[858,399],[861,372],[858,333],[851,293],[839,252],[823,216],[801,187],[776,166],[748,152],[718,142],[686,131],[652,121],[622,114],[600,110]],
    seam: [[748,152],[740,200],[733,260],[728,330],[729,414]], hemBand: 17, cuffBand: 28,
  },
  hoodie: {
    axis: 500, bottom: 970, height: 934, neck: [614,150], frontDrop: 22, backDrop: 15,
    lower: [[690,849],[692,824],[699,785],[703,740],[705,690],[706,630],[708,560],[707,504],[709,487],[711,502],[718,541],[724,579],[729,630],[734,698],[738,770],[744,832],[751,895],[758,970]],
    upper: [[834,970],[842,937],[849,900],[860,860],[864,805],[866,744],[864,689],[861,626],[857,560],[851,492],[843,439],[834,389],[823,338],[814,300],[800,261],[783,223],[766,199],[748,188],[705,167],[664,149],[614,150]],
    seam: [[748,188],[720,231],[708,303],[706,397],[709,487]], hemBand: 65, cuffBand: 75,
  },
};

function clothing(product: ProductDefinition, kind: string): CatalogGeometry {
  const reference = REFERENCE_PATTERNS[kind];
  const scale = reference ? product.heightMm / 1000 / reference.height : 1;
  const fromPhoto = ([x, y]: Point): Point => reference ? [(x - reference.axis) * scale, (reference.bottom - y) * scale] : [x, y];
  const hoodie = kind === 'hoodie',
    polo = kind === 'polo',
    ribbed = hoodie || kind === 'sweatshirt';
  const hemY = reference ? fromPhoto(reference.lower[0]!)[1] : hoodie ? 0.085 : 0.035,
    topY = reference ? fromPhoto(reference.neck)[1] : hoodie ? 0.69 : 0.707;
  const half = reference ? fromPhoto(reference.lower[0]!)[0] : kind === 'longsleeve' ? 0.244 : polo ? 0.25 : 0.276;
  const neckRadius = reference ? fromPhoto(reference.neck)[0] : 0.095;
  const frontNeckDrop = reference ? reference.frontDrop * scale : polo ? 0.085 : hoodie ? 0.05 : 0.072;
  const backNeckDrop = reference ? reference.backDrop * scale : 0.032;
  // The UV canvas includes the unfolded sleeve span; the hanging silhouette
  // is much narrower. Keep physical print UVs tied to product.widthMm below.
  const maxX = reference ? fromPhoto(reference.upper[0]!)[0] : polo ? product.widthMm / 2000 - 0.012 : hoodie ? 0.4 : kind === 'sweatshirt' ? 0.383 : 0.375;
  const innerCuff: Point = reference ? fromPhoto(reference.lower.at(-1)!) : polo ? [maxX - 0.045, 0.425] : [maxX - 0.085, 0.044];
  const outerCuff: Point = reference ? fromPhoto(reference.upper[0]!) : polo ? [maxX, 0.544] : [maxX, 0.037];
  const lower = sample2(
    reference ? reference.lower.map(fromPhoto) : polo
      ? [[half, hemY], [half - 0.008, 0.27], [half - 0.008, 0.445], [half + 0.031, 0.435], innerCuff]
      : [[half, hemY], [half - 0.008, 0.27], [half - 0.008, 0.445], [half + 0.026, 0.432], [half + 0.031, 0.35], [innerCuff[0] - 0.004, 0.19], innerCuff],
    80,
  );
  const upper = sample2(
    reference ? reference.upper.map(fromPhoto) : [
      outerCuff,
      // Both sleeve boundaries must move together. The outside of a hanging
      // upper arm stays outside the cuff, then narrows gently at the wrist;
      // pulling this point inward creates a pinched hourglass at the axilla.
      ...(polo ? [[0.355, 0.615] as Point] : [[maxX + 0.009, 0.27], [maxX + 0.012, 0.475], [half + 0.105, 0.59]] as Point[]),
      [half + 0.042, 0.632],
      [half - 0.021, 0.659],
      [0.095, topY],
    ],
    96,
  );
  const mirror = (p: Vector2) => new Vector2(-p.x, p.y);
  const sewn = [lower, upper, lower.map(mirror), upper.map(mirror)];
  const details: BufferGeometry[] = [],
    ribs: BufferGeometry[] = [],
    linings: BufferGeometry[] = [];
  const panels: BufferGeometry[] = [];
  const surfaces: Surface[] = [];
  const openingLoops: Vector3[][][] = [[], []];
  const armpitY = reference ? Math.max(...lower.map((p) => p.y)) : 0.445;
  const hemRibTop = hemY + (reference ? reference.hemBand * scale : 0.055);
  const cuffRibTop = reference ? reference.cuffBand * scale : 0.062;
  const shortFold = (x: number, y: number, cx: number, cy: number, slope: number, width: number, length: number, amplitude: number) => {
    const across = x - cx - (y - cy) * slope;
    return amplitude * (bell(across, width) - 0.42 * bell(across + width * 1.8, width * 1.4)) * bell(y - cy, length);
  };
  for (const sign of [1, -1]) {
    const neck = Array.from({ length: 33 }, (_, i) => {
      const a = (Math.PI * i) / 32;
      return new Vector2(
        neckRadius * Math.cos(a),
        topY - (sign > 0 ? frontNeckDrop : backNeckDrop) * Math.sin(a),
      );
    });
    const hem = Array.from(
      { length: 25 },
      (_, i) => new Vector2(-half + (2 * half * i) / 24, hemY),
    );
    const cuff = Array.from({ length: 9 }, (_, i) =>
      new Vector2(...innerCuff).lerp(new Vector2(...outerCuff), i / 8),
    );
    const outline = [
      ...hem,
      ...lower.slice(1),
      ...cuff.slice(1),
      ...upper.slice(1),
      ...neck.slice(1),
      ...upper.slice(0, -1).reverse().map(mirror),
      ...cuff.slice(0, -1).reverse().map(mirror),
      ...lower.slice(0, -1).reverse().map(mirror),
    ];
    const at: Surface = (x, y) => {
      const d = distance(x, y, sewn),
        ax = Math.abs(x);
      const rounding = reference ? kind === 'longsleeve' ? 0.011 : polo ? 0.014 : 0.018 : 0.032;
      const edgeRound = Math.sqrt(1 - Math.exp(-0.00035 / rounding));
      const radial =
        (Math.sqrt(1 - Math.exp(-(d + 0.00035) / rounding)) - edgeRound) / (1 - edgeRound);
      // Empty laid-out cloth is shallow, unlike the old inflated torso. Soft
      // asymmetric folds carry most of the relief rather than body volume.
      const chest = reference ? kind === 'longsleeve' ? 0.013 : polo ? 0.02 : hoodie ? 0.024 : 0.027 : ribbed ? 0.066 : 0.053;
      const volume = chest * (reference ? 1 - (kind === 'longsleeve' ? 0.28 : polo ? 0.38 : 0.24) * smooth(half - 0.015, half + 0.085, ax) : 1 - 0.2 * smooth(0.21, 0.42, ax));
      const oldFolds =
        0.005 * Math.sin(x * 49 + y * 3 + (sign < 0 ? 1.7 : 0)) * bell(y - hemY - 0.07, 0.15) +
        0.003 *
          Math.sin(ax * 42 + y * 35 + (x < 0 ? 1.3 : -0.8)) *
          bell(y - 0.4, 0.12) *
          smooth(0.13, 0.3, ax) +
        0.0025 * Math.sin(x * 25 - y * 14 + sign) * bell(x - 0.08, 0.17) +
        (0.0032 * Math.sin(y * 37 + x * 19 + sign) * bell(y - (x < 0 ? 0.21 : 0.31), 0.14) +
          0.0018 * Math.sin(y * 61 - x * 16) * bell(y - (x < 0 ? 0.36 : 0.16), 0.07)) *
          smooth(0.29, 0.37, ax);
      // Short independently placed folds replace the former pair of full-height
      // ribs. Their ends die out, and the back does not repeat the front.
      const sideCrease =
        shortFold(x, y, -half + 0.024, hemRibTop + (sign > 0 ? 0.046 : 0.085), -0.16, 0.012, 0.055, 0.0028) +
        shortFold(x, y, half - 0.022, hemRibTop + (sign > 0 ? 0.105 : 0.041), 0.19, 0.014, 0.046, 0.0024) +
        shortFold(x, y, -half + 0.043, armpitY + 0.041, -0.38, 0.016, 0.052, 0.002) +
        shortFold(x, y, half - 0.047, armpitY + (sign > 0 ? 0.023 : 0.07), 0.29, 0.018, 0.057, 0.0018);
      const cuffWindow = smooth(0.025, 0.07, y) * (1 - smooth(0.16, 0.25, y));
      const sleeveCentre = (innerCuff[0] + outerCuff[0]) * 0.5;
      const sleeveFold = smooth(half + 0.016, half + 0.04, ax) * (
        0.004 * bell(y - 0.11 + (ax - sleeveCentre) * (x < 0 ? 0.9 : -0.65), 0.022) * cuffWindow
        - 0.0018 * bell(ax - sleeveCentre - 0.009 * Math.sin(y * 9 + sign), 0.015) * bell(y - (x < 0 ? 0.35 : 0.27), 0.11)
        + 0.0024 * bell(y - 0.4 - (ax - sleeveCentre) * 0.8, 0.035));
      const torsoMask = 1 - smooth(half - 0.005, half + 0.025, ax);
      const hemBlouse = ribbed ? torsoMask * (
        0.0032 * bell(y - hemRibTop - 0.018, 0.025) * (0.4 + 0.35 * bell(x + 0.085, 0.05) + 0.5 * bell(x - 0.048, 0.04)) -
        0.0012 * bell(y - hemRibTop + 0.002, 0.009)) : 0;
      const cuffBlouse = ribbed ? 0.0038 * bell(y - cuffRibTop - 0.019 - (x < 0 ? 0.006 : 0), 0.023) * bell(ax - sleeveCentre, 0.031) : 0;
      const photoRelief = reference && sign > 0 ? referenceFold(
        kind,
        reference.axis + x / scale,
        reference.bottom - y / scale,
      ) * (kind === 'longsleeve' ? 0.65 : 1) : 0;
      // The supplied photos determine the locations and asymmetry of the fine
      // folds. Their signed depth is bounded, authored relief rather than a
      // claim that a single lit photo supplies a physical 3D scan. The broad
      // seam-compression forms below support those cues without inflating arms.
      const rearDrape = sign < 0 ? (
        shortFold(x, y, -half + 0.029, armpitY + 0.028, -0.32, 0.012, 0.065, 0.0032) +
        shortFold(x, y, half - 0.037, armpitY - 0.036, 0.24, 0.016, 0.078, 0.0028) +
        shortFold(x, y, -half + 0.054, hemRibTop + 0.09, 0.23, 0.014, 0.06, 0.0031) +
        shortFold(x, y, half - 0.071, hemRibTop + 0.037, -0.28, 0.019, 0.046, 0.0037) +
        smooth(half + 0.035, half + 0.06, ax) * (
          0.0045 * bell(y - (x < 0 ? 0.30 : 0.36) + (ax - sleeveCentre) * 0.75, 0.025) -
          0.0025 * bell(y - (x < 0 ? 0.26 : 0.32) + (ax - sleeveCentre) * 0.65, 0.021) +
          0.0032 * bell(y - cuffRibTop - 0.028 - (ax - sleeveCentre) * 0.9, 0.018)
        )
      ) * (kind === 'longsleeve' ? 0.6 : 1) : 0;
      // Piqué polo: few, soft drag lines from the armholes and a crease above
      // each slanted rib cuff, as in the supplied photograph.
      const sleeveMask = smooth(half + 0.008, half + 0.03, ax);
      const poloFolds = polo && reference ? (
        shortFold(x, y, -(half - 0.032), armpitY - 0.035, 0.55, 0.011, 0.05, 0.0021) +
        shortFold(x, y, half - 0.036, armpitY - (sign > 0 ? 0.05 : 0.025), -0.5, 0.012, 0.045, 0.0018) +
        shortFold(x, y, -0.072, hemY + 0.19, 0.05, 0.02, 0.11, 0.0013 * sign) +
        sleeveMask * (
          0.0024 * bell(y - innerCuff[1] - cuffRibTop - 0.022 + (ax - sleeveCentre) * 0.28, 0.011) -
          0.0012 * bell(y - armpitY - 0.07 + (ax - sleeveCentre) * 0.9, 0.02) * (x < 0 ? 1 : 0.6))
      ) : 0;
      const folds = reference ? polo ? poloFolds + rearDrape * 0.6 + sideCrease * 0.3 :
        photoRelief + rearDrape + sideCrease * 0.45 + sleeveFold * 0.35 + hemBlouse + cuffBlouse : oldFolds;
      // Short side vents open the hem at both side seams.
      const vent = polo && reference ? (1 - smooth(hemY + 0.02, hemY + 0.034, y)) * smooth(half - 0.014, half - 0.002, ax) : 0;
      const hemGather = ribbed && !reference
        ? 1 -
          0.055 * (1 - smooth(hemY, hemY + 0.06, y)) * (1 - smooth(half - 0.02, half + 0.01, ax))
        : 1;
      const cuffGather = polo || reference ? 0 : (1 - smooth(0.042, 0.105, y)) * smooth(0.3, 0.38, ax);
      const cuffCentre = Math.sign(x) * (maxX - 0.0425);
      return new Vector3(
        (x + (cuffCentre - x) * cuffGather * 0.12) * hemGather,
        y + 0.002 * Math.sin(x * 28) * bell(y - hemY, 0.06),
        sign * ((volume * radial + folds * smooth(0, 0.023, d)) * (1 - cuffGather * 0.22) + 0.0024 * vent),
      );
    };
    const g = panel(outline, at, product, sign, reference ? 0.0045 : 0.007, sewn);
    surfaces.push(at);
    // At sewn edges the front and rear panels join. Scale the liner inward
    // instead of offsetting sharp seam normals, which can create intersections.
    const liner = g.clone(),
      lp = liner.getAttribute('position');
    for (let i = 0; i < lp.count; i++) lp.setZ(i, lp.getZ(i) * 0.985);
    linings.push(reverse(liner));
    panels.push(g);
    const edgeBand = (path: Vector2[], width: number, direction: number) => {
      const points = path.map((p) => at(p.x, p.y));
      if (reference) openingLoops[sign > 0 ? 0 : 1]!.push(points);
      const path2 = new CatmullRomCurve3(
        path.map((p) => new Vector3(p.x, p.y, 0)),
        false,
        'centripetal',
      );
      const band = grid(
        64,
        6,
        (u, v) => {
          const a = path2.getPoint(u),
            tangent = path2.getTangent(u);
          const normal = new Vector3(-tangent.y, tangent.x, 0).normalize();
          const taper = smooth(0, 0.12, u) * (1 - smooth(0.88, 1, u));
          const b = a.clone().addScaledVector(normal, width * v * direction * taper);
          if (reference && path === hem) {
            const y = hemY + width * v;
            let sideX = half;
            for (let i = 1; i < lower.length; i++) {
              const p = lower[i - 1]!, q = lower[i]!;
              if (y >= Math.min(p.y, q.y) && y <= Math.max(p.y, q.y)) {
                sideX = p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y);
                break;
              }
            }
            b.set((u * 2 - 1) * sideX, y, 0);
          }
          if ((!polo || reference) && path !== hem) {
            // Cuffs form a continuous sleeve cross-section. Follow both sewn
            // sides at this height so the rib does not end in a raised wedge.
            const t = path[0]!.x < 0 ? 1 - u : u;
            const y = innerCuff[1] + (outerCuff[1] - innerCuff[1]) * t + width * v;
            const atHeight = (edge: Vector2[]) => {
              let result = -Infinity;
              for (let i = 1; i < edge.length; i++) {
                const p = edge[i - 1]!, q = edge[i]!;
                if (y >= Math.min(p.y, q.y) && y <= Math.max(p.y, q.y))
                  result = Math.max(result, p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y));
              }
              if (Number.isFinite(result)) return result;
              // Outside the traced range continue from the nearer end, e.g.
              // the outer cuff of a slanted short sleeve, not the neck point.
              const first = edge[0]!, last = edge.at(-1)!;
              return Math.abs(y - first.y) < Math.abs(y - last.y) ? first.x : last.x;
            };
            // Below the inner end of the slanted cuff there is no sleeve-side
            // intersection. The lower pattern also contains the torso side;
            // selecting that unrelated segment would stretch a flap to the body.
            const innerX = y < innerCuff[1] ? innerCuff[0] : atHeight(lower);
            const x = innerX * (1 - t) + atHeight(upper) * t;
            b.set(path[0]!.x < 0 ? -x : x, y, 0);
          }
          const source = at(b.x, b.y);
          const knit = ribbed || (polo && path !== hem);
          source.z += sign * (knit ? 0.0012 + (ribbed ? 0.0015 : 0.0007) * Math.sin(Math.PI * v) : 0.0008) * smooth(0, 0.006, distance(b.x, b.y, sewn));
          return source;
        },
        (_p, u, v) => reference && (ribbed || polo) ? [u * path2.getLength() / 0.0048, v * width / 0.004] : [u * 2, v],
        sign < 0,
      );
      (ribbed || (polo && path !== hem) ? ribs : details).push(band);
      // Rolled cloth edge joins the exterior to the liner at each real opening.
      if (!reference) details.push(
        line(
          points.map((p) => p.clone().add(new Vector3(0, 0, sign * 0.0002))),
          ribbed ? 0.0012 : 0.0008,
          96,
        ),
      );
      const innerStitch = path.map((p) => {
        const q = at(p.x, p.y + width * 0.9);
        return q.add(new Vector3(0, 0, sign * 0.0014));
      });
      if (path === hem) details.push(line(innerStitch, 0.00029, 96));
      if (polo && reference && path !== hem) {
        // Sleeve-to-cuff join, just above the knitted band.
        details.push(line(path.map((p) => at(p.x, p.y + width * 1.03).add(new Vector3(0, 0, sign * 0.0019))), 0.00026, 96));
      }
    };
    edgeBand(hem, reference ? reference.hemBand * scale : ribbed ? 0.055 : 0.012, 1);
    edgeBand(cuff, reference ? reference.cuffBand * scale : ribbed ? 0.062 : 0.013, 1);
    edgeBand(cuff.map(mirror).reverse(), reference ? reference.cuffBand * scale : ribbed ? 0.062 : 0.013, 1);
    if (polo && !reference) {
      details.push(
        line(
          neck.map((p) => at(p.x, p.y).add(new Vector3(0, 0, sign * 0.0008))),
          0.0014,
          96,
        ),
      );
    }
    // Fine seam lines follow the natural set-in sleeve, not a floating tube around the arm.
    for (const side of [-1, 1]) {
      const seam = reference ? sample2(reference.seam.map(fromPhoto), 48).map((p) =>
        at(side * p.x, p.y).add(new Vector3(0, 0, sign * 0.0006))) : Array.from({ length: 28 }, (_, i) => {
        const t = i / 27,
          x = side * (half - 0.008 + 0.036 * Math.sin(Math.PI * t));
        return at(x, 0.444 + t * 0.203).add(new Vector3(0, 0, sign * 0.0006));
      });
      details.push(line(seam, 0.00028, 48));
    }
    if (sign === 1 && hoodie) {
      const pocketOutline = sample2(
        reference ? [[365,515],[435,516],[540,516],[642,515],[651,565],[669,624],[686,692],[701,780],[626,786],[499,784],[372,785],[311,780],[329,699],[345,630],[357,565],[365,515]].map((p) => fromPhoto(p as Point)) : [
          [-0.205, 0.15],
          [-0.12, 0.149],
          [0, 0.146],
          [0.12, 0.149],
          [0.205, 0.15],
          [0.171, 0.218],
          [0.14, 0.323],
          [0.07, 0.325],
          [-0.07, 0.324],
          [-0.14, 0.323],
          [-0.171, 0.218],
          [-0.205, 0.15],
        ],
        55,
      ).slice(0, -1);
      const pocketAt: Surface = (x, y) => {
        const gather = reference ? smooth(0.161, 0.21, y) * (1 - smooth(0.375, 0.4, y)) : smooth(0.15, 0.2, y) * (1 - smooth(0.295, 0.325, y));
        const sideOpening = smooth(reference ? 0.12 : 0.095, reference ? 0.166 : 0.17, Math.abs(x));
        return at(x, y).add(
          new Vector3(
            0,
            0,
            0.001 +
              gather * (0.0025 + 0.0025 * sideOpening) +
              0.0009 * Math.sin(x * 29 + y * 8) * gather,
          ),
        );
      };
      const pocket = panel(pocketOutline, pocketAt, product, 1, reference ? 0.0045 : 0.015);
      details.push(pocket, inside(pocket, 0.001));
      details.push(
        line(
          pocketOutline.map((p) => pocketAt(p.x, p.y).add(new Vector3(0, 0, 0.0005))),
          0.00042,
          150,
          true,
        ),
      );
      for (const side of [-1, 1]) {
        const opening = reference ? sample2([[642,515],[651,565],[669,624],[686,692],[698,766]].map((p) => fromPhoto(p as Point)), 40).map((p) => pocketAt(side * p.x, p.y).add(new Vector3(0, 0, 0.0006))) : Array.from({ length: 40 }, (_, i) => {
          const y = 0.204 + (i / 39) * 0.11;
          const x = side * (0.178 - (y - 0.204) * 0.34);
          return pocketAt(x, y).add(new Vector3(0, 0, 0.0006));
        });
        details.push(line(opening, 0.0011, 64));
      }
    }
    if (polo && reference) {
      // Coverstitched vent edges and a small bar tack at the top of each vent.
      for (const side of [-1, 1]) {
        const ventTop = hemY + 0.032;
        details.push(line(Array.from({ length: 12 }, (_, i) => {
          const y = hemY + 0.001 + (ventTop - hemY - 0.001) * (i / 11);
          return at(side * (half - 0.006), y).add(new Vector3(0, 0, sign * 0.0009));
        }), 0.00026, 16));
        details.push(line([at(side * (half - 0.009), ventTop), at(side * (half - 0.001), ventTop)]
          .map((p) => p.add(new Vector3(0, 0, sign * 0.001))), 0.0005, 4));
      }
    }
    if (sign === 1 && polo && reference) {
      // Two-button placket: right panel over left with a stitched box and X at its base.
      const [, top] = fromPhoto([0, 222]), [, bottom] = fromPhoto([0, 300]);
      const pw = 22 * scale;
      const placketAt = (u: number, v: number) => {
        const x = (u * 2 - 1) * pw, y = bottom + (top - bottom) * v;
        const edge = Math.min(u, 1 - u, v * 3);
        return at(x, y).add(new Vector3(0, 0, 0.0004 + 0.0012 * smooth(0, 0.08, edge)));
      };
      details.push(grid(12, 30, placketAt, (_p, u, v) => [u * 2 * pw / 0.006, v * (top - bottom) / 0.006]));
      for (const u of [0.04, 0.96])
        details.push(line(Array.from({ length: 24 }, (_, i) => placketAt(u, i / 23).add(new Vector3(0, 0, 0.0004))), 0.00026, 32));
      const box = [[0.04, 0.02], [0.96, 0.02], [0.96, 0.2], [0.04, 0.2]].map(([u, v]) => placketAt(u!, v!).add(new Vector3(0, 0, 0.0005)));
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]])
        details.push(line([box[a!]!, box[a!]!.clone().lerp(box[b!]!, 0.5), box[b!]!], 0.00024, 8));
      // Overlap fold of the right-hand placket leaf.
      details.push(line(Array.from({ length: 24 }, (_, i) => placketAt(0.5, 0.2 + 0.8 * i / 23).add(new Vector3(0, 0, 0.0003))), 0.0002, 32));
      for (const py of [230, 268]) {
        const button = sewnButton();
        button.scale(1.25, 1.25, 1);
        const [, y] = fromPhoto([0, py]);
        const p = placketAt(0.5, (y - bottom) / (top - bottom));
        button.translate(p.x, p.y, p.z + 0.0009);
        details.push(button);
        for (const [dx, dy] of [[-0.0015, 1], [0.0015, 1], [-0.0015, -1], [0.0015, -1]])
          details.push(line([
            new Vector3(p.x + dx!, p.y + dy! * 0.0003, p.z + 0.0023),
            new Vector3(p.x + dx!, p.y + dy! * 0.0027, p.z + 0.0023),
          ], 0.00022, 3));
      }
    }
    if (sign === 1 && polo && !reference) {
      const placket = grid(5, 24, (u, v) =>
        at((u - 0.5) * 0.032, 0.526 + v * 0.105).add(new Vector3(0, 0, 0.0022)),
      );
      details.push(placket);
      for (const x of [-0.013, 0.013])
        details.push(
          line(
            Array.from({ length: 32 }, (_, i) =>
              at(x, 0.532 + (i / 31) * 0.094).add(new Vector3(0, 0, 0.0027)),
            ),
            0.00027,
            48,
          ),
        );
      for (const y of [0.552, 0.596, 0.628]) {
        const button = sewnButton();
        const p = at(0.001, y);
        button.translate(p.x, p.y, p.z + 0.0038);
        details.push(button);
        for (const dx of [-0.0012, 0.0012])
          details.push(
            line(
              [
                new Vector3(p.x + dx, p.y - 0.0012, p.z + 0.0053),
                new Vector3(p.x + dx, p.y + 0.0012, p.z + 0.0053),
              ],
              0.00021,
              3,
            ),
          );
      }
    }
  }
  if (reference) for (let i = 0; i < openingLoops[0]!.length; i++) {
    const front = openingLoops[0]![i]!, rear = openingLoops[1]![i]!;
    // One closed edge replaces two exposed tube caps at the sewn side joins.
    const perimeter = [...front, ...rear.slice(1, -1).reverse()];
    details.push(line(perimeter, kind === 'longsleeve' ? .0003 : .0004, 192, true));
  }
  if (hoodie) {
    // This is a sewn bag with two openings: its neck attachment and its front
    // entrance. Between them the rear panel rises, closes over a rounded crown,
    // and turns forward. The entrance is vertical, below the outer crown; it
    // must not be the highest edge of a bowl-shaped ruled surface.
    const hoodAt = (u: number, v: number) => {
      const a = u * TAU,
        facing = Math.cos(a),
        x = neckRadius * Math.sin(a);
      const y = topY - (facing >= 0 ? frontNeckDrop : backNeckDrop) * Math.abs(facing);
      const base = surfaces[facing >= 0 ? 0 : 1]!(x, y);
      const backWindow = smooth(0, 0.65, -facing);
      const frontWindow = smooth(0.05, 0.6, facing);
      const rim = new Vector3(
        0.116 * Math.sin(a) * (1 + 0.022 * Math.sin(a * 3 + 0.5)),
        0.762 - 0.034 * facing + 0.0018 * Math.sin(a * 2 + 0.3),
        0.048 + 0.0025 * Math.sin(a * 2 + 0.4),
      );
      // The collapsed bag rests on the shoulders: widest near its base and
      // narrowing towards the opening, not a ring on a narrow neck.
      const lower = new Vector3(
        0.172 * Math.sin(a),
        base.y + 0.044 * backWindow + 0.004 * (1 - Math.abs(facing)),
        -0.076 * backWindow + 0.060 * frontWindow - 0.009 * (1 - Math.abs(facing)),
      );
      const crown = new Vector3(
        0.146 * Math.sin(a),
        rim.y + 0.074 * backWindow + 0.023 * (1 - Math.abs(facing)) - 0.012 * frontWindow,
        -0.087 * backWindow + 0.069 * frontWindow + 0.007 * (1 - Math.abs(facing)),
      );
      const t = 1 - v;
      const result = base.multiplyScalar(t ** 3)
        .addScaledVector(lower, 3 * t * t * v)
        .addScaledVector(crown, 3 * t * v * v)
        .addScaledVector(rim, v ** 3);
      const fold = Math.sin(Math.PI * v);
      // The lower front turn is part of the same shell: two broad diagonal
      // cloth compressions meet across the neck, with no separate polygon
      // leaves or naked cut ends intersecting the continuous hood surface.
      const crossing = 0.51 + 0.23 * Math.sin(a);
      result.z += frontWindow * fold * (
        0.005 * bell(v - crossing, 0.19) -
        0.002 * bell(v - crossing - 0.2, 0.14));
      result.y += frontWindow * fold * 0.0035 * Math.sin(a * 2 + 0.3);
      // Local cloth creases on the raised rear and the two side folds. They
      // affect relief inside the traced contour without reshaping its rim.
      result.z += fold * (
        0.0032 * bell(a - 2.24 - 0.22 * v, 0.22) * bell(v - 0.55, 0.27) -
        0.004 * bell(a - 3.93 + 0.24 * v, 0.25) * bell(v - 0.62, 0.24) +
        0.0027 * bell(a - 1.12 + 0.23 * v, 0.19) * bell(v - 0.4, 0.29) -
        0.0035 * bell(a - 5.07 - 0.18 * v, 0.21) * bell(v - 0.34, 0.25));
      if (reference) {
        // Standing fleece falls in short creases inside the opening, while the
        // traced crown stays fixed. These scalar cues come from the actual
        // supplied hood photograph rather than a repeating procedural wave.
        const hoodPhoto = referenceFold(kind, reference.axis + result.x / scale, reference.bottom - result.y / scale);
        result.z += hoodPhoto * fold * 0.45;
        result.y += hoodPhoto * 0.3 * fold;
      }
      return result;
    };
    const hood = grid(128, 48, hoodAt);
    details.push(hood);
    linings.push(inside(hood, 0.0025));
    // Roll the actual opening edge back to its lining. Both boundaries use the
    // very same shell positions, leaving a real hollow opening without a
    // detached flared ring, sharp strips, or a cap over the cavity.
    const rimRoll = (u: number, v: number) => {
      const p = hoodAt(u, 1), e = 0.0001;
      const along = hoodAt(u + e, 1).sub(hoodAt(u - e, 1)).normalize();
      const outward = hoodAt(u, 1 + e).sub(hoodAt(u, 1 - e)).normalize();
      const normal = along.clone().cross(outward).normalize();
      return p.addScaledVector(normal, -0.00125 * (1 - Math.cos(Math.PI * v)))
        .addScaledVector(outward, 0.0011 * Math.sin(Math.PI * v));
    };
    details.push(grid(192, 12, rimRoll));
    details.push(line(Array.from({ length: 128 }, (_, i) => hoodAt(i / 128, 0.91)), 0.00025, 192, true));
    details.push(
      line(
        Array.from({ length: 41 }, (_, i) => hoodAt(0.5, i / 40)),
        0.00045,
        48,
      ),
    );
    for (const side of [-1, 1]) {
      const exitU = side > 0 ? 0.056 : 0.944, exitV = 0.54;
      const along = hoodAt(exitU + 0.0001, exitV).sub(hoodAt(exitU - 0.0001, exitV)).normalize();
      const upward = hoodAt(exitU, exitV + 0.0001).sub(hoodAt(exitU, exitV - 0.0001)).normalize();
      const normal = along.clone().cross(upward).normalize();
      // The cord eyelets are on the visible outward face of the lower turn.
      // Ensure their mouth is exposed forward even where the cloth bends down.
      if (normal.z < 0) normal.negate();
      const exit = hoodAt(exitU, exitV).addScaledVector(normal, 0.0012);
      details.push(
        line(
          Array.from(
            { length: 24 },
            (_, i) => exit.clone()
              .addScaledVector(along, Math.cos((i / 24) * TAU) * 0.0033)
              .addScaledVector(upward, Math.sin((i / 24) * TAU) * 0.0033),
          ),
          0.0006,
          40,
          true,
        ),
      );
      // Start in the centre of the eyelet, emerge in front of the folded cloth,
      // and follow the chest depth. A fixed world-z curve can enter the garment
      // and reappear lower down as an apparently disconnected cord.
      const chestCord = (x: number, y: number, free = 0.008) => {
        const p = surfaces[0]!(x, y);
        p.z += free;
        return p;
      };
      const belowExit = exit.clone().add(new Vector3(side * 0.0005, -0.008, 0.006));
      const cord = curve([
        exit.toArray(), belowExit.toArray(),
        chestCord(side * 0.044, 0.681, 0.012).toArray(),
        chestCord(side * 0.048, 0.642).toArray(),
        chestCord(side * 0.041, 0.611).toArray(),
      ], 40);
      details.push(line(cord, 0.0016, 64));
      details.push(
        line(
          [
            cord.at(-1)!,
            cord
              .at(-1)!
              .clone()
              .add(new Vector3(0, -0.014, 0)),
          ],
          0.0017,
          5,
        ),
      );
    }
  }
  if (!hoodie && !polo) {
    const width = kind === 'sweatshirt' ? 0.017 : 0.011;
    const neckLoop = new CatmullRomCurve3(Array.from({length:128}, (_, i) => {
      const a = i / 128 * TAU, front = a <= Math.PI, phi = front ? a : TAU - a;
      return surfaces[front ? 0 : 1]!(neckRadius * Math.cos(phi), topY - (front ? frontNeckDrop : backNeckDrop) * Math.sin(phi));
    }), true, 'centripetal');
    const collarAt = (u: number, v: number) => {
      const a = u * TAU, front = a <= Math.PI, phi = front ? a : TAU - a;
      const base = neckLoop.getPoint(u % 1);
      // Turn the soft band into the opening; a rounded fold keeps its two
      // sides continuous at the shoulder junction instead of an offset wedge.
      const inward = width * v;
      base.x -= inward * Math.cos(phi);
      base.y += inward * Math.sin(phi) * (front ? 1 : -1);
      base.z += (front ? 1 : -1) * 0.002 * Math.sin(Math.PI * v) * Math.sin(phi);
      base.y += 0.0007 * Math.sin(a * 3 + .4) * Math.sin(Math.PI * v);
      return base;
    };
    const neckline = grid(
      192,
      14,
      collarAt,
      (_p, u, v) => reference ? [u * TAU * neckRadius / .0048, v * width / .004] : [u * 2, v],
      true,
    );
    // Move the inner side in depth only: offsetting cusp normals created
    // small triangular tabs at the front/back shoulder joins.
    const inner = neckline.clone(), innerP = inner.getAttribute('position');
    for (let i = 0; i < innerP.count; i++) innerP.setZ(i, innerP.getZ(i) * .94);
    ribs.push(neckline, reverse(inner));
    for (const v of [.06, .18]) details.push(line(
      Array.from({length:192}, (_, i) => collarAt(i / 192, v)),
      kind === 'sweatshirt' ? .00025 : .0002, 256, true,
    ));
  }
  if (polo && reference) {
    // Folded flat-knit collar: a stand sewn to the neckline that rolls over and
    // falls onto the shoulders, ending in two points beside the placket. The
    // roll line and fall edge follow the supplied front photograph.
    const roll: Point[] = [[500,96],[528,97],[548,100],[559,107],[555,135],[545,165],[533,195],[522,222]];
    const fall: Point[] = [[500,128],[548,126],[592,118],[614,116],[606,150],[592,183],[575,214],[556,244]];
    const rollCurve = new CatmullRomCurve3(roll.map((p) => new Vector3(...fromPhoto(p), 0)), false, 'centripetal');
    const fallCurve = new CatmullRomCurve3(fall.map((p) => new Vector3(...fromPhoto(p), 0)), false, 'centripetal');
    const placketHalf = 22 * scale, phiEnd = Math.acos(placketHalf / neckRadius);
    for (const side of [-1, 1]) {
      const neckAt = (t: number) => {
        const back = t < 0.5,
          phi = back ? (1 - t / 0.5) * Math.PI / 2 : ((t - 0.5) / 0.5) * phiEnd;
        const x = neckRadius * Math.cos(phi), y = topY - (back ? backNeckDrop : frontNeckDrop) * Math.sin(phi);
        return surfaces[back ? 1 : 0]!(side * x, y);
      };
      const collarAt = (t: number, v: number) => {
        const n = neckAt(t);
        // The collar side already turns forward over the shoulder seam, so the
        // fall edge runs continuously from the back band into each point.
        const front = smooth(0.18, 0.46, t);
        const r = rollCurve.getPoint(t), f = fallCurve.getPoint(t);
        const rollZ = n.z + 0.004 * front - 0.006 * (1 - front);
        const fx = side * f.x;
        const onBody = front * surfaces[0]!(fx, f.y).z + (1 - front) * surfaces[1]!(fx, f.y).z;
        const R = new Vector3(side * r.x, r.y, rollZ),
          F = new Vector3(fx, f.y, onBody + 0.0035 * front - 0.0035 * (1 - front));
        // Pass the stand through the rounded roll at v = 0.32 (quadratic Bézier).
        const w = 0.32;
        const C = R.clone().sub(n.clone().multiplyScalar((1 - w) ** 2)).sub(F.clone().multiplyScalar(w * w)).divideScalar(2 * w * (1 - w));
        const p = n.clone().multiplyScalar((1 - v) ** 2).addScaledVector(C, 2 * v * (1 - v)).addScaledVector(F, v * v);
        // Flat-knit collars curl slightly at the fall edge and points.
        p.z += 0.0012 * smooth(0.75, 1, v) * front;
        return p;
      };
      const collar = grid(72, 18, collarAt, (_p, u, v) => [u * 0.3 / 0.0048, v * 0.07 / 0.004], side < 0);
      ribs.push(collar, inside(collar, 0.0014));
      // Fine topstitching parallel to the fall edge.
      details.push(line(Array.from({ length: 64 }, (_, i) => collarAt(i / 63, 0.93)).map((p) => p.add(new Vector3(0, 0, 0.0006))), 0.00018, 96));
    }
  }
  const trims: BufferGeometry[] = [];
  if (polo && reference) {
    // Inside the back neck: a dark grey tape just below the collar seam and a
    // small woven size label at centre back, seen between the collar points.
    const inner = (x: number, y: number, lift: number) => surfaces[1]!(x, y).add(new Vector3(0, 0, lift));
    const neckY = (x: number) => topY - backNeckDrop * Math.sqrt(Math.max(0, 1 - (x / neckRadius) ** 2));
    trims.push(grid(64, 3, (u, v) => {
      const x = (u * 2 - 1) * neckRadius * 0.9;
      return inner(x, neckY(x) - 0.002 - 0.005 * v, 0.0016);
    }, undefined, true));
    trims.push(grid(6, 8, (u, v) => inner((u - 0.5) * 0.017, topY - 0.005 - 0.019 * v, 0.0022), undefined, true));
  }
  if (polo && !reference) {
    // Folded two-leaf collar with pointed tips and a visible inner neck band.
    for (const side of [-1, 1]) {
      // The outer tip is an actual boundary corner, not a rounded angular
      // maximum of an ellipse. The rest of the leaf softly follows the neck.
      const frontEdge = new CatmullRomCurve3([
        new Vector3(side * 0.08, 0.59, 0),
        new Vector3(side * 0.123, 0.651, 0),
        new Vector3(side * 0.121, 0.698, 0),
      ], false, 'centripetal');
      const backEdge = new CatmullRomCurve3([
        new Vector3(side * 0.121, 0.698, 0),
        new Vector3(side * 0.073, 0.676, 0),
        new Vector3(0, 0.66, 0),
      ], false, 'centripetal');
      const collar = grid(
        48,
        16,
        (u, v) => {
          const angle = u * Math.PI,
            forward = Math.cos(angle);
          const x = side * 0.095 * Math.sin(angle),
            y = topY - (forward >= 0 ? 0.085 : 0.032) * Math.abs(forward);
          const base = surfaces[forward >= 0 ? 0 : 1]!(x, y);
          const inner = base
            .clone()
            .multiply(new Vector3(0.94, 1, 0.95))
            .add(new Vector3(0, 0.005, 0));
          inner.x += side * 0.011 * Math.max(0, forward) ** 5;
          const edge = u <= 0.5 ? frontEdge.getPointAt(u * 2) : backEdge.getPointAt((u - 0.5) * 2);
          const outer = surfaces[forward >= 0 ? 0 : 1]!(edge.x, edge.y).add(
            new Vector3(0, 0.001, forward >= 0 ? 0.0025 : -0.0025),
          );
          return inner.lerp(outer, v).add(new Vector3(0, 0.002 * Math.sin(Math.PI * v), 0));
        },
        undefined,
        side > 0,
      );
      ribs.push(collar, inside(collar, 0.0015));
    }
  }
  return {
    front: panels[0]!,
    back: panels[1]!,
    details: combine(details),
    lining: combine(linings),
    ribbing: combine(ribs),
    ...(trims.length ? { trim: combine(trims) } : {}),
  };
}

/** Locally modelled blank products. Physical print UVs share the existing project convention. */
export function createCatalogProduct(product: ProductDefinition): CatalogGeometry {
  const kind = product.kind as string;
  if (['tote', 'apron', 'cap'].includes(kind)) return createCatalogAccessory(product);


  if (['hoodie', 'sweatshirt', 'longsleeve', 'polo'].includes(kind)) return clothing(product, kind);
  throw new Error(`Unsupported catalog geometry: ${product.id}`);
}
