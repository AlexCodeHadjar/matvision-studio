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
import type { ProductDefinition, PrintSide } from '../contracts';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, width: number) => Math.exp(-((x / width) ** 2));

/** Sewn pattern panels. Only shoulder/underarm/side seams meet; all four openings stay open. */
function pattern(product: ProductDefinition, side: PrintSide) {
  const fit = product.id.includes('bella') ? 0.94 : 1;
  const curve = (points: number[][], count: number) =>
    new CatmullRomCurve3(
      points.map(([x, y]) => new Vector3(x! * fit, y!, 0)),
      false,
      'centripetal',
    )
      .getPoints(count)
      .map((p) => new Vector2(p.x, p.y));
  const lower = curve(
    [
      [0.25, 0.023],
      [0.247, 0.16],
      [0.239, 0.32],
      [0.245, 0.424],
      [0.267, 0.46],
      [0.296, 0.453],
      [0.35, 0.438],
    ],
    40,
  );
  const shoulder = curve(
    [
      [0.397, 0.565],
      [0.331, 0.617],
      [0.26, 0.668],
      [0.205, 0.69],
      [0.084 / fit, 0.714],
    ],
    34,
  );
  const hem = Array.from(
    { length: 129 },
    (_, i) => new Vector2(-Math.cos((Math.PI * i) / 128) * 0.25 * fit, 0.023),
  );
  const cuff = Array.from({ length: 97 }, (_, i) =>
    lower
      .at(-1)!
      .clone()
      .lerp(shoulder[0]!, 0.5 - 0.5 * Math.cos((Math.PI * i) / 96)),
  );
  const neck = Array.from({ length: 129 }, (_, i) => {
    const a = (Math.PI * i) / 128;
    return new Vector2(
      0.097 * Math.cos(a),
      yOnLine(shoulder, 0.097) - (side === 'front' ? 0.083 : 0.041) * Math.sin(a),
    );
  });
  // The body joins the OUTER collar edge. The rib band spans the remaining neck
  // opening, so body/lining triangles never overlap its inner folded surface.
  const bodyShoulder = [
    ...shoulder.filter((p) => p.x > 0.097),
    new Vector2(0.097, yOnLine(shoulder, 0.097)),
  ];
  const mirror = (p: Vector2) => new Vector2(-p.x, p.y);
  const outline = [
    ...hem,
    ...lower.slice(1),
    ...cuff.slice(1),
    ...bodyShoulder.slice(1),
    ...neck.slice(1),
    ...bodyShoulder.slice(0, -1).reverse().map(mirror),
    ...cuff.slice(0, -1).reverse().map(mirror),
    ...lower.slice(0, -1).reverse().map(mirror),
  ];
  return {
    fit,
    outline,
    lower,
    shoulder,
    hem,
    cuff,
    neck,
    sewn: [lower, shoulder, lower.map(mirror), shoulder.map(mirror)],
  };
}

function distanceToLines(x: number, y: number, lines: Vector2[][]) {
  let best = Infinity,
    nx = 0,
    ny = 0;
  const distances: number[] = [];
  for (const line of lines) {
    let lineBest = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!,
        b = line[i]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      const ex = x - a.x - dx * t,
        ey = y - a.y - dy * t,
        d = Math.hypot(ex, ey);
      lineBest = Math.min(lineBest, d);
      if (d < best) {
        best = d;
        const length = Math.hypot(dx, dy),
          mirror = line[0]!.x < 0 ? -1 : 1;
        nx = (mirror * dy) / length;
        ny = (-mirror * dx) / length;
      }
    }
    distances.push(lineBest);
  }
  let rounded = distances[0]!;
  for (const d of distances.slice(1)) {
    const blend = Math.max(0.04 - Math.abs(rounded - d), 0) / 0.04;
    rounded = Math.min(rounded, d) - blend * blend * 0.01;
  }
  return { distance: Math.max(0, rounded), nx, ny };
}

