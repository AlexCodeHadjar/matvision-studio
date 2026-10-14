import { createDataMap } from './microtexture';

/** Small, tileable relief for woven canvas, diagonal twill and polo pique. */
export function createCatalogFabricMaps(kind: string, widthM: number, heightM: number) {
  const size = 128,
    normal = new Uint8Array(size * size * 4),
    rough = new Uint8Array(normal.length);
  const height = (u: number, v: number) => {
    const x = u * Math.PI * 16,
      y = v * Math.PI * 16;
    if (kind === 'polo') return 0.2 * Math.cos(x) * Math.cos(y) + 0.08 * Math.sin(x * 2 + y);
    if (kind === 'cap') return 0.22 * Math.sin(x - y) + 0.06 * Math.cos(x * 2 + y);
    return 0.14 * Math.cos(x) + 0.14 * Math.cos(y) + 0.1 * Math.cos(x * 0.5) * Math.cos(y * 0.5);
  };
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = i / size,
        v = j / size,
        e = 1 / size;
      const dx = (height(u + e, v) - height(u - e, v)) * 0.7,
        dy = (height(u, v + e) - height(u, v - e)) * 0.7;
      const len = Math.hypot(dx, dy, 1),
        o = (j * size + i) * 4;
      normal.set(
        [
          Math.round(128 - (127 * dx) / len),
          Math.round(128 - (127 * dy) / len),
          Math.round(128 + 127 / len),
          255,
        ],
        o,
      );
      const r = Math.round(230 + 12 * height(u, v));
      rough.set([r, r, r, 255], o);
    }
  const maps = { normal: createDataMap(normal, size), roughness: createDataMap(rough, size) };
  // Eight repeats per tile: ≈ 1.5 mm piqué cells, ≈ 1.2 mm canvas/twill ribs,
  // coarse enough to read in catalogue views like the reference photos.
  const tile = kind === 'polo' ? 0.012 : kind === 'cap' ? 0.007 : 0.0095;
  for (const map of Object.values(maps)) map.repeat.set(widthM / tile, heightM / tile);
  return maps;
}
