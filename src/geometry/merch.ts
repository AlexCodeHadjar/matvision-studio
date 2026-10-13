import {
  BufferGeometry,
  CatmullRomCurve3,
  CubicBezierCurve3,
  CurvePath,
  Float32BufferAttribute,
  LatheGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { ProductDefinition } from '../contracts';

function mugProfile(r: number, h: number) {
  const anchors = [
    [0, 0.0022],
    [r - 0.011, 0.0022],
    [r - 0.0075, 0.0011],
    [r - 0.0035, 0.0011],
    [r - 0.0018, 0.00135],
    [r - 0.00055, 0.002],
    [r - 0.00008, 0.0034],
    [r, 0.006],
    [r, 0.03],
    [r, 0.06],
    [r, 0.087],
    [r - 0.00015, h - 0.0024],
    [r - 0.0005, h - 0.0009],
    [r - 0.0012, h],
    [r - 0.002, h + 0.00015],
    [r - 0.0028, h - 0.00035],
    [r - 0.00345, h - 0.0014],
    [r - 0.0038, h - 0.003],
    [r - 0.0038, 0.025],
    [r - 0.004, 0.015],
    [r - 0.005, 0.01],
    [r - 0.008, 0.0078],
    [r - 0.012, 0.007],
    [0, 0.007],
  ];
  const curve = new CatmullRomCurve3(
    anchors.map(([x, y]) => new Vector3(x!, y!, 0)),
    false,
    'centripetal',
  );
  return curve.getPoints(288).map((p) => new Vector2(Math.max(0, p.x), p.y));
}

/** A continuous ceramic profile joins the exterior, rolled lip, inner bowl and foot.
 * Shared vertices/normals remove the old separate-rim shading seam. */
export function createMugWall(product: ProductDefinition) {
  const r = product.mugDiameterMm! / 2000,
    h = product.heightMm / 1000,
    points = mugProfile(r, h);
  const g = new LatheGeometry(points, 256);
  g.rotateY(Math.PI / 2);
  // Only the straight exterior is printable. Interior and foot sample the blank handle seam.
  const outerEnd = points.findIndex((p) => p.y >= h - 0.002);
  const n = points.length;
  // Split only UVs, retaining the shared smooth geometric normals. No triangle may
  // interpolate from a printed UV to the blank interior across the whole artwork.
  const result = g.toNonIndexed(),
    uv = result.getAttribute('uv'),
    index = g.index!;
  for (let i = 0; i < uv.count; i += 3) {
    const rows = [index.getX(i) % n, index.getX(i + 1) % n, index.getX(i + 2) % n];
    const printed = rows.every(
      (row) => row <= outerEnd && points[row]!.y >= 0.004 && points[row]!.x > r - 0.002,
    );
    for (let j = 0; j < 3; j++)
      if (printed) uv.setY(i + j, points[rows[j]!]!.y / h);
      else uv.setXY(i + j, 0, 0);
  }
  g.dispose();
  return result;
}

export function createMugParts(product: ProductDefinition) {
  const r = product.mugDiameterMm! / 2000,
    h = product.heightMm / 1000,
    scale = h / 0.095,
    thickness = 0.0038 * scale,
    depth = 0.0044 * scale,
    fillet = 0.0032 * scale,
    upperRoot = 0.0765 * scale,
    lowerRoot = 0.02 * scale;
  // The reference is a tall oval C, with a 7.6 mm ceramic band and a
  // 27.4 mm-wide opening. Cubic arcs keep the crown, outside and lower
  // bend tangent-continuous instead of forming the old short D shape.
  const p = (x: number, y: number) => new Vector3(r + x * scale, y * scale, 0);
  const profile = mugProfile(r, h),
    outerEnd = profile.findIndex((v) => v.y >= h - 0.002);
  const surfaceX = (y: number, z: number) => {
    let radius = r;
    for (let j = 1; j <= outerEnd; j++) {
      const a = profile[j - 1]!,
        b = profile[j]!;
      if (a.y <= y && b.y >= y) {
        radius = a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y));
        break;
      }
    }
    // Match the 256-sided lathe itself, including its minute profile bulge.
    // A perfect-cylinder projection leaves a visible cut where the root
    // emerges through the differently curved wall.
    const step = Math.PI / 128,
      angle = Math.asin(Math.max(-1, Math.min(1, z / radius))),
      mid = (Math.floor(angle / step) + 0.5) * step;
    return (radius * Math.cos(step / 2) - z * Math.sin(mid)) / Math.cos(mid);
  };
  const path = new CurvePath<Vector3>();
  path.add(
    new CubicBezierCurve3(
      p(0.0032, 0.0792),
      p(0.0205, 0.0792),
      p(0.0312, 0.0658),
      p(0.0312, 0.0483),
    ),
  );
  path.add(
    new CubicBezierCurve3(
      p(0.0312, 0.0483),
      p(0.0312, 0.0308),
      p(0.0205, 0.0174),
      p(0.0032, 0.0174),
    ),
  );
  const positions: number[] = [],
    uv: number[] = [],
    ix: number[] = [],
    along = 256,
    around = 48,
    rootSteps = 48;
  let rings = 0;
  const ring = (point: (c: number, s: number) => Vector3) => {
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a),
        q = point(c, s);
      positions.push(q.x, q.y, q.z);
      // The handle uses its own blank ceramic material, never the print map.
      uv.push(i / around, rings / (along + 2 * rootSteps));
    }
    rings++;
  };
  const rootRing = (u: number, y: number, direction: number, rise: number) => {
    const blend = u / (Math.PI / 2),
      fade = 1 - blend ** 3 * (10 - 15 * blend + 6 * blend * blend),
      extension = fillet * (1 - Math.cos(u)) ** 2,
      round = fillet * (1 - Math.sin(u));
    ring((c, s) => {
      const z = (depth + 0.0014 * scale * (1 - Math.sin(u))) * s,
        py = y + direction * (rise * Math.sin(u) + (thickness + round) * c),
        wallX = surfaceX(py, z);
      // A quarter-round fillet begins tangent to the actual cylinder and
      // ends tangent to the tube. The tiny buried boundary avoids z-fighting.
      return new Vector3(r + extension - (r - wallX + 0.000001 * scale) * fade, py, z);
    });
  };
  // The root moves towards the crown while the fillet tapers. Its outside
  // contour therefore flows into the oval without the old pinched S bend.
  for (let j = 0; j < rootSteps; j++)
    rootRing(((j / rootSteps) * Math.PI) / 2, upperRoot, 1, 0.0027 * scale);
  for (let j = 0; j <= along; j++) {
    const t = j / along,
      center = path.getPointAt(t),
      tangent = path.getTangentAt(t),
      n = new Vector3(-tangent.y, tangent.x, 0).normalize();
    ring(
      (c, s) =>
        new Vector3(center.x + n.x * c * thickness, center.y + n.y * c * thickness, s * depth),
    );
  }
  for (let j = 1; j <= rootSteps; j++)
    rootRing(((1 - j / rootSteps) * Math.PI) / 2, lowerRoot, -1, 0.0026 * scale);
  for (let j = 0; j < rings - 1; j++)
    for (let i = 0; i < around; i++) {
      const a = j * (around + 1) + i,
        b = a + 1,
        c = a + around + 1;
      ix.push(a, b, c, b, c + 1, c);
    }
  const handle = new BufferGeometry();
  handle.setAttribute('position', new Float32BufferAttribute(positions, 3));
  handle.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  handle.setIndex(ix);
  handle.computeVertexNormals();
  const ns = handle.getAttribute('normal');
  const hp = handle.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i),
      y = hp.getY(i),
      z = hp.getZ(i),
      distance = x - surfaceX(y, z),
      t = Math.max(0, Math.min(1, distance / (0.00065 * scale)));
    if (t < 1) {
      const n = new Vector3(x, 0, z)
        .normalize()
        .lerp(new Vector3(ns.getX(i), ns.getY(i), ns.getZ(i)), t * t * (3 - 2 * t))
        .normalize();
      ns.setXYZ(i, n.x, n.y, n.z);
    }
  }
  for (const j of [0, rings - 1])
    for (let k = 0; k <= around; k++) {
      const i = j * (around + 1) + k,
        x = hp.getX(i),
        z = hp.getZ(i),
        radial = Math.hypot(x, z);
      ns.setXYZ(i, x / radial, 0, z / radial);
    }
  for (let j = 0; j < rings; j++) {
    const a = j * (around + 1),
      b = a + around,
      n = new Vector3(
        ns.getX(a) + ns.getX(b),
        ns.getY(a) + ns.getY(b),
        ns.getZ(a) + ns.getZ(b),
      ).normalize();
    ns.setXYZ(a, n.x, n.y, n.z);
    ns.setXYZ(b, n.x, n.y, n.z);
  }
  return { handle };
}
