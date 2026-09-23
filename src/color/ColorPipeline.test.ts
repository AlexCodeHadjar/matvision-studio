import { expect, it } from 'vitest';
import { ACESFilmicToneMapping, NoColorSpace, NoToneMapping, Texture } from 'three';
import { configureColorPipeline, markColorTexture } from './ColorPipeline';
it('keeps sRGB color inputs, linear lighting, single sRGB output and explicit tone mapping', () => {
  const renderer = {
    outputColorSpace: NoColorSpace as string,
    toneMapping: NoToneMapping,
    toneMappingExposure: 0,
  };
  configureColorPipeline(renderer);
  expect(renderer.outputColorSpace).toBe('srgb');
  expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);
  expect(renderer.toneMappingExposure).toBe(1);
  const color = new Texture();
  markColorTexture(color);
  expect(color.colorSpace).toBe('srgb');
  expect(new Texture().colorSpace).toBe(NoColorSpace);
});
