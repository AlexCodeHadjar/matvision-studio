import { Color, MathUtils, type MeshStandardMaterial } from 'three';
import type { CalibratedMaterialProfile } from '../contracts';

/** Empirical compensation in linear RGB. Identity settings preserve every source channel. */
export function compensateLinearColor(
  rgb: readonly [number, number, number],
  profile: CalibratedMaterialProfile,
): [number, number, number] {
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const tint = new Color(profile.surfaceTint).toArray();
  return rgb.map((channel, i) => {
    const saturated = luminance + (channel - luminance) * profile.saturation;
    const contrasted = (saturated - 0.18) * profile.contrast + 0.18;
    const adjusted = MathUtils.clamp(contrasted * profile.brightness * tint[i]!, 0, 1);
    return profile.blackLevel + (1 - profile.blackLevel) * adjusted;
  }) as [number, number, number];
}

export function attachMaterialProfile(
  material: MeshStandardMaterial,
  initialProfile: CalibratedMaterialProfile,
) {
  const uniforms = {
    mvBrightness: { value: initialProfile.brightness },
    mvSaturation: { value: initialProfile.saturation },
    mvBlackLevel: { value: initialProfile.blackLevel },
    mvContrast: { value: initialProfile.contrast },
    mvSurfaceTint: { value: new Color(initialProfile.surfaceTint) },
  };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  const cacheKey = previousKey();
  material.customProgramCacheKey = () => `${cacheKey}|matvision-profile-linear-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = `
uniform float mvBrightness;
uniform float mvSaturation;
uniform float mvBlackLevel;
uniform float mvContrast;
uniform vec3 mvSurfaceTint;
${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float mvLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 mvCompensated = mix(vec3(mvLuminance), diffuseColor.rgb, mvSaturation);
mvCompensated = (mvCompensated - vec3(0.18)) * mvContrast + vec3(0.18);
mvCompensated = clamp(mvCompensated * mvBrightness * mvSurfaceTint, 0.0, 1.0);
diffuseColor.rgb = mix(vec3(mvBlackLevel), vec3(1.0), mvCompensated);`,
    );
  };
  return {
    update(profile: CalibratedMaterialProfile) {
      uniforms.mvBrightness.value = profile.brightness;
      uniforms.mvSaturation.value = profile.saturation;
      uniforms.mvBlackLevel.value = profile.blackLevel;
      uniforms.mvContrast.value = profile.contrast;
      uniforms.mvSurfaceTint.value.set(profile.surfaceTint);
    },
  };
}
