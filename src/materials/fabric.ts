import {
  CanvasTexture,
  MathUtils,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Texture,
} from 'three';
import { markColorTexture } from '../color/ColorPipeline';
import type { ProductDefinition, ProjectState } from '../contracts';
import { createFabricMaps, FABRIC_PRESETS } from './microtexture';
import { attachMaterialProfile } from './profile';

export function createFabricMaterial(product: ProductDefinition, state: ProjectState) {
  let preset = state.materialPreset;
  let maps = createFabricMaps(preset);
  let disposed = false;
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.88,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    clearcoat: 0,
    transmission: 0,
    ior: 1.45,
    specularIntensity: 0.28,
    sheen: FABRIC_PRESETS[preset].sheen,
    sheenColor: '#969d96',
    sheenRoughness: 0.95,
  });
  material.name = 'MatVision printed cloth';
  const profile = attachMaterialProfile(material, state.materialProfile);
  const controller = {
    material,
    get ownedTextureBytes() {
      return disposed ? 0 : maps.approximateBytes;
    },
    update(nextProduct: ProductDefinition, nextState: ProjectState) {
      if (disposed) return;
      if (nextState.materialPreset !== preset) {
        const replacement = createFabricMaps(nextState.materialPreset);
        maps.normal.dispose();
        maps.roughness.dispose();
        maps = replacement;
        preset = nextState.materialPreset;
        material.normalMap = maps.normal;
        material.roughnessMap = maps.roughness;
      }
      const settings = FABRIC_PRESETS[preset];
      // Geometry UVs measure the printable area, including extensions past its bounds.
      // A weave tile retains its millimetre size regardless of artwork crop or scale.
      for (const texture of [maps.normal, maps.roughness]) {
        texture.repeat.set(
          nextProduct.printableArea.widthMm / settings.tileMm,
          nextProduct.printableArea.heightMm / settings.tileMm,
        );
        texture.offset.set(
          nextProduct.printableArea.xMm / settings.tileMm,
          (nextProduct.heightMm -
            nextProduct.printableArea.yMm -
            nextProduct.printableArea.heightMm) /
            settings.tileMm,
        );
      }
      material.normalScale.setScalar(settings.normalStrength);
      material.roughness = MathUtils.clamp(
        nextState.roughness *
          (nextState.materialProfile.roughness / 0.88) *
          (settings.roughness / 0.88),
        0.05,
        1,
      );
      material.sheen = settings.sheen;
      profile.update(nextState.materialProfile);
    },
    setPrintTexture(texture: Texture | null) {
      if (disposed) return;
      const mapPresenceChanged = (material.map === null) !== (texture === null);
      material.map = texture;
      if (texture) markColorTexture(texture);
      if (mapPresenceChanged) material.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      maps.normal.dispose();
      maps.roughness.dispose();
      material.dispose();
    },
  };
  controller.update(product, state);
  return controller;
}

/** Temporary initial artwork factory retained for the root scene migration. */
export function createInitialFabric() {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось подготовить материал поверхности.');
  ctx.fillStyle = '#24464c';
  ctx.fillRect(0, 0, 1800, 800);
  ctx.strokeStyle = '#56736f';
  ctx.lineWidth = 2;
  for (let x = 45; x < 1800; x += 55) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 800);
    ctx.stroke();
  }
  for (let y = 15; y < 800; y += 55) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1800, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#d8d6b9';
  ctx.font = '500 84px Segoe UI, sans-serif';
  ctx.fillText('MAKE IT YOURS.', 104, 190);
  ctx.font = '26px Segoe UI, sans-serif';
  ctx.fillText('MATVISION STUDIO  /  PRINT YOUR IDEAS', 109, 251);
  ctx.strokeStyle = '#d8d6b9';
  ctx.lineWidth = 3;
  for (let r = 45; r < 340; r += 30) {
    ctx.beginPath();
    ctx.arc(1420, 460, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  markColorTexture(texture);
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.88, metalness: 0 });
  return { material, texture };
}
