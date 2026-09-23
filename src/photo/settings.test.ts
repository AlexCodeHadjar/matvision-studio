import { describe, expect, it } from 'vitest';
import { DEFAULT_PHOTO_SETTINGS, PHOTO_PRESETS, validatePhotoSettings } from './settings';

describe('Photo settings', () => {
  it('keeps the verified 512-pass default and neutral optics', () => {
    expect(PHOTO_PRESETS.preview.samples).toBe(512);
    expect(DEFAULT_PHOTO_SETTINGS.fStop).toBeNull();
    expect(DEFAULT_PHOTO_SETTINGS.denoise).toBe('off');
    expect(validatePhotoSettings(DEFAULT_PHOTO_SETTINGS)).toBe(DEFAULT_PHOTO_SETTINGS);
  });

  it('bounds samples and keeps displacement out of preview', () => {
    expect(() => validatePhotoSettings({ ...DEFAULT_PHOTO_SETTINGS, samples: 4097 })).toThrow();
    expect(() =>
      validatePhotoSettings({ ...DEFAULT_PHOTO_SETTINGS, displacementMm: 0.1 }),
    ).toThrow();
    expect(
      validatePhotoSettings({ ...DEFAULT_PHOTO_SETTINGS, preset: 'high', displacementMm: 0.1 })
        .displacementMm,
    ).toBe(0.1);
  });
});
