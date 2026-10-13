import { REFERENCE_FOLD_DATA } from './referenceFoldData.ts';

const decoded = new Map<string, { values: Int16Array; size: number; width: number; height: number }>();
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
// Smooth interpolation keeps analytic normals continuous across relief texels.
const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

export function referenceFold(kind: string, photoX: number, photoY: number) {
  if (!(kind in REFERENCE_FOLD_DATA)) return 0;
  let field = decoded.get(kind);
  if (!field) {
    const record = REFERENCE_FOLD_DATA[kind as keyof typeof REFERENCE_FOLD_DATA];
    const bytes = Uint8Array.from(atob(record.data), (c) => c.charCodeAt(0));
    const data = new DataView(bytes.buffer), values = new Int16Array(bytes.length / 2);
    for (let i = 0; i < values.length; i++) values[i] = data.getInt16(i * 2, true);
    field = { ...record, values };
    decoded.set(kind, field);
  }
  const x = photoX / field.width * field.size - 0.5, y = photoY / field.height * field.size - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), rows: number[] = [];
  const at = (px: number, py: number) => field!.values[clamp(py, 0, field!.size - 1) * field!.size + clamp(px, 0, field!.size - 1)]!;
  for (let j = -1; j <= 2; j++) rows.push(cubic(at(ix - 1, iy + j), at(ix, iy + j), at(ix + 1, iy + j), at(ix + 2, iy + j), x - ix));
  return clamp(cubic(rows[0]!, rows[1]!, rows[2]!, rows[3]!, y - iy) / 32767 * 0.004, -0.004, 0.004);
}
