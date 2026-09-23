import {
  CanvasTexture,
  MathUtils,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Matrix3,
  type Texture,
} from 'three';
import { markColorTexture } from '../color/ColorPipeline';
import type { ProductDefinition, ProjectState } from '../contracts';
import { createFabricMaps, FABRIC_PRESETS } from './microtexture';
import { attachMaterialProfile } from './profile';
import { tileTextures, type MaterialTextures } from './assets';
import { attachFineHeight } from './height';

export function createFabricMaterial(product: ProductDefinition, state: ProjectState) {
  let preset = state.materialPreset;
  let maps = createFabricMaps(preset);
  let disposed = false;
  let imported: MaterialTextures = {};
  const baseColor = { value: null as Texture | null };
  const hasColor = { value: false };
  const colorTransform = { value: new Matrix3() };
  const weaveNormal = { value: maps.normal as Texture };
  const fiberNormal = { value: maps.fiber as Texture };
  const weaveTransform = { value: new Matrix3() };
  const fiberTransform = { value: new Matrix3() };
  const enhancedRelief = { value: false };
  const importedNormal = { value: false };
  const weaveStrength = { value: 0.15 };
  const fiberStrength = { value: 0.05 };
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
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.matFabricColor = baseColor;
    shader.uniforms.matHasFabricColor = hasColor;
    shader.uniforms.matFabricTransform = colorTransform;
    shader.uniforms.matWeaveNormal = weaveNormal;
    shader.uniforms.matFiberNormal = fiberNormal;
    shader.uniforms.matWeaveTransform = weaveTransform;
    shader.uniforms.matFiberTransform = fiberTransform;
    shader.uniforms.matEnhancedRelief = enhancedRelief;
    shader.uniforms.matImportedNormal = importedNormal;
    shader.uniforms.matWeaveStrength = weaveStrength;
    shader.uniforms.matFiberStrength = fiberStrength;
    shader.fragmentShader =
      'uniform sampler2D matFabricColor;\nuniform bool matHasFabricColor;\nuniform mat3 matFabricTransform;\n' +
      shader.fragmentShader;
    shader.fragmentShader =
      `
      uniform sampler2D matWeaveNormal;
      uniform sampler2D matFiberNormal;
      uniform mat3 matWeaveTransform;
      uniform mat3 matFiberTransform;
      uniform bool matEnhancedRelief;
      uniform bool matImportedNormal;
      uniform float matWeaveStrength;
      uniform float matFiberStrength;
      vec3 matRNM(vec3 base, vec3 detail) {
        vec3 t = base + vec3(0.0, 0.0, 1.0);
        vec3 u = detail * vec3(-1.0, -1.0, 1.0);
        return normalize(t * dot(t, u) / max(t.z, 0.001) - u);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      #if defined(USE_NORMALMAP_TANGENTSPACE) && defined(USE_MAP)
        if (matEnhancedRelief) {
          vec3 matCombined = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
          matCombined.xy *= normalScale;
          matCombined = normalize(matCombined);
          if (matImportedNormal) {
            vec3 matWeave = texture2D(matWeaveNormal, (matWeaveTransform * vec3(vMapUv, 1.0)).xy).xyz * 2.0 - 1.0;
            matWeave.xy *= matWeaveStrength;
            matCombined = matRNM(matCombined, normalize(matWeave));
          }
          vec3 matFiber = texture2D(matFiberNormal, (matFiberTransform * vec3(vMapUv, 1.0)).xy).xyz * 2.0 - 1.0;
          matFiber.xy *= matFiberStrength;
          normal = normalize(tbn * matRNM(matCombined, normalize(matFiber)));
        }
      #endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #ifdef USE_MAP
        if (matHasFabricColor) diffuseColor.rgb *= texture2D(matFabricColor, (matFabricTransform * vec3(vMapUv, 1.0)).xy).rgb;
      #endif
      #include <color_fragment>
    `,
    );
  };
  material.customProgramCacheKey = () => cacheKey.call(material) + '|matvision-fabric-pbr-rnm-v2';
  attachFineHeight(material);
  const controller = {
    material,
    setMaps(textures: MaterialTextures) {
      imported = textures;
      baseColor.value = textures.color ?? null;
      hasColor.value = !!textures.color;
      material.needsUpdate = true;
    },
    get ownedTextureBytes() {
      return disposed ? 0 : maps.approximateBytes;
    },
    update(nextProduct: ProductDefinition, nextState: ProjectState) {
      if (disposed) return;
      if (nextState.materialPreset !== preset) {
        const replacement = createFabricMaps(nextState.materialPreset);
        maps.normal.dispose();
        maps.fiber.dispose();
        maps.roughness.dispose();
        maps = replacement;
        weaveNormal.value = maps.normal;
        fiberNormal.value = maps.fiber;
        preset = nextState.materialPreset;
        material.normalMap = maps.normal;
        material.roughnessMap = maps.roughness;
      }
      const settings = FABRIC_PRESETS[preset];
      const tileMm = settings.tileMm * nextState.realism.weaveScale;
      // Geometry UVs measure the printable area, including extensions past its bounds.
      // A weave tile retains its millimetre size regardless of artwork crop or scale.
      for (const texture of [maps.normal, maps.roughness, maps.fiber]) {
        const scale = texture === maps.fiber ? 3 : 1;
        texture.repeat.set(
          (scale * nextProduct.printableArea.widthMm) / tileMm,
          (scale * nextProduct.printableArea.heightMm) / tileMm,
        );
        texture.offset.set(
          (scale * nextProduct.printableArea.xMm) / tileMm,
          (scale *
            (nextProduct.heightMm -
              nextProduct.printableArea.yMm -
              nextProduct.printableArea.heightMm)) /
            tileMm,
        );
        texture.updateMatrix();
      }
      weaveTransform.value.copy(maps.normal.matrix);
      fiberTransform.value.copy(maps.fiber.matrix);
      tileTextures(
        imported,
        nextState.materials.fabric,
        nextProduct.printableArea.widthMm,
        nextProduct.printableArea.heightMm,
        nextProduct.printableArea.xMm,
        nextProduct.heightMm - nextProduct.printableArea.yMm - nextProduct.printableArea.heightMm,
      );
      if (imported.color) colorTransform.value.copy(imported.color.matrix);
      material.normalMap = imported.normal ?? maps.normal;
      importedNormal.value = !!imported.normal;
      material.roughnessMap = imported.roughness ?? maps.roughness;
      material.bumpMap = imported.height ?? null;
      material.bumpScale = 0.00008 * nextState.realism.relief;
      const strength =
        (imported.normal ? 0.45 : settings.normalStrength) * nextState.realism.relief;
      material.normalScale.set(
        strength,
        imported.normal && nextState.materials.fabric.normalY === 'directx' ? -strength : strength,
      );
      material.roughness = MathUtils.clamp(
        nextState.roughness *
          (nextState.materialProfile.roughness / 0.88) *
          (settings.roughness / 0.88),
        0.05,
        1,
      );
      material.sheen = settings.sheen * nextState.realism.sheen;
      weaveStrength.value = settings.normalStrength * nextState.realism.relief;
      fiberStrength.value = 0.07 * nextState.realism.relief;
      profile.update(nextState.materialProfile);
    },
    setEnhancedMicrorelief(enabled: boolean) {
      enhancedRelief.value = enabled;
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
      maps.fiber.dispose();
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