function surface(patternData: ReturnType<typeof pattern>, side: PrintSide) {
  const sign = side === 'front' ? 1 : -1;
  return (x: number, y: number) => {
    const distance = distanceToLines(x, y, patternData.sewn).distance;
    const d = distance < 0.000001 ? 0 : distance;
    // Round cross section without a solid side wall; depth collapses only along sewn edges.
    // A finite slope at the sewn edge prevents tiny tessellation errors from
    // becoming tall spikes under the square root.
    const edgeRound = Math.sqrt(1 - Math.exp(-0.00035 / 0.045));
    const radial =
      (Math.sqrt(Math.max(0, 1 - Math.exp(-(d + 0.00035) / 0.045))) - edgeRound) / (1 - edgeRound);
    const chest = 0.066 - 0.014 * (1 - smooth(0.21, 0.52, y));
    const sleeve = smooth(0.24, 0.34, Math.abs(x));
    let z = (chest * (1 - sleeve) + 0.051 * sleeve) * radial;
    // Local drape from armholes and loosely hanging hem, with different front/back phases.
    const ax = Math.abs(x),
      phase = side === 'front' ? 0 : 1.8;
    const bottom = 1 - smooth(0.04, 0.33, y);
    const sideWeight = smooth(0.1, 0.23, ax);
    const folds =
      (0.0075 * Math.sin(x * 57 + phase + y * 3.3) + 0.002 * Math.sin(x * 99 - y * 8 + 1.3)) *
        bottom +
      0.007 *
        Math.sin(
          (ax - 0.25 + (y - 0.44) * (0.53 + 0.13 * Math.sin(x * 13))) * (x < 0 ? 88 : 109) +
            phase +
            x * 6,
        ) *
        bell(y - 0.4, 0.11) *
        sideWeight +
      0.003 * Math.sin(x * 39 + y * 25 + phase) * bell(y - 0.22, 0.15) * sideWeight +
      0.0024 * Math.sin(y * 34 + x * 15 + phase) * bell(x + 0.14, 0.09) +
      0.0038 *
        Math.sin(x * 31 - y * 24 + 0.8 + phase) *
        bell(y - 0.38, 0.17) *
        bell(x - 0.085, 0.17) +
      0.003 *
        Math.sin((x + 0.08) * 70 + y * 19 + phase) *
        bell(y - 0.565, 0.072) *
        bell(x + 0.11, 0.075);
    z += folds * Math.min(1, d / 0.028);
    const warpX = 0.003 * Math.sin(y * 11) * (1 - smooth(0.4, 0.65, y));
    const warpY =
      0.004 * Math.sin(x * 20 + 0.6) * Math.exp(-y / 0.09) +
      0.0015 * Math.sin(x * 11) * smooth(0.48, 0.7, y);
    return new Vector3(
      x + warpX,
      y + warpY,
      sign * z + 0.003 * Math.sin(y * 6) * Math.min(1, d / 0.025),
    );
  };
}

function surfaceNormal(
  pd: ReturnType<typeof pattern>,
  at: (x: number, y: number) => Vector3,
  side: PrintSide,
  x: number,
  y: number,
) {
  const d = distanceToLines(x, y, pd.sewn);
  if (d.distance < 0.000001) return new Vector3(d.nx, d.ny, 0);
  const e = 0.00002,
    dx = at(x + e, y).sub(at(x - e, y)),
    dy = at(x, y + e).sub(at(x, y - e));
  return dx
    .cross(dy)
    .normalize()
    .multiplyScalar(side === 'front' ? 1 : -1);
}

function yOnLine(line: Vector2[], x: number) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x))
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return line.at(-1)!.y;
}

