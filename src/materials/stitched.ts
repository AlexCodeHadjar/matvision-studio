import { MeshPhysicalMaterial } from 'three';
import { createDataMap } from './microtexture';
import { STITCH_PITCH_M } from '../geometry/stitch';

/** Distant sewn binding and close-range twisted yarn share the same physical stitch pitch. */
export function createStitchedMaterial(perimeterM: number) {
  const size = 128;
  function normalMap(height: (u: number, v: number) => number, strength: number) {
    const data = new Uint8Array(size * size * 4);
    const step = 1 / size;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x / size,
          v = y / size;
        const dx = (height(u + step, v) - height(u - step, v)) * strength;
        const dy = (height(u, v + step) - height(u, v - step)) * strength;
        const length = Math.hypot(dx, dy, 1),
          i = (y * size + x) * 4;
        data[i] = Math.round(127.5 - (127.5 * dx) / length);
        data[i + 1] = Math.round(127.5 - (127.5 * dy) / length);
        data[i + 2] = Math.round(127.5 + 127.5 / length);
        data[i + 3] = 255;
      }
    return createDataMap(data, size);
  }
  const tau = Math.PI * 2;
  const normal = normalMap((u, v) => {
    const yarn = Math.pow(0.5 + 0.5 * Math.cos(tau * (u - 0.28 * Math.sin(tau * v))), 1.8);
    const filaments = 0.09 * Math.cos(tau * (u * 5 + v * 9));
    return yarn + filaments;
  }, 6);
  const ply = normalMap(
    (u, v) => 0.32 * Math.cos(tau * (v * 3 - u)) + 0.075 * Math.cos(tau * (v * 9 - u * 3)),
    6,
  );
  ply.repeat.set(20, 1);
  const material = new MeshPhysicalMaterial({
    color: '#151817',
    roughness: 0.9,
    metalness: 0,
    normalMap: normal,
    sheen: 0.14,
    sheenColor: '#878c87',
    sheenRoughness: 0.87,
    specularIntensity: 0.3,
  });
  material.name = 'MatVision full-wrap overlock binding';
  material.normalScale.setScalar(0.9);
  const threadMaterial = new MeshPhysicalMaterial({
    color: '#343a35',
    roughness: 0.76,
    metalness: 0,
    normalMap: ply,
    sheen: 0.22,
    sheenColor: '#a5ada4',
    sheenRoughness: 0.8,
    specularIntensity: 0.48,
  });
  threadMaterial.name = 'MatVision interlocking three-ply overlock yarn';
  threadMaterial.normalScale.setScalar(0.6);
  let disposed = false;
  const controller = {
    material,
    threadMaterial,
    get ownedTextureBytes() {
      return disposed ? 0 : Math.ceil((size * size * 4 * 2 * 4) / 3);
    },
    update(nextPerimeterM: number) {
      if (!Number.isFinite(nextPerimeterM) || nextPerimeterM <= 0)
        throw new RangeError('Stitch perimeter must be positive SI metres.');
      normal.repeat.set(Math.max(1, Math.round(nextPerimeterM / STITCH_PITCH_M)), 1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      normal.dispose();
      ply.dispose();
      material.dispose();
      threadMaterial.dispose();
    },
  };
  controller.update(perimeterM);
  return controller;
}
