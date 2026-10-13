import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { serialize, deserialize } from 'node:v8';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { createGarment } from '../src/geometry/garment.ts';
import { PRODUCTS } from '../src/products/index.ts';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const garmentProfiles = PRODUCTS.filter((p) => p.kind === 'tshirt');
const sourceHash = hash(
  fs.readFileSync('src/geometry/garment.ts') + JSON.stringify(garmentProfiles),
);
const buildHash = hash(sourceHash + fs.readFileSync('scripts/bake-garments.mjs'));
const output = 'public/models/garments';
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync('work/garment-cache', { recursive: true });
const previous = fs.existsSync(`${output}/manifest.json`)
  ? JSON.parse(fs.readFileSync(`${output}/manifest.json`))
  : null;
if (
  previous?.buildHash === buildHash &&
  previous.models.every((m) => fs.existsSync(`${output}/${m.id}.mvgz`))
) {
  console.log('Prepared garment models are current.');
  process.exit(0);
}
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
const models = [];
for (const product of garmentProfiles) {
  const started = performance.now(),
    cache = `work/garment-cache/${product.id}-${sourceHash.slice(0, 12)}.v8.gz`;
  let parts;
  if (fs.existsSync(cache)) parts = deserialize(gunzipSync(fs.readFileSync(cache)));
  else {
    console.log(`Preparing ${product.id} from the approved source geometry…`);
    const garment = createGarment(product);
    parts = {};
    for (const [name, g] of Object.entries(garment)) {
      parts[name] = {
        attributes: Object.fromEntries(
          Object.entries(g.attributes).map(([n, a]) => [
            n,
            { array: a.array, itemSize: a.itemSize },
          ]),
        ),
        indices: Uint32Array.from(g.index.array),
      };
      g.dispose();
    }
    fs.writeFileSync(cache, gzipSync(serialize(parts), { level: 1 }));
  }
  const before = Object.values(parts).reduce((n, p) => n + p.indices.length / 3, 0),
    errors = {};
  // Preserve silhouette/openings. Normal and UV attributes participate in the
  // error metric; vertex values are retained exactly (no position/UV quantization).
  const frontVertices = parts.front.attributes.position.array.length / 3;
  for (const side of ['front', 'back']) {
    const part = parts[side],
      pos = part.attributes.position.array,
      normals = part.attributes.normal.array,
      uv = part.attributes.uv.array;
    const attributes = new Float32Array((pos.length / 3) * 5);
    for (let i = 0; i < pos.length / 3; i++)
      attributes.set(
        [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]],
        i * 5,
      );
    const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
      part.indices,
      pos,
      3,
      attributes,
      5,
      [0.2, 0.2, 0.2, 1, 1],
      null,
      Math.floor((part.indices.length * 0.08) / 3) * 3,
      0.00008,
      ['LockBorder', 'ErrorAbsolute'],
    );
    part.indices = indices;
    errors[side] = error;
  }
  // Use the exact same topology inside and outside, retaining the tapered lining.
  parts.lining.indices = new Uint32Array(parts.front.indices.length + parts.back.indices.length);
  let cursor = 0;
  for (const side of ['front', 'back']) {
    const ix = parts[side].indices,
      offset = side === 'back' ? frontVertices : 0;
    for (let i = 0; i < ix.length; i += 3) {
      parts.lining.indices[cursor++] = ix[i + 2] + offset;
      parts.lining.indices[cursor++] = ix[i + 1] + offset;
      parts.lining.indices[cursor++] = ix[i] + offset;
    }
  }
  const metadata = { version: 1, productId: product.id, parts: {} },
    chunks = [];
  let byteOffset = 0;
  const append = (array) => {
    const result = { offset: byteOffset, length: array.length };
    chunks.push(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    byteOffset += array.byteLength;
    return result;
  };
  for (const [name, part] of Object.entries(parts)) {
    const [remap, count] = MeshoptEncoder.reorderMesh(part.indices, true, false),
      attributes = {};
    for (const [attr, { array, itemSize }] of Object.entries(part.attributes)) {
      const compact = new Float32Array(count * itemSize);
      for (let i = 0; i < remap.length; i++)
        if (remap[i] !== 0xffffffff)
          for (let j = 0; j < itemSize; j++)
            compact[remap[i] * itemSize + j] = array[i * itemSize + j];
      attributes[attr] = { ...append(compact), itemSize };
    }
    metadata.parts[name] = { attributes, index: append(part.indices) };
  }
  const header = Buffer.from(JSON.stringify(metadata)),
    prefix = Buffer.alloc(8 + Math.ceil(header.length / 4) * 4);
  prefix.writeUInt32LE(0x3147564d, 0);
  prefix.writeUInt32LE(header.length, 4);
  header.copy(prefix, 8);
  const raw = Buffer.concat([prefix, ...chunks]),
    compressed = gzipSync(raw, { level: 9 });
  fs.writeFileSync(`${output}/${product.id}.mvgz`, compressed);
  const after = Object.values(parts).reduce((n, p) => n + p.indices.length / 3, 0);
  const record = {
    id: product.id,
    beforeTriangles: before,
    afterTriangles: after,
    errorMetricMetres: errors,
    bytes: compressed.length,
    decodedBytes: raw.length,
    sha256: hash(compressed),
    elapsedMs: performance.now() - started,
  };
  models.push(record);
  console.log(JSON.stringify(record));
}
fs.writeFileSync(
  `${output}/manifest.json`,
  JSON.stringify(
    { version: 1, sourceHash, buildHash, optimizer: 'meshoptimizer 1.1.1', models },
    null,
    2,
  ),
);