/** Conforming edge splits keep all neighbouring triangles joined, including tiny curved cuffs. */
function tessellate(outline: Vector2[]) {
  // Keep double precision until the final 3D buffers: Float32 rounding of
  // collinear cuff points otherwise creates microscopic false boundary triangles.
  const points = outline.map((p) => p.clone());
  if (!ShapeUtils.isClockWise(points)) points.reverse();
  let indices = ShapeUtils.triangulateShape(points, []).flat();
  for (let pass = 0; pass < 10; pass++) {
    const splits = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (let i = 0; i < indices.length; i += 3)
      for (let e = 0; e < 3; e++) {
        const a = indices[i + e]!,
          b = indices[i + ((e + 1) % 3)]!,
          k = key(a, b);
        if (points[a]!.distanceToSquared(points[b]!) > 0.006 ** 2 && !splits.has(k)) {
          splits.set(k, points.length);
          points.push(points[a]!.clone().add(points[b]!).multiplyScalar(0.5));
        }
      }
    if (!splits.size) break;
    const next: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]!,
        b = indices[i + 1]!,
        c = indices[i + 2]!;
      const ab = splits.get(key(a, b)),
        bc = splits.get(key(b, c)),
        ca = splits.get(key(c, a));
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
    indices = next;
  }
  // Relax only interior vertices: boundary curves and physical print UVs stay exact.
  // This removes the skinny fans inherited from earcut before offsetting the cloth.
  const neighbours = points.map(() => new Set<number>()),
    edgeCounts = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[i + k]!,
        b = indices[i + ((k + 1) % 3)]!,
        key = a < b ? `${a}:${b}` : `${b}:${a}`;
      neighbours[a]!.add(b);
      neighbours[b]!.add(a);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  const boundary = new Set<number>();
  for (const [key, count] of edgeCounts)
    if (count === 1) key.split(':').forEach((i) => boundary.add(Number(i)));
  for (let pass = 0; pass < 30; pass++) {
    const next = points.map((p, i) => {
      if (boundary.has(i) || !neighbours[i]!.size) return p.clone();
      const average = new Vector2();
      for (const j of neighbours[i]!) average.add(points[j]!);
      return p.clone().lerp(average.multiplyScalar(1 / neighbours[i]!.size), 0.45);
    });
    next.forEach((p, i) => points[i]!.copy(p));
  }
  // Earcut starts with fans of very thin triangles. Constrained Delaunay flips
  // regularize the interior so a sub-millimetre lining offset cannot fold those fans.
  const area = (a: number, b: number, c: number) =>
    (points[b]!.x - points[a]!.x) * (points[c]!.y - points[a]!.y) -
    (points[b]!.y - points[a]!.y) * (points[c]!.x - points[a]!.x);
  for (let pass = 0; pass < 14; pass++) {
    const edges = new Map<string, { a: number; b: number; c: number; tri: number }>(),
      used = new Set<number>();
    let flipped = 0;
    for (let tri = 0; tri < indices.length; tri += 3) {
      if (used.has(tri)) continue;
      for (let k = 0; k < 3; k++) {
        const a = indices[tri + k]!,
          b = indices[tri + ((k + 1) % 3)]!,
          c = indices[tri + ((k + 2) % 3)]!,
          key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const other = edges.get(key);
        if (!other) {
          edges.set(key, { a, b, c, tri });
          continue;
        }
        if (used.has(other.tri)) continue;
        const d = other.c;
        if (area(c, d, b) < 1e-12 || area(d, c, a) < 1e-12) continue;
        const pa = points[a]!,
          pb = points[b]!,
          pc = points[c]!,
          pd = points[d]!;
        const ax = pa.x - pd.x,
          ay = pa.y - pd.y,
          bx = pb.x - pd.x,
          by = pb.y - pd.y,
          cx = pc.x - pd.x,
          cy = pc.y - pd.y;
        const inside =
          (ax * ax + ay * ay) * (bx * cy - cx * by) -
          (bx * bx + by * by) * (ax * cy - cx * ay) +
          (cx * cx + cy * cy) * (ax * by - bx * ay);
        if (inside <= 1e-15) continue;
        indices.splice(tri, 3, c, d, b);
        indices.splice(other.tri, 3, d, c, a);
        used.add(tri);
        used.add(other.tri);
        flipped++;
        break;
      }
    }
    if (!flipped) break;
  }
  return { points, indices };
}

function mesh(positions: number[], uv: number[], indices: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function innerShell(outer: BufferGeometry, thickness = 0) {
  const g = outer.clone(),
    p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    ix = g.index!;
  for (let i = 0; i < p.count; i++) {
    if (thickness === 0) {
      // Preserve the sewn topology and give the lining a small depth separation.
      // Thickness tapers into pressed seams; no normal offset can invert a sliver.
      p.setZ(i, p.getZ(i) * 0.99);
      const normal = new Vector3(-n.getX(i), -n.getY(i), -n.getZ(i) / 0.99).normalize();
      n.setXYZ(i, normal.x, normal.y, normal.z);
      continue;
    }
    p.setXYZ(
      i,
      p.getX(i) - n.getX(i) * thickness,
      p.getY(i) - n.getY(i) * thickness,
      p.getZ(i) - n.getZ(i) * thickness,
    );
    n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  }
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i);
    ix.setX(i, ix.getX(i + 2));
    ix.setX(i + 2, a);
  }
  return g;
}

