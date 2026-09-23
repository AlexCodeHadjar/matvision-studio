import { PNG } from 'pngjs';

export interface ViewportRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** WebView2 may return a whole-window image for an element screenshot. */
export function cropViewport(bytes: Buffer, rect: ViewportRectangle): Buffer {
  const source = PNG.sync.read(bytes);
  const scaleX = source.width / rect.viewportWidth;
  const scaleY = source.height / rect.viewportHeight;
  const x = Math.max(0, Math.round(rect.x * scaleX));
  const y = Math.max(0, Math.round(rect.y * scaleY));
  const width = Math.min(source.width - x, Math.round(rect.width * scaleX));
  const height = Math.min(source.height - y, Math.round(rect.height * scaleY));
  if (width <= 0 || height <= 0) throw new Error('Canvas is outside the native screenshot');
  const target = new PNG({ width, height });
  PNG.bitblt(source, target, x, y, width, height, 0, 0);
  return PNG.sync.write(target);
}

/** Pixel evidence complements scene diagnostics; a blank canvas must fail. */
export function imageEvidence(bytes: Buffer): {
  width: number;
  height: number;
  uniqueColors: number;
  luminanceVariance: number;
} {
  const png = PNG.sync.read(bytes);
  const colors = new Set<number>();
  let sum = 0;
  let squareSum = 0;
  let count = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i] ?? 0;
      const g = png.data[i + 1] ?? 0;
      const b = png.data[i + 2] ?? 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      colors.add((r << 16) | (g << 8) | b);
      sum += luminance;
      squareSum += luminance * luminance;
      count += 1;
    }
  }
  return {
    width: png.width,
    height: png.height,
    uniqueColors: colors.size,
    luminanceVariance: squareSum / count - (sum / count) ** 2,
  };
}

export function changedPixelFraction(before: Buffer, after: Buffer): number {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error('Cannot compare screenshots with different dimensions');
  }
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const difference = Math.max(
      Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
      Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
      Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)),
    );
    if (difference > 8) changed += 1;
  }
  return changed / (a.width * a.height);
}

export function pixelDifference(before: Buffer, after: Buffer) {
  const a = PNG.sync.read(before),
    b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Image size changed');
  let total = 0,
    max = 0,
    changed = 0;
  for (let i = 0; i < a.data.length; i += 4)
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs((a.data[i + channel] ?? 0) - (b.data[i + channel] ?? 0));
      total += delta;
      max = Math.max(max, delta);
      if (delta > 0) changed++;
    }
  return {
    meanAbsolute: total / (a.width * a.height * 3),
    max,
    changedFraction: changed / (a.width * a.height * 3),
  };
}
