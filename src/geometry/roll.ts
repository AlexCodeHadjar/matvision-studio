import { BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedMesh } from 'three';
import type { ShowcaseAnimation } from '../contracts';

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
  private applyPositionMap(
    map: (x: number, y: number, z: number) => readonly [number, number, number],
  ) {
    for (const rest of this.meshes) {
      const position = rest.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < rest.positions.length; i += 3) {
        const [x, y, z] = map(rest.positions[i]!, rest.positions[i + 1]!, rest.positions[i + 2]!);
        position.setXYZ(i / 3, x, y, z);
      }
      position.needsUpdate = true;
      // Transient showcase bends are smooth displacement fields. Rebuilding their
      // normals is inexpensive and keeps fabric highlights attached to the surface.
      rest.geometry.computeVertexNormals();
      rest.geometry.computeBoundingBox();
      rest.geometry.computeBoundingSphere();
    }
    if (this.threads) {
      const { mesh, matrices } = this.threads;
      mesh.instanceMatrix.array.set(matrices);
      const output = mesh.instanceMatrix.array;
      for (let i = 0; i < matrices.length; i += 16) {
        const [x, y, z] = map(matrices[i + 12]!, matrices[i + 13]!, matrices[i + 14]!);
        // Apply the local derivative to every basis vector: loops follow the bend.
        const epsilon = 0.00001;
        for (const column of [0, 4, 8]) {
          const point = map(
            matrices[i + 12]! + epsilon * matrices[i + column]!,
            matrices[i + 13]! + epsilon * matrices[i + column + 1]!,
            matrices[i + 14]! + epsilon * matrices[i + column + 2]!,
          );
          output[i + column] = (point[0] - x) / epsilon;
          output[i + column + 1] = (point[1] - y) / epsilon;
          output[i + column + 2] = (point[2] - z) / epsilon;
        }
        output[i + 12] = x;
        output[i + 13] = y;
        output[i + 14] = z;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  applyShowcase(
    width: number,
    height: number,
    thickness: number,
    animation: ShowcaseAnimation,
    progress: number,
    stitched: boolean,
  ) {
    const p = Math.max(0, Math.min(1, progress));
    if (animation === 'dual-roll') {
      const amount = 0.7 * Math.sin(Math.PI * p) ** 2;
      const sideHeight = height / 2;
      const { frame, mid } = createRollMapping(sideHeight, thickness, amount, stitched);
      this.applyPositionMap((x, y, z) => {
        const sign = z < 0 ? -1 : 1;
        const localZ = sideHeight / 2 - Math.abs(z);
        const [cy, cz, c, s] = frame(localZ);
        return [x, cy + (y - mid) * c, sign * (sideHeight / 2 - (cz + (y - mid) * s))];
      });
      return;
    }
    if (animation === 'corner-lift') {
      const amount = Math.sin(Math.PI * p) ** 2;
      const reach = Math.min(width * 0.32, height * 0.5);
      const curvature = (1.85 * amount) / reach;
      const mid = thickness / 2;
      this.applyPositionMap((x, y, z) => {
        const distance = (x + width / 2 + height / 2 - z) * Math.SQRT1_2;
        const length = Math.max(0, reach - distance);
        if (length === 0 || curvature < 1e-8) return [x, y, z];
        const angle = length * curvature;
        const c = Math.cos(angle),
          sn = Math.sin(angle);
        const inset = length - sn / curvature + (y - mid) * sn;
        return [
          x + inset * Math.SQRT1_2,
          mid + (1 - c) / curvature + (y - mid) * c,
          z - inset * Math.SQRT1_2,
        ];
      });
      return;
    }
    if (animation === 'soft-wave') {
      const center = -height * 0.65 + p * height * 1.3;
      const sigma = Math.max(0.025, height * 0.12);
      this.applyPositionMap((x, y, z) => {
        const ridge = Math.exp(-((z - center) ** 2) / (2 * sigma * sigma));
        const edgeFade = Math.max(0, 1 - (Math.abs(x) / (width / 2)) ** 6);
        return [
          x,
          y + ridge * edgeFade * Math.sin(Math.PI * p) ** 2 * Math.min(0.035, height * 0.09),
          z,
        ];
      });
      return;
    }
    if (animation === 'table-drop') {
      // A moving contact line leaves the landed portion flat on the table.
      const ease = (v: number) => v * v * (3 - 2 * v);
      const lift = p < 0.22 ? ease(p / 0.22) : 1;
      const contact = p < 0.4 ? 0 : ease(Math.min(1, (p - 0.4) / 0.6));
      const altitude = 0.035 * (1 - ease(Math.max(0, Math.min(1, (p - 0.22) / 0.18))));
      this.applyPositionMap((x, y, z) => {
        const u = (z + height / 2) / height;
        const free = Math.max(0, (u - contact) / Math.max(1e-6, 1 - contact));
        return [x, y + lift * (altitude + (1 - contact) * height * 0.38 * free * free), z];
      });
      return;
    }
    this.apply(height, thickness, 0, stitched);
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
