export type PhotoPreset = 'preview' | 'high' | 'ultra' | 'reference';
export type DenoiseMode = 'off' | 'smart';

/** Session-only settings. The saved .matvision v2 schema is unchanged. */
export interface PhotoSettings {
  preset: PhotoPreset;
  samples: number;
  longSidePx: 1920 | 2560 | 3840;
  denoise: DenoiseMode;
  focalLengthMm: number | null;
  focusDistanceMm: number;
  fStop: number | null;
  displacementMm: number;
}

export const PHOTO_PRESETS: Record<PhotoPreset, Pick<PhotoSettings, 'samples' | 'longSidePx'>> = {
  preview: { samples: 512, longSidePx: 1920 },
  high: { samples: 1024, longSidePx: 2560 },
  ultra: { samples: 2048, longSidePx: 3840 },
  reference: { samples: 4096, longSidePx: 3840 },
};

export const DEFAULT_PHOTO_SETTINGS: PhotoSettings = {
  preset: 'preview',
  ...PHOTO_PRESETS.preview,
  denoise: 'off',
  focalLengthMm: null,
  focusDistanceMm: 500,
  fStop: null,
  displacementMm: 0,
};

export function validatePhotoSettings(settings: PhotoSettings): PhotoSettings {
  if (!PHOTO_PRESETS[settings.preset]) throw new Error('Неизвестный уровень качества фото.');
  if (!Number.isInteger(settings.samples) || settings.samples < 128 || settings.samples > 4096)
    throw new Error('Число проходов фото должно быть от 128 до 4096.');
  if (![1920, 2560, 3840].includes(settings.longSidePx))
    throw new Error('Неподдерживаемый размер фото.');
  if (settings.denoise !== 'off' && settings.denoise !== 'smart')
    throw new Error('Неподдерживаемый режим шумоподавления.');
  if (
    settings.focalLengthMm !== null &&
    (!Number.isFinite(settings.focalLengthMm) ||
      settings.focalLengthMm < 20 ||
      settings.focalLengthMm > 120)
  )
    throw new Error('Фокусное расстояние должно быть от 20 до 120 мм.');
  if (
    !Number.isFinite(settings.focusDistanceMm) ||
    settings.focusDistanceMm < 50 ||
    settings.focusDistanceMm > 5000
  )
    throw new Error('Дистанция фокусировки должна быть от 50 до 5000 мм.');
  if (settings.fStop !== null && ![2, 4, 8, 16].includes(settings.fStop))
    throw new Error('Неподдерживаемая диафрагма.');
  if (
    !Number.isFinite(settings.displacementMm) ||
    settings.displacementMm < 0 ||
    settings.displacementMm > 0.3
  )
    throw new Error('Рельеф фото должен быть от 0 до 0,3 мм.');
  if (settings.displacementMm > 0 && settings.preset === 'preview')
    throw new Error('Геометрический рельеф доступен начиная с Photo High.');
  return settings;
}
