import { BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedMesh } from 'three';

interface RestGeometry {
  geometry: BufferGeometry;
  positions: Float32Array;
  normals: Float32Array;
}

/** Arc-length parameterized inward spiral. The outer tangent joins the flat mat. */
export function createRollMapping(
  height: number,
  thickness: number,
  amount: number,
  stitched: boolean,
) {
  const value = Math.max(0, Math.min(1, amount));
  const rolledLength = height * value;
  const bendZ = -height / 2 + rolledLength;
  const mid = thickness / 2;
  // Separation includes the padded seam and a little air between adjacent turns.
  const b = (thickness + (stitched ? 0.0012 : 0.0005)) / (2 * Math.PI);
  const core = Math.max(0.018, thickness * 4);
  const primitive = (r: number) => 0.5 * (r * Math.hypot(r, b) + b * b * Math.asinh(r / b));
  const target = primitive(core) + b * rolledLength;
  let outer = Math.sqrt(core * core + 2 * b * rolledLength);
  for (let i = 0; i < 4; i++) outer -= (primitive(outer) - target) / Math.hypot(outer, b);
  const start = primitive(outer);
  const alpha = Math.atan2(b, outer),
    ca = Math.cos(alpha),
    sa = Math.sin(alpha);
  const cache = new Map<number, readonly [number, number, number, number]>();
  const frame = (z: number): readonly [number, number, number, number] => {
    const cached = cache.get(z);
    if (cached) return cached;
    const length = bendZ - z;
    if (value === 0 || length <= 0) return [mid, z, 1, 0];
    const targetAt = start - b * length;
    let radius = Math.sqrt(Math.max(core * core * 0.8, outer * outer - 2 * b * length));
    for (let i = 0; i < 3; i++) radius -= (primitive(radius) - targetAt) / Math.hypot(radius, b);
    const angle = (outer - radius) / b,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const u = -radius * s,
      v = outer - radius * c;
    const du = b * s - radius * c,
      dv = b * c + radius * s;
    const speed = Math.hypot(radius, b);
    const tz = (ca * du - sa * dv) / speed,
      ty = (sa * du + ca * dv) / speed;
    const result = [mid + sa * u + ca * v, bendZ + ca * u - sa * v, -tz, ty] as const;
    cache.set(z, result);
    return result;
  };
  return { frame, mid, outerRadius: outer };
}

/** Reuses flat rest coordinates, so dragging back to zero never accumulates deformation. */
export class MatRollDeformer {
  private readonly meshes: RestGeometry[] = [];
  private threads: { mesh: InstancedMesh; matrices: Float32Array } | null = null;

  add(geometry: BufferGeometry) {
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const normals = geometry.getAttribute('normal') as BufferAttribute;
    positions.setUsage(DynamicDrawUsage);
    normals.setUsage(DynamicDrawUsage);
    this.meshes.push({
      geometry,
      positions: new Float32Array(positions.array),
      normals: new Float32Array(normals.array),
    });
  }
  addThreads(mesh: InstancedMesh) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.threads = { mesh, matrices: new Float32Array(mesh.instanceMatrix.array) };
  }
  apply(height: number, thickness: number, amount: number, stitched: boolean) {
    const { frame, mid } = createRollMapping(height, thickness, amount, stitched);
    for (const rest of this.meshes) {
      const position = rest.geometry.getAttribute('position') as BufferAttribute;
      const normal = rest.geometry.getAttribute('normal') as BufferAttribute;
      for (let i = 0; i < rest.positions.length; i += 3) {
        const x = rest.positions[i]!,
          y = rest.positions[i + 1]!,
          z = rest.positions[i + 2]!;
        const [cy, cz, c, s] = frame(z);
        position.setXYZ(i / 3, x, cy + (y - mid) * c, cz + (y - mid) * s);
        const nx = rest.normals[i]!,
          ny = rest.normals[i + 1]!,
          nz = rest.normals[i + 2]!;
        normal.setXYZ(i / 3, nx, ny * c - nz * s, ny * s + nz * c);
      }
      position.needsUpdate = true;
      normal.needsUpdate = true;
      rest.geometry.computeBoundingBox();
      rest.geometry.computeBoundingSphere();
    }
    if (this.threads) {
      const { mesh, matrices } = this.threads;
      const output = mesh.instanceMatrix.array;
      for (let i = 0; i < matrices.length; i += 16) {
        const [cy, cz, c, s] = frame(matrices[i + 14]!);
        for (const column of [0, 4, 8]) {
          const y = matrices[i + column + 1]!,
            z = matrices[i + column + 2]!;
          output[i + column] = matrices[i + column]!;
          output[i + column + 1] = y * c - z * s;
          output[i + column + 2] = y * s + z * c;
        }
        output[i + 12] = matrices[i + 12]!;
        output[i + 13] = cy + (matrices[i + 13]! - mid) * c;
        output[i + 14] = cz + (matrices[i + 13]! - mid) * s;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
