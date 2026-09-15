import { ACESFilmicToneMapping, SRGBColorSpace, type Texture, type WebGLRenderer } from 'three';
export const COLOR_PIPELINE = Object.freeze({
  outputColorSpace: SRGBColorSpace,
  toneMapping: ACESFilmicToneMapping,
  exposure: 1,
});
export function configureColorPipeline(
  renderer: Pick<WebGLRenderer, 'outputColorSpace' | 'toneMapping' | 'toneMappingExposure'>,
) {
  renderer.outputColorSpace = COLOR_PIPELINE.outputColorSpace;
  renderer.toneMapping = COLOR_PIPELINE.toneMapping;
  renderer.toneMappingExposure = COLOR_PIPELINE.exposure;
}
export function markColorTexture(texture: Texture): void {
  texture.colorSpace = SRGBColorSpace;
}
