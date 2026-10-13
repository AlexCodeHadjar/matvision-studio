import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createCatalogProduct } from '../src/geometry/catalog.ts';
import { PRODUCTS } from '../src/products/index.ts';
const products = PRODUCTS.filter((p) => p.kind && !['tshirt', 'mug'].includes(p.kind));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceHash = hash(
  fs.readFileSync('src/geometry/catalog.ts') +
    fs.readFileSync('src/geometry/catalogAccessories.ts') +
    fs.readFileSync('src/geometry/referenceFolds.ts') +
    fs.readFileSync('src/geometry/referenceFoldData.ts') +
    JSON.stringify(products) +
    fs.readFileSync('scripts/bake-catalog.mjs'),
);
const dir = 'public/models/catalog';
fs.mkdirSync(dir, { recursive: true });
const previous = fs.existsSync(`${dir}/manifest.json`)
  ? JSON.parse(fs.readFileSync(`${dir}/manifest.json`))
  : null;
if (
  previous?.sourceHash === sourceHash &&
  previous.models.length === products.length &&
  previous.models.every((m) => fs.existsSync(`${dir}/${m.id}.mvgz`))
) {
  console.log('Catalog models are current.');
  process.exit(0);
}
const models = [];
for (const product of products) {
  const started = performance.now(),
    geometries = createCatalogProduct(product),
    parts = {},
    buffers = [];
  let offset = 0,
    triangles = 0;
  const append = (array, itemSize) => {
    const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const stream = { offset, length: array.length, ...(itemSize ? { itemSize } : {}) };
    buffers.push(buffer);
    offset += buffer.length;
    return stream;
  };
  for (const [name, g] of Object.entries(geometries)) {
    if (!g) continue;
    const attributes = {};
    for (const [name, attribute] of Object.entries(g.attributes)) {
      if (!Array.from(attribute.array).every(Number.isFinite))
        throw Error(`${product.id}: nonfinite ${name}`);
      attributes[name] = append(Float32Array.from(attribute.array), attribute.itemSize);
    }
    const index = append(Uint32Array.from(g.index.array));
    triangles += g.index.count / 3;
    parts[name] = { attributes, index };
    g.dispose();
  }
  const json = Buffer.from(JSON.stringify({ version: 1, productId: product.id, parts }));
  const prefix = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  prefix.writeUInt32LE(0x3147564d);
  prefix.writeUInt32LE(json.length, 4);
  json.copy(prefix, 8);
  const raw = Buffer.concat([prefix, ...buffers]),
    compressed = gzipSync(raw, { level: 9 });
  fs.writeFileSync(`${dir}/${product.id}.mvgz`, compressed);
  const record = {
    id: product.id,
    triangles,
    bytes: compressed.length,
    decodedBytes: raw.length,
    sha256: hash(compressed),
    bakeMs: Math.round(performance.now() - started),
  };
  models.push(record);
  console.log(JSON.stringify(record));
}
fs.writeFileSync(
  `${dir}/manifest.json`,
  JSON.stringify({ version: 1, sourceHash, models }, null, 2),
);
