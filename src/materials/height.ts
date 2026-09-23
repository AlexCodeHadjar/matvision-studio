import type { MeshStandardMaterial } from 'three';

/** Three normally chooses normal OR bump; apply fine height on the mapped normal. */
export function attachFineHeight(material: MeshStandardMaterial) {
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      #include <normal_fragment_maps>
      #if defined(USE_BUMPMAP) && defined(USE_NORMALMAP_TANGENTSPACE)
        normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);
      #endif
    `,
    );
  };
  material.customProgramCacheKey = () => key + '|matvision-fine-height-v1';
}
