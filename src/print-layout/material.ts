import { Matrix3, Color, type MeshStandardMaterial } from 'three';
import type { PreviewResolution, PrintableArea, PrintLayout } from '../contracts';
import { computePrintTransform } from './layout';

/** Install AFTER the fabric hook. Keeps normal-map UV independent of artwork placement.
 * The geometry's UV is relative to printableArea, with V upwards; outside 0..1 is unprinted.
 * Assign the texture to material.map separately; caller owns texture lifetime.
 */
export function applyPrintLayer(
  material: MeshStandardMaterial,
  dimensionsPx: PreviewResolution,
  printableArea: PrintableArea,
  layout: PrintLayout,
) {
  const inverse = { value: new Matrix3() };
  const cloth = { value: new Color('#e7e4df') };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const update = (image: PreviewResolution, area: PrintableArea, next: PrintLayout) => {
    inverse.value.set(...computePrintTransform(image, area, next).inverse);
  };
  update(dimensionsPx, printableArea, layout);
  const compile: typeof material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.matPrintInverse = inverse;
    shader.uniforms.matPrintCloth = cloth;
    shader.fragmentShader =
      'uniform mat3 matPrintInverse;\nuniform vec3 matPrintCloth;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #ifdef USE_MAP
        vec2 printUv = (matPrintInverse * vec3(vMapUv, 1.0)).xy;
        float printable = step(0.0, vMapUv.x) * step(vMapUv.x, 1.0) * step(0.0, vMapUv.y) * step(vMapUv.y, 1.0);
        float inImage = step(0.0, printUv.x) * step(printUv.x, 1.0) * step(0.0, printUv.y) * step(printUv.y, 1.0);
        vec4 artwork = texture2D(map, printUv);
        // Color textures are sRGB and sampled into linear light by Three/WebGL.
        // Alpha represents unprinted fabric, never a hole through the physical mat.
        diffuseColor.rgb *= mix(matPrintCloth, artwork.rgb, artwork.a * printable * inImage);
      #endif
    `,
    );
  };
  const cacheKey = () => previousKey.call(material) + '|matvision-print-v1';
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  return {
    update,
    dispose() {
      if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
      if (material.customProgramCacheKey === cacheKey) material.customProgramCacheKey = previousKey;
      material.needsUpdate = true;
    },
  };
}
