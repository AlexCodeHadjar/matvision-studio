import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  SphereGeometry,
  BoxGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProductDefinition } from '../contracts';
import type { CatalogGeometry } from './catalog';

const TAU = Math.PI * 2;
const clamp = (t: number, a = 0, b = 1) => Math.max(a, Math.min(b, t));
const smooth = (a: number, b: number, t: number) => {
  const v = clamp((t - a) / (b - a));
  return v * v * (3 - 2 * v);
};
const bell = (t: number, w: number) => Math.exp(-((t / w) ** 2));
const vec = (p: number[]) => new Vector3(p[0]!, p[1]!, p[2]!);

function geometry(p: number[], uv: number[], ix: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

function merge(parts: BufferGeometry[]) {
  const result = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return result;
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

function lining(g: BufferGeometry, thickness: number) {
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
        c = a + nu + 1;
      ix.push(a, b, c, b, c + 1, c);
    }
  const result = geometry(p, uv, ix);
  const n = result.getAttribute('normal');
  // Derivatives avoid diagonal shading in soft fabric, including uneven grids.
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu,
        v = j / nv,
        e = 0.00001;
      const du = at(Math.min(1, u + e), v).sub(at(Math.max(0, u - e), v));
      const dv = at(u, Math.min(1, v + e)).sub(at(u, Math.max(0, v - e)));
      const normal = du.cross(dv).normalize();
      if (normal.lengthSq() > 0.5) n.setXYZ(j * (nu + 1) + i, normal.x, normal.y, normal.z);
    }
  return flip ? reverse(result) : result;
}

function thread(points: Vector3[], radius = 0.00024, segments = 100, closed = false) {
  const distinct = points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]!) > 1e-12);
  if (closed && distinct.length > 2 && distinct[0]!.distanceToSquared(distinct.at(-1)!) < 1e-12)
    distinct.pop();
  return new TubeGeometry(
    new CatmullRomCurve3(distinct, closed, 'centripetal'),
    segments,
    radius,
    6,
    closed,
  );
}

function stitches(at: (t: number) => Vector3, count: number, radius = 0.00016) {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++)
    parts.push(thread([at((i + 0.13) / count), at((i + 0.76) / count)], radius, 2));
  return merge(parts);
}

/** Two sewn cloth faces, with a rounded thin edge and a gently twisting frame. */
function strap(points: number[][], width: number, thickness = 0.0012, twist = 0.1) {
  const path = new CatmullRomCurve3(points.map(vec), false, 'centripetal');
  const frame = (u: number) => {
    const center = path.getPointAt(u),
      tangent = path.getTangentAt(u);
    const across = new Vector3(tangent.y, -tangent.x, 0).normalize();
    if (across.lengthSq() < 0.5) across.set(1, 0, 0);
    const face = tangent.clone().cross(across).normalize();
    const angle = twist * Math.sin(Math.PI * u) * Math.sin(5 * u + 0.35);
    across.applyAxisAngle(tangent, angle);
    face.applyAxisAngle(tangent, angle);
    return { center, across, face };
  };
  const point = (u: number, across: number, face: number) => {
    const f = frame(u);
    return f.center.addScaledVector(f.across, across).addScaledVector(f.face, face);
  };
  const at = (u: number, v: number) => {
    const a = v * TAU,
      c = Math.cos(a),
      s = Math.sin(a);
    // Superellipse: broad, flat webbing faces and a softened folded edge.
    return point(
      u,
      (Math.sign(c) * Math.abs(c) ** 0.32 * width) / 2,
      (Math.sign(s) * Math.abs(s) ** 0.72 * thickness) / 2,
    );
  };
  const parts = [grid(160, 20, at, undefined, true)];
  for (const edge of [-1, 1])
    parts.push(
      stitches((t) => point(t, edge * (width / 2 - 0.0017), -thickness * 0.55), 110, 0.00012),
    );
  for (const u of [0, 1])
    parts.push(
      grid(8, 3, (a, b) => point(u, (a - 0.5) * width, (b - 0.5) * thickness), undefined, u === 0),
    );
  return merge(parts);
}

function printUV(product: ProductDefinition, sign = 1) {
  return (p: Vector3) => [
    0.5 + (sign * p.x) / (product.widthMm / 1000),
    p.y / (product.heightMm / 1000),
  ];
}

