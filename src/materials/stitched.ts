import { MeshPhysicalMaterial } from 'three';
import { createDataMap } from './microtexture';

/** Requires perimeter U and across-band V from the stitched-edge geometry. */
export function createStitchedMaterial(perimeterM: number) {
  if (!Number.isFinite(perimeterM) || perimeterM <= 0) {
    throw new RangeError('Stitch perimeter must be positive SI metres.');
  }
  const size = 128;
  const normalData = new Uint8Array(size * size * 4);
  const height = (u: number, v: number) => {
    const across = Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.6);
    const yarn = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (u - v * 0.32)), 1.8);
    const filament = 0.045 * Math.sin(2 * Math.PI * (u * 9 + v * 3));
    return across * yarn + filament;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const step = 1 / size;
      const dx = (height(u + step, v) - height(u - step, v)) * 9;
      const dy = (height(u, v + step) - height(u, v - step)) * 3;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normalData[i] = Math.round((0.5 - (0.5 * dx) / length) * 255);
      normalData[i + 1] = Math.round((0.5 - (0.5 * dy) / length) * 255);
      normalData[i + 2] = Math.round((0.5 + 0.5 / length) * 255);
      normalData[i + 3] = 255;
    }
  }
  const normal = createDataMap(normalData, size);
  const material = new MeshPhysicalMaterial({
    color: '#252827',
    roughness: 0.94,
    metalness: 0,
    normalMap: normal,
    sheen: 0.2,
    sheenColor: '#b7b7b7',
    sheenRoughness: 0.95,
    specularIntensity: 0.35,
  });
  material.name = 'MatVision stitched binding';
  material.normalScale.setScalar(0.8);
  let disposed = false;
  const controller = {
    material,
    get ownedTextureBytes() {
      return disposed ? 0 : Math.ceil(normalData.byteLength * (4 / 3));
    },
    update(nextPerimeterM: number) {
      if (!Number.isFinite(nextPerimeterM) || nextPerimeterM <= 0) {
        throw new RangeError('Stitch perimeter must be positive SI metres.');
      }
      // An integer repeat closes the seam; stitch pitch remains approximately 1.8 mm.
      normal.repeat.set(Math.max(1, Math.round(nextPerimeterM / 0.0018)), 1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      normal.dispose();
      material.dispose();
    },
  };
  controller.update(perimeterM);
  return controller;
}
