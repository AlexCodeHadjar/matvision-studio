import type { PreviewResolution, PrintableArea, PrintLayout, QualityPreset } from '../contracts';

export interface Point2 {
  x: number;
  y: number;
}
export type Matrix3Rows = [number, number, number, number, number, number, number, number, number];
export interface PrintTransform {
  /** Physical dimensions before rotation. */
  widthMm: number;
  heightMm: number;
  /** Row-major inverse: printable UV -> original image UV; V points upwards. */
  inverse: Matrix3Rows;
  /** Original image corners, counterclockwise, in printable UV. */
  footprintUv: Point2[];
  /** Visible part of the original image, after rectangular printable clipping. */
  visibleImageUv: Point2[];
  /** Visible original-image area / total image area. Rounded trim is a geometry concern. */
  visibleFraction: number;
}

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${label} must be positive and finite.`);
}
function validate(image: PreviewResolution, area: PrintableArea, layout: PrintLayout) {
  positive(image.widthPx, 'Image width');
  positive(image.heightPx, 'Image height');
  positive(area.widthMm, 'Printable width');
  positive(area.heightMm, 'Printable height');
  positive(layout.scale, 'Print scale');
  if (![layout.offsetX, layout.offsetY, layout.rotationDeg].every(Number.isFinite))
    throw new RangeError('Print offset and rotation must be finite.');
  if (!['cover', 'contain', 'stretch'].includes(layout.mode))
    throw new RangeError('Unknown fit mode.');
}

function clipPolygon(
  polygon: Point2[],
  axis: 'x' | 'y',
  bound: number,
  keepGreater: boolean,
): Point2[] {
  const result: Point2[] = [];
  const inside = (p: Point2) => (keepGreater ? p[axis] >= bound : p[axis] <= bound);
  for (let i = 0; i < polygon.length; i++) {
    const from = polygon[i]!;
    const to = polygon[(i + 1) % polygon.length]!;
    const fromInside = inside(from);
    const toInside = inside(to);
    if (fromInside) result.push(from);
    if (fromInside !== toInside) {
      const t = (bound - from[axis]) / (to[axis] - from[axis]);
      result.push({ x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) });
    }
  }
  return result;
}

/** Fit is calculated in physical millimetres before rotation. Scale 1 is the chosen fit. */
export function computePrintTransform(
  image: PreviewResolution,
  area: PrintableArea,
  layout: PrintLayout,
): PrintTransform {
  validate(image, area, layout);
  const fit = layout.mode === 'cover' ? Math.max : Math.min;
  const mmPerPx = fit(area.widthMm / image.widthPx, area.heightMm / image.heightPx);
  const widthMm =
    (layout.mode === 'stretch' ? area.widthMm : image.widthPx * mmPerPx) * layout.scale;
  const heightMm =
    (layout.mode === 'stretch' ? area.heightMm : image.heightPx * mmPerPx) * layout.scale;
  positive(widthMm, 'Scaled print width');
  positive(heightMm, 'Scaled print height');
  const angle = ((layout.rotationDeg % 360) * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const a = (c * area.widthMm) / widthMm;
  const b = (s * area.heightMm) / widthMm;
  const d = (-s * area.widthMm) / heightMm;
  const e = (c * area.heightMm) / heightMm;
  const inverse: Matrix3Rows = [
    a,
    b,
    0.5 - a * (0.5 + layout.offsetX) - b * (0.5 + layout.offsetY),
    d,
    e,
    0.5 - d * (0.5 + layout.offsetX) - e * (0.5 + layout.offsetY),
    0,
    0,
    1,
  ];
  const footprintUv = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ].map(({ x, y }) => ({
    x: 0.5 + layout.offsetX + (c * (x - 0.5) * widthMm - s * (y - 0.5) * heightMm) / area.widthMm,
    y: 0.5 + layout.offsetY + (s * (x - 0.5) * widthMm + c * (y - 0.5) * heightMm) / area.heightMm,
  }));
  let clipped = footprintUv;
  for (const axis of ['x', 'y'] as const) {
    clipped = clipPolygon(clipped, axis, 0, true);
    clipped = clipPolygon(clipped, axis, 1, false);
  }
  const visibleImageUv = clipped.map(({ x, y }) => imageUvAt(x, y, { inverse }));
  const twiceArea = visibleImageUv.reduce((sum, p, i) => {
    const next = visibleImageUv[(i + 1) % visibleImageUv.length]!;
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  return {
    widthMm,
    heightMm,
    inverse,
    footprintUv,
    visibleImageUv,
    visibleFraction: Math.min(1, Math.max(0, Math.abs(twiceArea) / 2)),
  };
}

export function imageUvAt(
  u: number,
  v: number,
  transform: Pick<PrintTransform, 'inverse'>,
): Point2 {
  const m = transform.inverse;
  return { x: m[0] * u + m[1] * v + m[2], y: m[3] * u + m[4] * v + m[5] };
}

export interface DpiThresholds {
  excellent: number;
  good: number;
  low: number;
}
export const DEFAULT_DPI_THRESHOLDS: Readonly<DpiThresholds> = Object.freeze({
  excellent: 300,
  good: 150,
  low: 75,
});
export type PrintQualityLevel = 'Excellent' | 'Good' | 'Low' | 'Very Low';
export function qualityFromDpi(
  dpi: number,
  thresholds: DpiThresholds = DEFAULT_DPI_THRESHOLDS,
): PrintQualityLevel {
  if (!Number.isFinite(dpi) || dpi < 0) throw new RangeError('DPI must be finite and nonnegative.');
  if (
    !(
      thresholds.excellent >= thresholds.good &&
      thresholds.good >= thresholds.low &&
      thresholds.low > 0
    ) ||
    !Object.values(thresholds).every(Number.isFinite)
  )
    throw new RangeError('DPI thresholds must be finite and ordered Excellent >= Good >= Low > 0.');
  return dpi >= thresholds.excellent
    ? 'Excellent'
    : dpi >= thresholds.good
      ? 'Good'
      : dpi >= thresholds.low
        ? 'Low'
        : 'Very Low';
}

/** Always pass ORIGINAL dimensions. Rotation/cropping do not change pixel density. */
export function computeEffectiveDpi(
  image: PreviewResolution,
  area: PrintableArea,
  layout: PrintLayout,
  thresholds: DpiThresholds = DEFAULT_DPI_THRESHOLDS,
) {
  const { widthMm, heightMm } = computePrintTransform(image, area, layout);
  const x = (image.widthPx * 25.4) / widthMm;
  const y = (image.heightPx * 25.4) / heightMm;
  const minimum = Math.min(x, y);
  return { x, y, minimum, quality: qualityFromDpi(minimum, thresholds) };
}

export const PREVIEW_EDGE_LIMITS: Readonly<Record<QualityPreset, number>> = Object.freeze({
  low: 2048,
  balanced: 4096,
  high: 4096,
  ultra: 8192,
});
export function computePreviewResolution(
  image: PreviewResolution,
  maxTextureSize: number,
  quality: QualityPreset,
): PreviewResolution {
  positive(image.widthPx, 'Image width');
  positive(image.heightPx, 'Image height');
  positive(maxTextureSize, 'GPU texture limit');
  const presetLimit = PREVIEW_EDGE_LIMITS[quality];
  if (!presetLimit) throw new RangeError('Unknown preview quality.');
  const maxEdge = Math.floor(Math.min(presetLimit, maxTextureSize));
  if (maxEdge < 1) throw new RangeError('GPU texture limit must be at least one pixel.');
  const factor = Math.min(1, maxEdge / image.widthPx, maxEdge / image.heightPx);
  return {
    widthPx: Math.max(1, Math.round(image.widthPx * factor)),
    heightPx: Math.max(1, Math.round(image.heightPx * factor)),
  };
}