function tote(product: ProductDefinition): CatalogGeometry {
  const details: BufferGeometry[] = [],
    inner: BufferGeometry[] = [],
    faces: BufferGeometry[] = [];
  const at = (u: number, v: number, sign: number) => {
    const angle = (u - 0.5) * Math.PI,
      q = Math.sin(angle),
      c = Math.max(0, Math.cos(angle));
    // 03_Шоппер_белый.jpg: body ≈ 0.83 wide : 1 tall, a touch wider at the bottom.
    const width = 0.172 + 0.007 * (1 - v) + 0.003 * Math.sin(Math.PI * v);
    const x = width * q + 0.0018 * Math.sin(v * 7) * c;
    // Lightly rounded bottom corners.
    // Straight sewn bottom with softly rounded corners (≈ 15 mm).
    // Round bottom corners (r ≈ 16 mm): lift the bottom edge on a circular arc.
    const into = Math.max(0, width * Math.abs(q) - (width - 0.016));
    const bottom = 0.02 + (0.016 - Math.sqrt(Math.max(0, 0.016 ** 2 - into ** 2))) * (1 - smooth(0, 0.06, v));
    const y =
      bottom +
      0.415 * v -
      // Straight top edge with only a slight sag between the handles.
      (0.006 * c + 0.0015 * bell(q + 0.32, 0.33)) * v ** 8;
    // A hanging empty bag: the walls meet in a thin bottom seam and open only
    // slightly, instead of a stuffed cushion with a rounded floor.
    // The walls meet within ≈ 2 cm of the bottom seam, so any shading of the
    // turn stays in a thin band instead of a wide grey strip.
    const seal = Math.sqrt(smooth(0, 0.05, v));
    const volume = (0.011 + 0.005 * Math.sin(v * Math.PI)) * seal;
    // The photographed bag hangs almost flat: only faint creases near the
    // bottom corners, no dark trough along the bottom seam.
    const lowFold =
      (0.0012 * bell(q + 0.81 + 0.06 * v, 0.11) - 0.001 * bell(q - 0.78 + 0.17 * v, 0.13)) *
      bell(v - 0.1, 0.105);
    const sideFold =
      -0.0032 * bell(q - 0.83 + 0.035 * Math.sin(v * 10), 0.085) * smooth(0.15, 0.35, v);
    const tension =
      0.0026 * Math.sin(q * 23 + sign) * (bell(q + 0.45, 0.19) + bell(q - 0.44, 0.16)) * v ** 6;
    const drape =
      // Only very soft slack in the lower panel; deeper dents read as a stain.
      (0.0008 * bell(q + 0.22 - 0.12 * v, 0.14) - 0.0005 * bell(q - 0.13 + 0.05 * v, 0.10)) *
      bell(v - 0.19, 0.23) +
      0.003 * bell(q - 0.66 + 0.21 * v, 0.09) * bell(v - 0.52, 0.36);
    // Soft vertical drag folds hanging from each sewn-on handle.
    const handleDrag = 0.0028 * (bell(x + 0.108, 0.011) + bell(x - 0.108, 0.012)) * smooth(0.45, 0.92, v) * (1 - smooth(0.95, 1, v));
    const z =
      sign * (volume * c ** 0.66 + (lowFold + sideFold + tension + drape + handleDrag) * c * seal) +
      0.0018 * c * Math.sin(q * 5 + v * 4 + sign) * seal;
    return new Vector3(x, y, z);
  };
  const uForX = (x: number) => 0.5 + Math.asin(clamp(x / 0.174, -1, 1)) / Math.PI;
  // Handles are sewn on the outside at ≈ 61 % of the half width and hang as one
  // narrow loop; the rear pair sits directly behind the front pair.
  const handleX = 0.108;
  for (const sign of [1, -1]) {
    const face = grid(140, 144, (u, v) => at(u, v, sign), printUV(product, sign), sign < 0);
    faces.push(face);
    inner.push(lining(face, 0.00105));
    // A real turned top hem wraps over the edge into the open bag.
    const hem = grid(
      120,
      14,
      (u, v) => {
        const p = at(u, 0.968 + 0.032 * v, sign);
        p.z += sign * (0.00065 + 0.0007 * Math.sin(Math.PI * v));
        return p;
      },
      undefined,
      sign < 0,
    );
    details.push(hem, lining(hem, 0.001));
    details.push(
      thread(
        Array.from({ length: 121 }, (_, i) => at(i / 120, 1, sign)),
        0.00085,
        180,
      ),
    );
    details.push(
      stitches((t) => at(t, 0.97, sign).add(new Vector3(0, 0, sign * 0.0012)), 160, 0.00024),
    );
    // Each strap end lies flat on the outside for ≈ 4 cm below the top edge,
    // where it is box-stitched, then rises into the loop.
    const flat = (x: number, v: number) => at(uForX(x), v, sign).add(new Vector3(0, 0, sign * 0.0011));
    const left = flat(-handleX, 0.9),
      right = flat(handleX, 0.9);
    const z = (k: number) => sign * k;
    const pts = [
      left.toArray(),
      flat(-handleX, 0.99).toArray(),
      [-0.1, 0.47, z(0.017)],
      [-0.087, 0.55, z(0.011)],
      [-0.071, 0.63, z(0.0075)],
      [-0.053, 0.698, z(0.0055)],
      [-0.033, 0.734, z(0.0048)],
      [0.002, 0.745, z(0.0046)],
      [0.035, 0.733, z(0.0048)],
      [0.054, 0.697, z(0.0055)],
      [0.072, 0.628, z(0.0075)],
      [0.089, 0.548, z(0.011)],
      [0.101, 0.469, z(0.017)],
      flat(handleX, 0.99).toArray(),
      right.toArray(),
    ];
    details.push(strap(pts, 0.031, 0.0017, sign > 0 ? 0.05 : -0.05));
    for (const x of [-handleX, handleX]) {
      const surface = (dx: number, v: number) =>
        at(uForX(x + dx), 0.9 + 0.09 * v, sign).add(new Vector3(0, 0, sign * 0.002));
      details.push(grid(12, 16, (u, v) => surface((u - 0.5) * 0.031, v).add(new Vector3(0, 0, sign * 0.0006 * Math.sin(Math.PI * u))), undefined, sign < 0));
      // Box-and-X attachment stitching, heavy enough to read at catalogue scale.
      const sew = (f: (t: number) => Vector3, n: number) => details.push(stitches((t) => f(t).add(new Vector3(0, 0, sign * 0.0009)), n, 0.00028));
      for (const side of [-1, 1]) sew((t) => surface(side * 0.0125, t * 0.82 + 0.07), 12);
      for (const v of [0.08, 0.89]) sew((t) => surface(-0.0125 + 0.025 * t, v), 12);
      sew((t) => surface(-0.0125 + 0.025 * t, 0.08 + 0.81 * t), 15);
      sew((t) => surface(0.0125 - 0.025 * t, 0.08 + 0.81 * t), 15);
    }
  }
  for (const u of [0, 1])
    details.push(
      thread(
        Array.from({ length: 101 }, (_, i) => at(u, i / 100, 1)),
        0.0008,
        160,
      ),
    );
  details.push(
    thread(
      Array.from({ length: 121 }, (_, i) => at(i / 120, 0, 1)),
      0.001,
      180,
    ),
  );
  // The bottom joins at its sewn line; the unsealed top is bounded by two
  // separate walls and their inward-facing liners, never by a filled lid.
  return { front: faces[0]!, back: faces[1]!, details: merge(details), lining: merge(inner) };
}

