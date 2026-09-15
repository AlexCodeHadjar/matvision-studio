import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// Original, procedural fixtures. No remote photographs or copyrighted assets.
const directory = dirname(fileURLToPath(import.meta.url));
mkdirSync(directory, { recursive: true });
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function png(name, width, height, color) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a = 255] = color(x, y, width, height);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(join(directory, `${name}.png`), file);
  return { filename: `${name}.png`, width, height, bytes: file.length };
}
const grid = (cell) => (x, y, width, height) => {
  if (x < 8 || x >= width - 8) return [255, 32, 32];
  if (y < 8 || y >= height - 8) return [32, 96, 255];
  if (x % cell < 3 || y % cell < 3) return [24, 24, 24];
  return (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? [224, 224, 224] : [160, 184, 192];
};
const patches = [
  [0, 0, 0],
  [32, 32, 32],
  [64, 64, 64],
  [128, 128, 128],
  [188, 188, 188],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [96, 32, 16],
  [224, 160, 112],
  [16, 96, 32],
  [24, 48, 128],
  [192, 32, 96],
  [240, 192, 24],
];
const manifest = [
  png('uv-circle', 1800, 800, (x, y) =>
    Math.hypot(x - 900, y - 400) < 150
      ? [240, 24, 36]
      : x % 100 < 2 || y % 100 < 2
        ? [96, 160, 180]
        : [24, 70, 78],
  ),
  png('landscape-grid', 1800, 800, grid(100)),
  png('square-rgb', 768, 768, (x, y, w, h) => [
    Math.round((255 * x) / (w - 1)),
    Math.round((255 * y) / (h - 1)),
    128,
  ]),
  png('portrait-grid', 600, 1200, grid(100)),
  png('panorama-grid', 4096, 512, grid(128)),
  png('very-tall-grid', 256, 2048, grid(64)),
  png('black', 512, 512, () => [0, 0, 0]),
  png('white', 512, 512, () => [255, 255, 255]),
  png('gray-50-srgb', 512, 512, () => [128, 128, 128]),
  png('color-patches', 1200, 600, (x, y) => patches[Math.floor(y / 200) * 6 + Math.floor(x / 200)]),
  png('high-resolution-grid', 8192, 4096, grid(256)),
  png('small-low-resolution', 32, 16, (x, y) => ((x + y) % 2 ? [240, 40, 80] : [32, 160, 224])),
  png('transparent', 512, 512, (x, y) => [
    255,
    80,
    32,
    Math.hypot(x - 256, y - 256) < 180 ? 192 : 0,
  ]),
];
writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${manifest.length} original PNG fixtures.`);
