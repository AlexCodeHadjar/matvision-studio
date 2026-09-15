import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearSRGBColorSpace,
  RGBAFormat,
  PMREMGenerator,
  type WebGLRenderer,
} from 'three';

/** Copyright-free HDR radiance panorama: diffuse room and three broad studio softboxes.
 * Values >1 are actual scene-linear radiance, not an LDR image relabelled as HDR.
 */
export function generateStudioRadiance(width: number, height: number): Float32Array {
  const data = new Float32Array(width * height * 4);
  // DataTexture has flipY=false: Three's equirectUv maps +Y to v=1.
  // Store ceiling light in the upper hemisphere, where an upward fabric normal sees it.
  const lights = [
    [0.2, 0.72, 0.075, 0.1, 5],
    [0.7, 0.68, 0.12, 0.08, 2.8],
    [0.5, 0.88, 0.2, 0.06, 1.8],
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      let radiance = 0.18 + 0.28 * v;
      for (const [cx = 0, cy = 0, sx = 1, sy = 1, power = 1] of lights) {
        const du = Math.min(Math.abs(u - cx), 1 - Math.abs(u - cx));
        radiance += power * Math.exp(-Math.pow(du / sx, 6) - Math.pow((v - cy) / sy, 6));
      }
      const i = (y * width + x) * 4;
      data[i] = radiance;
      data[i + 1] = radiance;
      data[i + 2] = radiance;
      data[i + 3] = 1;
    }
  return data;
}

export function createStudioEnvironment(renderer: WebGLRenderer) {
  const width = 512,
    height = 256;
  const data = generateStudioRadiance(width, height);
  const hdr = new DataTexture(data, width, height, RGBAFormat, FloatType);
  hdr.mapping = EquirectangularReflectionMapping;
  hdr.colorSpace = LinearSRGBColorSpace;
  hdr.needsUpdate = true;
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(hdr);
  hdr.dispose();
  generator.dispose();
  return target;
}
