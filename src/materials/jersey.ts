import { createDataMap } from './microtexture';

/** Periodic stockinette loops, about 0.5 mm per stitch. No artwork is baked into normals. */
export function createJerseyMaps(size = 256, rib = false) {
  const normal = new Uint8Array(size * size * 4),
    roughness = new Uint8Array(normal.length);
  const height = (u: number, v: number) => {
    const row = v * 8 + 0.025 * Math.sin(u * Math.PI * 4),
      y = row - Math.floor(row),
      col = u * 8 + 0.018 * Math.sin(v * Math.PI * 6) + 0.012 * Math.cos(v * Math.PI * 14);
    const x = col - Math.floor(col) - 0.5;
    const leg = Math.abs(x) - (0.045 + 0.4 * y);
    const yarn = Math.exp(-Math.pow(leg / 0.075, 2));
    const fibers =
      0.028 *
      Math.sin(u * Math.PI * 126 + v * Math.PI * 74) *
      Math.sin(v * Math.PI * 110 - u * Math.PI * 22);
    return (
      (rib ? 0.22 : 0.5) * yarn +
      fibers +
      (rib ? 0.5 * Math.pow(0.5 + 0.5 * Math.cos(u * Math.PI * 8), 2) : 0)
    );
  };
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = i / size,
        v = j / size,
        s = 1 / size,
        dx = (height(u + s, v) - height(u - s, v)) * 1.3,
        dy = (height(u, v + s) - height(u, v - s)) * 1.3,
        len = Math.hypot(dx, dy, 1),
        p = (j * size + i) * 4;
      normal[p] = Math.round(128 - (127 * dx) / len);
      normal[p + 1] = Math.round(128 - (127 * dy) / len);
      normal[p + 2] = Math.round(128 + 127 / len);
      normal[p + 3] = 255;
      const value = Math.round(236 + 15 * Math.min(1, height(u, v)));
      roughness[p] = roughness[p + 1] = roughness[p + 2] = value;
      roughness[p + 3] = 255;
    }
  return { normal: createDataMap(normal, size), roughness: createDataMap(roughness, size) };
}
