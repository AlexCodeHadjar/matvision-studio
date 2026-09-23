import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearSRGBColorSpace,
  RGBAFormat,
  PMREMGenerator,
  type WebGLRenderer,
} from 'three';
import type { EnvironmentPreset } from '../contracts';
export { getEnvironmentSettings } from '../scene-core/lighting';

interface RadianceSettings {
  diffuse: number;
  ceiling: number;
  tint: readonly [number, number, number];
  lights: readonly (readonly [number, number, number, number, number])[];
}

const RADIANCE_SETTINGS: Readonly<Record<EnvironmentPreset, RadianceSettings>> = {
  'neutral-studio': {
    diffuse: 0.18,
    ceiling: 0.28,
    tint: [1, 1, 1],
    lights: [
      [0.16, 0.7, 0.11, 0.11, 3.8],
      [0.68, 0.67, 0.15, 0.1, 1.9],
      [0.48, 0.87, 0.22, 0.07, 1.3],
    ],
  },
  'bright-studio': {
    diffuse: 0.24,
    ceiling: 0.34,
    tint: [1, 1, 1],
    lights: [
      [0.2, 0.75, 0.13, 0.12, 5.8],
      [0.7, 0.7, 0.16, 0.1, 3.4],
      [0.45, 0.9, 0.24, 0.07, 2.2],
    ],
  },
  'warm-room': {
    diffuse: 0.16,
    ceiling: 0.24,
    // Scene-linear RGB illumination; no gamma decode is applied to this radiance.
    tint: [1.15, 0.96, 0.75],
    lights: [
      [0.15, 0.69, 0.13, 0.15, 4.6],
      [0.65, 0.76, 0.1, 0.09, 2.5],
      [0.48, 0.88, 0.21, 0.08, 1.4],
    ],
  },
  'desk-setup': {
    diffuse: 0.12,
    ceiling: 0.26,
    tint: [0.94, 0.98, 1.08],
    lights: [
      [0.35, 0.73, 0.14, 0.12, 4.8],
      [0.78, 0.65, 0.1, 0.08, 2.1],
      [0.57, 0.88, 0.2, 0.06, 1.8],
    ],
  },
};

/** Copyright-free HDR radiance panorama: diffuse room and three broad studio softboxes.
 * Values >1 are actual scene-linear radiance, not an LDR image relabelled as HDR.
 */
export function generateStudioRadiance(
  width: number,
  height: number,
  preset: EnvironmentPreset = 'neutral-studio',
): Float32Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 2048
  ) {
    throw new RangeError('HDR dimensions must be positive integers up to 4096 × 2048.');
  }
  const data = new Float32Array(width * height * 4);
  // DataTexture has flipY=false: Three's equirectUv maps +Y to v=1.
  // Store ceiling light in the upper hemisphere, where an upward fabric normal sees it.
  const settings = RADIANCE_SETTINGS[preset];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      let radiance = settings.diffuse + settings.ceiling * v;
      for (const [cx, cy, sx, sy, power] of settings.lights) {
        const du = Math.min(Math.abs(u - cx), 1 - Math.abs(u - cx));
        radiance += power * Math.exp(-Math.pow(du / sx, 6) - Math.pow((v - cy) / sy, 6));
      }
      const i = (y * width + x) * 4;
      data[i] = radiance * settings.tint[0];
      data[i + 1] = radiance * settings.tint[1];
      data[i + 2] = radiance * settings.tint[2];
      data[i + 3] = 1;
    }
  return data;
}

export function createStudioEnvironment(
  renderer: WebGLRenderer,
  preset: EnvironmentPreset = 'neutral-studio',
  resolution = 512,
) {
  if (
    !Number.isInteger(resolution) ||
    resolution < 128 ||
    resolution > 2048 ||
    (resolution & (resolution - 1)) !== 0
  ) {
    throw new RangeError('HDR width must be a power of two from 128 to 2048.');
  }
  const width = resolution;
  const height = resolution / 2;
  const data = generateStudioRadiance(width, height, preset);
  const hdr = new DataTexture(data, width, height, RGBAFormat, FloatType);
  hdr.mapping = EquirectangularReflectionMapping;
  hdr.colorSpace = LinearSRGBColorSpace;
  hdr.needsUpdate = true;
  const generator = new PMREMGenerator(renderer);
  try {
    const target = generator.fromEquirectangular(hdr);
    target.texture.name = `MatVision ${preset} PMREM`;
    return target;
  } finally {
    hdr.dispose();
    generator.dispose();
  }
}
