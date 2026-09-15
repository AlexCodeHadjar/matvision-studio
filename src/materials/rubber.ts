import { MeshStandardMaterial } from 'three';
import type { ProductDefinition } from '../contracts';
import { createFabricMaps } from './microtexture';

export function createRubberMaterial(product: ProductDefinition) {
  const maps = createFabricMaps('gaming-fabric');
  let disposed = false;
  const material = new MeshStandardMaterial({
    color: '#181a1a',
    roughness: 0.97,
    metalness: 0,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
  });
  material.name = 'MatVision dark rubber backing';
  material.normalScale.setScalar(0.09);
  const controller = {
    material,
    get ownedTextureBytes() {
      return disposed ? 0 : maps.approximateBytes;
    },
    update(nextProduct: ProductDefinition) {
      for (const texture of [maps.normal, maps.roughness]) {
        texture.repeat.set(nextProduct.widthMm / 12, nextProduct.heightMm / 12);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      maps.normal.dispose();
      maps.roughness.dispose();
      material.dispose();
    },
  };
  controller.update(product);
  return controller;
}
