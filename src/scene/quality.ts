import type { QualityPreset } from '../contracts';
export const QUALITY_SETTINGS: Record<
  QualityPreset,
  { pixelRatio: number; shadowSize: number; environmentWidth: number }
> = {
  low: { pixelRatio: 1, shadowSize: 512, environmentWidth: 256 },
  balanced: { pixelRatio: 1.5, shadowSize: 1024, environmentWidth: 512 },
  high: { pixelRatio: 2, shadowSize: 2048, environmentWidth: 1024 },
  ultra: { pixelRatio: 2, shadowSize: 4096, environmentWidth: 2048 },
};
