import type { PreviewResolution } from '../contracts';

/** Uncompressed texture storage estimate, including the complete mip chain when enabled.
 * This is not driver VRAM usage: it excludes alignment, caches and render/depth buffers.
 * Summing actual mip dimensions also handles thin panoramas, where 4/3 is inaccurate.
 */
export function estimateTextureBytes(
  width: number,
  height: number,
  bytesPerTexel = 4,
  mipmaps = true,
): number {
  if (![width, height, bytesPerTexel].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new RangeError('Texture dimensions and bytes per texel must be positive integers.');
  let bytes = width * height * bytesPerTexel;
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Texture storage exceeds safe precision.');
  while (mipmaps && (width > 1 || height > 1)) {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    bytes += width * height * bytesPerTexel;
  }
  return bytes;
}

export interface SceneTextureEstimate {
  /** Default artwork stays cached so clearing an imported print is immediate. */
  fallback: PreviewResolution;
  print: PreviewResolution | null;
  /** Includes allocated labels even when the ruler is currently hidden. */
  referenceLabelCount: number;
  materialBytes: number;
  environmentWidth: number;
  environmentHeight: number;
  shadowSize: number;
}

/** Conservative owned texture budget, including cached sample and reference labels.
 * PMREM is RGBA16F with its filtered levels packed in one atlas, not hardware mipmaps.
 * Shadow estimate includes RGBA8 color only; depth/renderbuffers are deliberately excluded.
 * Some owned textures are lazily uploaded, so this can exceed renderer.info texture storage.
 */
export function estimateSceneTextureBytes(input: SceneTextureEstimate): number {
  const printBytes = input.print
    ? estimateTextureBytes(input.print.widthPx, input.print.heightPx)
    : 0;
  return (
    estimateTextureBytes(input.fallback.widthPx, input.fallback.heightPx) +
    printBytes +
    input.referenceLabelCount * estimateTextureBytes(128, 64) +
    input.materialBytes +
    estimateTextureBytes(input.environmentWidth, input.environmentHeight, 8, false) +
    estimateTextureBytes(input.shadowSize, input.shadowSize, 4, false)
  );
}
