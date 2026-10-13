import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import type { MaterialPreset } from '../contracts';

export interface FabricPresetSettings {
  roughness: number;
  normalStrength: number;
  tileMm: number;
  sheen: number;
}

export const FABRIC_PRESETS: Readonly<Record<MaterialPreset, FabricPresetSettings>> = {
  'smooth-cloth': { roughness: 0.84, normalStrength: 0.13, tileMm: 2.4, sheen: 0.12 },
  'fine-weave': { roughness: 0.88, normalStrength: 0.27, tileMm: 4, sheen: 0.18 },
  'gaming-fabric': { roughness: 0.92, normalStrength: 0.34, tileMm: 4.8, sheen: 0.15 },
};

const TAU = Math.PI * 2;

/** Periodic crossed yarns with alternating over/under crossings. No artwork pixels are involved. */
function fabricHeight(u: number, v: number, preset: MaterialPreset): number {
  // Periodic, deterministic yarn waviness avoids a perfectly machined grid.
  const x = u * 8 + 0.035 * Math.sin(TAU * v * 3) + 0.018 * Math.sin(TAU * v * 7);
  const y = v * 8 + 0.032 * Math.sin(TAU * u * 2) + 0.017 * Math.cos(TAU * u * 5);
  const warp = Math.pow(0.5 + 0.5 * Math.cos(TAU * x), 1.5);
  const weft = Math.pow(0.5 + 0.5 * Math.cos(TAU * y), 1.5);
  const crossing = Math.cos(Math.PI * x) * Math.cos(Math.PI * y);
  const twill = preset === 'gaming-fabric' ? 0.08 * Math.cos(TAU * (u + v) * 8) : 0;
  const yarnFilaments = 0.025 * Math.cos(TAU * u * 32) * Math.cos(TAU * v * 32);
  const density = 1 + 0.04 * Math.sin(TAU * u * 3) * Math.cos(TAU * v * 5);
  return density * (0.4 * (warp + weft) + 0.18 * crossing * (warp - weft)) + twill + yarnFilaments;
}

/** CPU arrays are retained so Three can upload them again after WebGL context restoration. */
export function generateFabricMaps(preset: MaterialPreset, size = 128) {
  if (!Number.isInteger(size) || size < 32 || size > 1024 || (size & (size - 1)) !== 0) {
    throw new RangeError('Fabric map size must be a power of two from 32 to 1024.');
  }
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const step = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = (fabricHeight(u + step, v, preset) - fabricHeight(u - step, v, preset)) * 1.5;
      const dy = (fabricHeight(u, v + step, preset) - fabricHeight(u, v - step, preset)) * 1.5;
      const length = Math.hypot(dx, dy, 1);
      const index = (y * size + x) * 4;
      normal[index] = Math.round((0.5 - (0.5 * dx) / length) * 255);
      normal[index + 1] = Math.round((0.5 - (0.5 * dy) / length) * 255);
      normal[index + 2] = Math.round((0.5 + 0.5 / length) * 255);
      normal[index + 3] = 255;
      const value = Math.round(244 + 11 * Math.min(1, Math.max(0, fabricHeight(u, v, preset))));
      roughness[index] = value;
      roughness[index + 1] = value;
      roughness[index + 2] = value;
      roughness[index + 3] = 255;
    }
  }
  return { normal, roughness, size };
}

export function createDataMap(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createFabricMaps(preset: MaterialPreset) {
  const data = generateFabricMaps(preset);
  return {
    normal: createDataMap(data.normal, data.size),
    roughness: createDataMap(data.roughness, data.size),
    approximateBytes: Math.ceil((data.normal.byteLength + data.roughness.byteLength) * (4 / 3)),
  };
}