export function createGarment(product: ProductDefinition) {
  const result: {
    front: BufferGeometry;
    back: BufferGeometry;
    lining: BufferGeometry;
    collar: BufferGeometry;
    collarInside: BufferGeometry;
    hems: BufferGeometry;
    stitches: BufferGeometry;
  } = {} as never;
  const linings: BufferGeometry[] = [],
    hems: BufferGeometry[] = [],
    stitches: BufferGeometry[] = [];
  const states = (['front', 'back'] as const).map((side) => {
    const pd = pattern(product, side);
    return { side, pd, at: surface(pd, side) };
  });
  for (const { side, pd, at } of states) {
    const { points, indices } = tessellate(pd.outline),
      positions: number[] = [],
      uv: number[] = [];
    const sign = side === 'front' ? 1 : -1;
    for (const p of points) {
      positions.push(...at(p.x, p.y).toArray());
      uv.push(0.5 + (sign * p.x) / (product.widthMm / 1000), p.y / (product.heightMm / 1000));
    }
    if (sign < 0)
      for (let i = 0; i < indices.length; i += 3)
        [indices[i], indices[i + 2]] = [indices[i + 2]!, indices[i]!];
    const g = mesh(positions, uv, indices),
      normals = g.getAttribute('normal');
    // Shared sewn boundaries have horizontal outward normals on both pattern panels.
    points.forEach((p, i) => {
      const n = surfaceNormal(pd, at, side, p.x, p.y);
      normals.setXYZ(i, n.x, n.y, n.z);
    });
    result[side] = g;
    // The inner panel uses the same sewn topology with a tapered depth separation.
    // Cuffs, hem and folded collar carry the visible folded material thickness.
    linings.push(innerShell(g));
    const tube = (path: Vector3[], radius: number) =>
      new TubeGeometry(new CatmullRomCurve3(path), path.length * 2, radius, 10, false);
    const raised = (x: number, y: number, offset: number) =>
      at(x, y).addScaledVector(surfaceNormal(pd, at, side, x, y), offset);
    // Folded cuffs and double-needle hem: thin cloth edge, not a large decorative rope.
    const paths = [pd.hem, pd.cuff, pd.cuff.map((p) => new Vector2(-p.x, p.y))];
    for (const path of paths) {
      hems.push(
        tube(
          path.map((p) => at(p.x, p.y)),
          0.00065,
        ),
      );
      for (const offset of [0.013, 0.017]) {
        const shifted = path.map(
          (p) =>
            new Vector2(
              p.x + (path === pd.hem ? 0 : -Math.sign(p.x) * offset * 0.92),
              p.y + (path === pd.hem ? offset : offset * 0.34),
            ),
        );
        const curve = new CatmullRomCurve3(shifted.map((p) => raised(p.x, p.y, 0.00022)));
        const len = curve.getLength(),
          count = Math.floor(len / 0.0025);
        for (let i = 0; i < count; i++) {
          const a = curve.getPointAt(i / count),
            b = curve.getPointAt((i + 0.48) / count);
          stitches.push(tube([a, b], 0.00016));
        }
      }
    }
    // Curved armscye stitch lines follow the actual shoulder and underarm shape.
    for (const mirror of [-1, 1]) {
      const startX = 0.22 * pd.fit,
        startY = yOnLine(pd.shoulder, startX);
      const end = pd.lower.reduce((a, b) => (b.y > a.y ? b : a));
      const path = Array.from({ length: 97 }, (_, i) => {
        const t = i / 96,
          x = mirror * (startX + (end.x - startX) * t - 0.01 * Math.sin(t * Math.PI) * pd.fit),
          y = startY + (end.y - startY) * t;
        return raised(x, y, 0.00023);
      });
      hems.push(tube(path, 0.00022));
    }
  }
  // Continuous 13 mm rib-knit collar band around the OPEN neck, including the back neck.
  const pos: number[] = [],
    uv: number[] = [],
    ribNormals: number[] = [],
    ix: number[] = [],
    around = 384,
    across = 16;
  for (let j = 0; j <= across; j++)
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * Math.PI * 2,
        t = j / across,
        front = a <= Math.PI;
      const phi = front ? a : 2 * Math.PI - a,
        { at, pd, side } = states[front ? 0 : 1]!;
      const outerX = 0.084 + 0.013 * t,
        shoulder = states[front ? 0 : 1]!.pd.shoulder;
      const shoulderY = yOnLine(shoulder, outerX);
      const x = outerX * Math.cos(phi),
        y = shoulderY - ((front ? 0.071 : 0.029) + 0.012 * t) * Math.sin(phi);
      const p = at(x, y);
      p.z += (front ? 1 : -1) * 0.0008 * Math.sin(phi);
      pos.push(...p.toArray());
      ribNormals.push(...surfaceNormal(pd, at, side, x, y).toArray());
      uv.push(i / around, t);
    }
  for (let j = 0; j < across; j++)
    for (let i = 0; i < around; i++) {
      const a = j * (around + 1) + i,
        b = a + 1,
        c = a + around + 1;
      ix.push(a, b, c, b, c + 1, c);
    }
  const collar = mesh(pos, uv, ix);
  collar.setAttribute('normal', new Float32BufferAttribute(ribNormals, 3));
  const collarInside = innerShell(collar, 0.0012);
  result.collarInside = collarInside;
  const rimPositions: number[] = [],
    rimUv: number[] = [],
    rimIndices: number[] = [];
  const cp = collar.getAttribute('position'),
    ip = collarInside.getAttribute('position');
  for (let i = 0; i <= around; i++) {
    rimPositions.push(cp.getX(i), cp.getY(i), cp.getZ(i), ip.getX(i), ip.getY(i), ip.getZ(i));
    rimUv.push(i / around, 0, i / around, -0.08);
    if (i < around) {
      const a = i * 2;
      rimIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const neckFold = mesh(rimPositions, rimUv, rimIndices);
  result.collar = mergeGeometries([collar, neckFold])!;
  collar.dispose();
  neckFold.dispose();
  const merge = (parts: BufferGeometry[]) => {
    const g = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return g;
  };
  result.lining = merge(linings);
  result.hems = merge(hems);
  result.stitches = merge(stitches);
  return result;
}