function apron(product: ProductDefinition): CatalogGeometry {
  const details: BufferGeometry[] = [];
  const body = (x: number, y: number) => {
    const lower = 1 - smooth(0.48, 0.77, y);
    return new Vector3(
      x,
      y,
      0.014 -
        0.012 * (x / 0.2) ** 2 +
        lower *
          (0.009 * bell(x + 0.102 - 0.013 * y, 0.039) -
            0.006 * bell(x - 0.065 + 0.012 * y, 0.035) +
            0.003 * bell(x - 0.145, 0.017)) +
        0.004 * bell(y - 0.58, 0.045) * bell(Math.abs(x) - 0.147, 0.04) +
        0.0015 * Math.sin(x * 18 + y * 8) * bell(y - 0.2, 0.24),
    );
  };
  const halfWidth = (v: number) =>
    0.126 + 0.044 * (1 - smooth(0.59, 0.82, v)) + 0.017 * (1 - smooth(0.02, 0.59, v));
  const at = (u: number, v: number) => {
    const y = 0.025 + 0.816 * v,
      q = u * 2 - 1;
    return body(
      q * halfWidth(y),
      y + 0.003 * (1 - q * q) * (1 - v) ** 12 - 0.0025 * q * (1 - v) ** 5,
    );
  };
  const front = grid(110, 200, at, printUV(product));
  const back = lining(front, 0.0011),
    backUV = back.getAttribute('uv');
  for (let i = 0; i < backUV.count; i++) backUV.setX(i, 1 - backUV.getX(i));
  const boundary = [
    ...Array.from({ length: 81 }, (_, i) => at(i / 80, 0)),
    ...Array.from({ length: 151 }, (_, i) => at(1, i / 150)),
    ...Array.from({ length: 81 }, (_, i) => at(1 - i / 80, 1)),
    ...Array.from({ length: 151 }, (_, i) => at(0, 1 - i / 150)),
  ];
  details.push(thread(boundary, 0.00095, 460, true));
  for (const side of [-1, 1])
    details.push(
      stitches((t) => at(side < 0 ? 0.012 : 0.988, t).add(new Vector3(0, 0, 0.0005)), 200),
    );
  details.push(stitches((t) => at(t, 0.01).add(new Vector3(0, 0, 0.0005)), 80));
  details.push(stitches((t) => at(t, 0.989).add(new Vector3(0, 0, 0.0005)), 60));
  const neckLeft = body(-0.114, 0.829),
    neckRight = body(0.114, 0.829);
  neckLeft.z -= 0.0004;
  neckRight.z -= 0.0004;
  details.push(
    strap(
      [
        neckLeft.toArray(),
        [-0.103, 0.893, 0.003],
        [-0.075, 0.968, -0.018],
        [-0.035, 0.989, -0.028],
        [0.024, 0.99, -0.025],
        [0.069, 0.971, -0.013],
        [0.102, 0.904, 0.004],
        neckRight.toArray(),
      ],
      0.018,
      0.00135,
      0.22,
    ),
  );
  for (const side of [-1, 1]) {
    const anchor = body(side * 0.17, 0.579);
    anchor.z -= 0.001;
    const pts =
      side < 0
        ? [
            anchor.toArray(),
            [-0.219, 0.57, -0.014],
            [-0.255, 0.515, -0.036],
            [-0.252, 0.402, -0.047],
            [-0.221, 0.275, -0.039],
            [-0.23, 0.153, -0.021],
            [-0.251, 0.094, -0.006],
          ]
        : [
            anchor.toArray(),
            [0.221, 0.568, -0.018],
            [0.255, 0.486, -0.041],
            [0.238, 0.365, -0.055],
            [0.251, 0.235, -0.049],
            [0.226, 0.112, -0.029],
            [0.213, 0.052, -0.014],
          ];
    details.push(strap(pts, 0.02, 0.00115, side * 0.42));
    const root = side < 0 ? neckLeft : neckRight;
    for (const dy of [0, 0.013])
      details.push(
        stitches(
          (t) =>
            new Vector3(
              root.x - 0.0075 + 0.015 * t,
              root.y + dy,
              body(root.x, root.y + dy).z + 0.0012,
            ),
          6,
        ),
      );
  }
  // A sewn three-sided pocket. Its upper edge stands clear of the apron,
  // folds inward and exposes a lined mouth; it is deliberately not sealed.
  const pocket = (u: number, v: number) => {
    const q = 2 * u - 1,
      width = 0.113 + 0.02 * smooth(0, 0.13, v),
      x = q * width;
    const y = 0.385 + 0.159 * v + 0.002 * q - 0.003 * (1 - q * q) * v ** 6;
    const gap =
      0.0015 +
      (0.01 + 0.002 * bell(q + 0.25, 0.35)) * Math.sin(Math.PI * u) ** 0.75 * smooth(0, 0.95, v);
    return body(x, y).add(new Vector3(0, 0, gap));
  };
  const pocketFace = grid(82, 64, pocket);
  details.push(pocketFace, lining(pocketFace, 0.001));
  const lip = grid(
    90,
    12,
    (u, v) => {
      const p = pocket(u, 1 - v * 0.047);
      p.z += 0.0006 + 0.00055 * Math.sin(v * Math.PI);
      return p;
    },
    undefined,
    true,
  );
  details.push(lip, lining(lip, 0.0009));
  details.push(
    thread(
      Array.from({ length: 91 }, (_, i) => pocket(i / 90, 1)),
      0.0008,
      140,
    ),
  );
  details.push(stitches((t) => pocket(t, 0.96).add(new Vector3(0, 0, 0.001)), 70));
  for (const side of [0, 1])
    details.push(
      stitches((t) => pocket(side === 0 ? 0.015 : 0.985, t).add(new Vector3(0, 0, 0.0004)), 60),
    );
  details.push(stitches((t) => pocket(t, 0.019).add(new Vector3(0, 0, 0.0004)), 70));
  return { front, back, details: merge(details) };
}

