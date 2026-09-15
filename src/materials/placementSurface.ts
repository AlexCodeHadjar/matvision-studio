import { Color, MeshStandardMaterial, SRGBColorSpace } from 'three';
import type { PlacementSurface } from '../contracts';
import { createDataMap } from './microtexture';

const SIZE = 512;
const TILE_METRES = 0.6;

const SETTINGS: Record<PlacementSurface, { color: string; roughness: number; relief: number }> = {
  studio: { color: '#d3d7d1', roughness: 0.97, relief: 0.015 },
  'white-desk': { color: '#e5e3df', roughness: 0.82, relief: 0.025 },
  graphite: { color: '#45494c', roughness: 0.91, relief: 0.045 },
  oak: { color: '#c59a69', roughness: 0.79, relief: 0.14 },
  walnut: { color: '#765039', roughness: 0.8, relief: 0.12 },
  concrete: { color: '#b7b6b1', roughness: 0.98, relief: 0.18 },
};

/** Periodic value noise keeps the 60 cm material tile seamless at every mip level. */
function noise(x: number, y: number, nx: number, ny: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const hash = (a: number, b: number) => {
    let n = Math.imul(((a % nx) + nx) % nx, 374761393) + Math.imul(((b % ny) + ny) % ny, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const sx = smooth(x - ix),
    sy = smooth(y - iy);
  const low = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
  const high = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
  return low * (1 - sy) + high * sy;
}

/** Owns a single reusable set of maps, including after repeated surface selection. */
export function createPlacementSurfaceMaterial(planeMetres: number, anisotropy: number) {
  const colorBytes = new Uint8Array(SIZE * SIZE * 4);
  const normalBytes = new Uint8Array(SIZE * SIZE * 4);
  const roughnessBytes = new Uint8Array(SIZE * SIZE * 4);
  const colorMap = createDataMap(colorBytes, SIZE);
  const normalMap = createDataMap(normalBytes, SIZE);
  const roughnessMap = createDataMap(roughnessBytes, SIZE);
  colorMap.colorSpace = SRGBColorSpace;
  for (const map of [colorMap, normalMap, roughnessMap]) {
    map.repeat.set(planeMetres / TILE_METRES, planeMetres / TILE_METRES);
    map.anisotropy = anisotropy;
  }
  const material = new MeshStandardMaterial({
    map: colorMap,
    normalMap,
    roughnessMap,
    roughness: 0.97,
    metalness: 0,
  });
  let current: PlacementSurface | undefined;
  const update = (preset: PlacementSurface, studioColor: string) => {
    const settings = SETTINGS[preset];
    material.color.set(preset === 'studio' ? studioColor : '#ffffff');
    material.roughness = settings.roughness;
    material.normalScale.setScalar(settings.relief);
    if (current === preset) return;
    current = preset;
    // Convert to sRGB bytes because Three decodes the albedo map to linear light.
    const base = new Color(preset === 'studio' ? '#ffffff' : settings.color).convertLinearToSRGB();
    const heights = new Float32Array(SIZE * SIZE);
    const wood = preset === 'oak' || preset === 'walnut';
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE,
          v = y / SIZE;
        const grain = noise(u * 128, v * 128, 128, 128);
        let shade = 1,
          height = grain * 0.08;
        if (wood) {
          const warp = noise(u * 4, v * 8, 4, 8);
          const broad = noise(u * 3, v * 20, 3, 20);
          const phase = 2 * Math.PI * (v * 48 + (warp - 0.5) * 1.4);
          const ring = Math.pow(0.5 + 0.5 * Math.sin(phase), 9);
          const pores = noise(u * 48, v * 256, 48, 256);
          shade = 1.02 + (broad - 0.5) * 0.22 - ring * 0.15 + (pores - 0.5) * 0.06;
          height = broad * 0.2 - ring * 0.26 + pores * 0.1;
        } else if (preset === 'concrete') {
          const cloud = noise(u * 8, v * 8, 8, 8);
          const aggregate = noise(u * 32, v * 32, 32, 32);
          shade = 0.98 + (cloud - 0.5) * 0.13 + (aggregate - 0.5) * 0.08 + (grain - 0.5) * 0.05;
          height = aggregate * 0.3 + grain * 0.2;
        } else {
          shade = 1 + (grain - 0.5) * (preset === 'studio' ? 0 : 0.012);
        }
        const i = (y * SIZE + x) * 4;
        colorBytes.set(
          [
            Math.min(255, Math.round(base.r * 255 * shade)),
            Math.min(255, Math.round(base.g * 255 * shade)),
            Math.min(255, Math.round(base.b * 255 * shade)),
            255,
          ],
          i,
        );
        const rough = Math.round(244 + grain * 11);
        roughnessBytes.set([rough, rough, rough, 255], i);
        heights[y * SIZE + x] = height;
      }
    }
    const at = (x: number, y: number) => heights[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 3;
        const dy = (at(x, y + 1) - at(x, y - 1)) * 3;
        const length = Math.hypot(dx, dy, 1);
        normalBytes.set(
          [
            Math.round(127.5 - (127.5 * dx) / length),
            Math.round(127.5 - (127.5 * dy) / length),
            Math.round(127.5 + 127.5 / length),
            255,
          ],
          (y * SIZE + x) * 4,
        );
      }
    }
    for (const map of [colorMap, normalMap, roughnessMap]) map.needsUpdate = true;
  };
  return {
    material,
    update,
    ownedTextureBytes: (3 * SIZE * SIZE * 4 * 4) / 3,
    dispose() {
      colorMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      material.dispose();
    },
  };
}
