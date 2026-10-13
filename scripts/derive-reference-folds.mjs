import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

// This is an optional authoring tool, never part of startup or the asset bake.
// Retain only bounded scalar fold cues: no RGB photograph or light map is used.
const sourceDir = process.argv[2];
if (!sourceDir) throw Error('Pass the directory containing the three reference PNGs.');
const size = 256;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const ellipticalExclusion = (x, y, cx, cy, rx, ry) => smooth(0.65, 1.25, Math.hypot((x - cx) / rx, (y - cy) / ry));
function seamExclusion(x, y, points, inner, outer) {
  let closest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i], dx = bx - ax, dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    closest = Math.min(closest, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return smooth(inner, outer, closest);
}
const structuralSeams = {
  hoodie: { axis: 500, points: [[748,188],[720,231],[708,303],[706,397],[709,487]] },
  sweatshirt: { axis: 347, points: [[593,170],[552,188],[547,245],[531,317],[506,391]] },
  longsleeve: { axis: 350, points: [[559,89],[548,127],[532,174],[519,215],[506,238]] },
};
function blur(values, radius) {
  const horizontal = new Float64Array(size * size), result = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += values[y * size + clamp(i, 0, size - 1)];
    for (let x = 0; x < size; x++) {
      horizontal[y * size + x] = sum / (radius * 2 + 1);
      sum += values[y * size + clamp(x + radius + 1, 0, size - 1)] - values[y * size + clamp(x - radius, 0, size - 1)];
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += horizontal[clamp(i, 0, size - 1) * size + x];
    for (let y = 0; y < size; y++) {
      result[y * size + x] = sum / (radius * 2 + 1);
      sum += horizontal[clamp(y + radius + 1, 0, size - 1) * size + x] - horizontal[clamp(y - radius, 0, size - 1) * size + x];
    }
  }
  return result;
}
const fields = {}, provenance = [];
for (const [kind, file] of [['hoodie', '01_Худи_белый.png'], ['sweatshirt', '02_Свитшот_белый.png'], ['longsleeve', '04_Лонгслив_белый.png']]) {
  const original = fs.readFileSync(path.join(sourceDir, file)), png = PNG.sync.read(original);
  const alpha = new Float64Array(size * size), weighted = new Float64Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let count = 0, weight = 0, light = 0;
    const xa = Math.floor(x * png.width / size), xb = Math.floor((x + 1) * png.width / size);
    const ya = Math.floor(y * png.height / size), yb = Math.floor((y + 1) * png.height / size);
    for (let py = ya; py < yb; py++) for (let px = xa; px < xb; px++) {
      const i = (py * png.width + px) * 4, a = png.data[i + 3] / 255;
      light += a * (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
      weight += a; count++;
    }
    const i = y * size + x;
    alpha[i] = weight / count; weighted[i] = light / count;
  }
  // Alpha-normalized band-pass removes broad studio illumination and texture
  // grain. Its remaining locations/directions guide geometric creases; depth
  // cannot be recovered uniquely from one photograph and is authored below.
  const normalizedBlur = (radius) => {
    const a = blur(alpha, radius), w = blur(weighted, radius);
    return Float64Array.from(w, (v, i) => a[i] > 0.01 ? v / a[i] : 0);
  };
  const fine = normalizedBlur(2), broad = normalizedBlur(9), valid = blur(alpha, 3);
  const encoded = Buffer.alloc(size * size * 2);
  for (let i = 0; i < fine.length; i++) {
    const x = (i % size) / size * png.width, y = Math.floor(i / size) / size * png.height;
    // Collar tags and drawcords are separate construction, not cloth wrinkles.
    const sourceSeam = structuralSeams[kind];
    let mask = kind === 'hoodie'
      ? smooth(35, 65, y) * ellipticalExclusion(x, y, 498, 147, 25, 19) * ellipticalExclusion(x, y, 453, 228, 19, 71) * ellipticalExclusion(x, y, 539, 225, 20, 74)
      : kind === 'sweatshirt' ? smooth(72, 112, y) : smooth(57, 95, y);
    // Shoulder attachment and pocket hems are modeled construction, so their
    // dark photographed lines must not become an extra embossed ridge.
    mask *= seamExclusion(x, y, sourceSeam.points, 10, 28);
    mask *= seamExclusion(x, y, sourceSeam.points.map(([px, py]) => [2 * sourceSeam.axis - px, py]), 10, 28);
    if (kind === 'hoodie') mask *= seamExclusion(x, y, [[365,515],[642,515],[651,565],[669,624],[686,692],[701,780],[311,780],[329,699],[345,630],[357,565],[365,515]], 10, 30);
    const relief = mask * clamp((fine[i] - broad[i]) * 0.095, -0.004, 0.004) * smooth(0.4, 0.9, valid[i]);
    encoded.writeInt16LE(Math.round(relief / 0.004 * 32767), i * 2);
  }
  fields[kind] = { size, width: png.width, height: png.height, data: encoded.toString('base64') };
  provenance.push({ kind, file, sha256: createHash('sha256').update(original).digest('hex'), maximumDepthMm: 4 });
}
fs.writeFileSync('src/geometry/referenceFoldData.ts', `// Derived scalar wrinkle cues only; see reference-fold-provenance.json.\nexport const REFERENCE_FOLD_DATA = ${JSON.stringify(fields)} as const;\n`);
fs.writeFileSync('src/geometry/reference-fold-provenance.json', JSON.stringify({ authoring: 'Photo-guided bounded front geometry relief; not a recovered 3D scan. No photo RGB/albedo or studio lighting is retained. Back has independently authored seam/compression forms and does not use front reference relief.', algorithm: 'alpha-normalized low-frequency luminance band-pass at 256x256; signed depth quantized to 16-bit; maximum 4 mm; smoothly exclude collar labels, drawcord, modeled shoulder seams and pocket perimeter', sources: provenance }, null, 2));
console.log('Saved three photo-guided scalar wrinkle fields.');