function cap(product: ProductDefinition): CatalogGeometry {
  const details: BufferGeometry[] = [],
    inner: BufferGeometry[] = [];
  const base = 0.038,
    height = 0.104;
  // Structured five-panel crown as in 06_Бейсболка_белый.png: one wide
  // front panel (no centre seam) whose side seams reach the temples.
  const boundaries = [
    -Math.PI * 0.32,
    Math.PI * 0.32,
    Math.PI * 0.66,
    Math.PI,
    Math.PI * 1.34,
    Math.PI * 1.68,
  ];
  // The brim seam is a "smile": the crown's lower edge dips towards the
  // temples where the pre-curved brim bends down.
  const dip = (a: number) => {
    const c = Math.cos(a);
    // Smoothly zero towards the temples: a power of cos(a) left a step there.
    return 0.034 * Math.sin(a) ** 2 * smooth(0, 0.35, c);
  };
  const rearAngle = (a: number) => Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI));
  const minT = (a: number) =>
    Math.abs(rearAngle(a)) < 0.47
      ? (0.043 / height) * Math.sqrt(Math.max(0, 1 - (rearAngle(a) / 0.47) ** 2))
      : 0;
  const crown = (a: number, v: number) => {
    const t = minT(a) + (1 - minT(a)) * v;
    if (t > 0.999999) return new Vector3(0, base + height, -0.004);
    // Upright buckram front and broad rounded top instead of a hemisphere.
    const radius = Math.max(0, 1 - t ** 3) ** 0.45;
    let seamDistance = Infinity;
    for (const b of boundaries)
      seamDistance = Math.min(seamDistance, Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))));
    const inset = 0.00065 * bell(seamDistance, 0.025) * Math.sin(Math.PI * t);
    const frontAngle = Math.atan2(Math.sin(a), Math.cos(a));
    const soft =
      0.0013 * bell(rearAngle(a) - 0.75, 0.28) * bell(t - 0.15, 0.18) -
      0.0011 * bell(rearAngle(a) + 0.91, 0.24) * bell(t - 0.21, 0.16) -
      // Short vertical crease below the button where the stiffened front folds.
      0.0016 * bell(frontAngle, 0.035) * smooth(0.68, 0.93, t) * (1 - smooth(0.96, 1, t)) +
      0.0005 * bell(frontAngle, 0.12) * smooth(0.6, 0.9, t);
    return new Vector3(
      (0.101 * radius + soft - inset) * Math.sin(a),
      base + height * t - dip(a) * (1 - t) ** 2,
      (0.1 * radius + soft - inset) * Math.cos(a) - 0.004 * t,
    );
  };
  const fixCrownPole = (g: BufferGeometry) => {
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) > base + height - 0.000001) n.setXYZ(i, 0, 1, 0);
    return g;
  };
  const front = fixCrownPole(
    grid(110, 94, (u, v) => crown(-Math.PI * 0.32 + u * Math.PI * 0.64, v), printUV(product)),
  );
  inner.push(lining(front, 0.0017));
  for (let panel = 1; panel < 5; panel++) {
    const a = boundaries[panel]!,
      b = boundaries[panel + 1]!;
    const g = fixCrownPole(grid(70, 94, (u, v) => crown(a + (b - a) * u, v)));
    details.push(g);
    inner.push(lining(g, 0.0017));
  }
  // Five sewn panels: a single broad front panel, four side/rear panels.
  // Each seam's twin topstitch runs continuously from the brim up to the
  // button, lifted along the true crown normal so it never sinks into the cloth.
  const crownNormal = (a: number, v: number) => {
    const e = 0.0005;
    const du = crown(a + e, v).sub(crown(a - e, v));
    const dv = crown(a, Math.min(0.999, v + e)).sub(crown(a, Math.max(0, v - e)));
    return du.cross(dv).normalize().multiplyScalar(-1);
  };
  for (const a of boundaries.slice(0, 5))
    for (const delta of [-0.012, 0.012])
      details.push(
        stitches(
          (t) => {
            const v = 0.9 * t, d = delta * (1 - 0.8 * t);
            const n = crownNormal(a + d, v);
            if (n.dot(new Vector3(Math.sin(a), 0.3, Math.cos(a))) < 0) n.negate();
            return crown(a + d, v).addScaledVector(n, 0.00035);
          },
          150,
          0.00016,
        ),
      );
  details.push(
    thread(
      Array.from({ length: 241 }, (_, i) => crown((i / 240) * TAU, 0)),
      0.0004,
      300,
      true,
    ),
  );
  const sweatband = grid(
    240,
    10,
    (u, v) => {
      const p = crown(u * TAU, 0),
        radial = new Vector3(p.x, 0, p.z).normalize();
      p.addScaledVector(radial, -0.002);
      p.y += 0.013 * v;
      return p;
    },
    undefined,
    true,
  );
  inner.push(sweatband);
  const brimAt = (u: number, v: number) => {
    // Pre-curved brim: its inner edge follows the crown base over ±72°, the
    // outer edge is a broader half-ellipse, and the sheet bends down at the
    // sides and slightly forward, as seen from above in the reference photo.
    // The ends reach round to ±80° so they tuck along the crown sides.
    const a = (2 * u - 1) * 1.3,
      s = Math.sin(a),
      c = Math.cos(a);
    const inner = new Vector3(0.101 * s, base - dip(a), 0.1 * c - 0.0005);
    // Forward reach falls off faster than the crown arc: a convex front edge.
    // At the temples the brim narrows to the crown radius, so its end never
    // shows as a strip beside the crown in a front view.
    const outer = new Vector3((0.101 + 0.005 * Math.max(0, c)) * s, base - dip(a), 0.1 * c + 0.068 * Math.max(0, c) ** 2.6);
    const p = inner.clone().lerp(outer, v);
    // Rigid forward pitch (≈ 27°) about the seam plus the pre-curve that bends
    // the extreme sides down; together they give the convex front arc.
    p.y -= (p.z - inner.z) * 0.5 + 0.008 * s ** 6 * v - 0.0022 * Math.sin(Math.PI * v) * c;
    return p;
  };
  const brim = grid(160, 72, brimAt, undefined, true);
  details.push(brim, lining(brim, 0.0028));
  const brimOutline = [
    ...Array.from({ length: 161 }, (_, i) => brimAt(i / 160, 1)),
    ...Array.from({ length: 159 }, (_, i) => brimAt(1 - (i + 1) / 160, 0)),
  ];
  details.push(thread(brimOutline, 0.0006, 320, true));
  // Eight rows of topstitching, each a constant distance from the front edge,
  // so they follow its convex arc and end where the brim narrows.
  const reach = (u: number) => brimAt(u, 1).distanceTo(brimAt(u, 0));
  for (let row = 0; row < 8; row++) {
    const d = 0.0045 + row * 0.0042;
    let lo = 0.5;
    while (lo > 0.02 && reach(lo) > d / 0.9) lo -= 0.002;
    details.push(
      stitches((t) => {
        const u = lo + (1 - 2 * lo) * t;
        return brimAt(u, 1 - d / reach(u)).add(new Vector3(0, 0.0005, 0));
      }, 150, 0.00013),
    );
  }
  // The adjustment strap extends past both edges of the rear opening and is
  // sewn onto the crown, instead of floating below the cutout.
  const rearStrap = [
    [-0.052, 0.042, -0.084],
    [-0.032, 0.042, -0.097],
    [0, 0.042, -0.105],
    [0.033, 0.042, -0.097],
    [0.052, 0.042, -0.084],
  ];
  details.push(strap(rearStrap, 0.016, 0.0014, 0.01));
  for (const side of [-1, 1])
    details.push(stitches((t) => new Vector3(side * 0.05, 0.036 + 0.012 * t, -0.087), 7, 0.00018));
  // One flat metal slider on the strap instead of thin wire frames.
  const slider = new BoxGeometry(0.017, 0.015, 0.0018);
  slider.translate(0.021, 0.042, -0.1035);
  details.push(slider);
  // Fabric-covered button: broader, low dome sunk into the crown.
  const button = new SphereGeometry(0.0066, 32, 16);
  button.scale(1, 0.34, 1);
  button.translate(0, base + height + 0.0006, -0.004);
  details.push(button);
  return { front, details: merge(details), lining: merge(inner) };
}

/** Offline-built accessory meshes; physical print coordinates are unchanged. */
export function createCatalogAccessory(product: ProductDefinition): CatalogGeometry {
  if (product.kind === 'tote') return tote(product);
  if (product.kind === 'apron') return apron(product);
  if (product.kind === 'cap') return cap(product);
  throw new Error(`Unsupported accessory: ${product.id}`);
}
