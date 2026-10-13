import { BufferAttribute, BufferGeometry } from 'three';
import type { ProductDefinition } from '../contracts';
import type { CatalogGeometry } from './catalog';
interface Stream {
  offset: number;
  length: number;
  itemSize?: number;
}
interface Packed {
  buffer: ArrayBuffer;
  start: number;
  parts: Record<string, { attributes: Record<string, Stream>; index: Stream }>;
}
// Restricted to the seven bundled models. Only CPU buffers are retained between products.
const ids = new Set([
  'hoodie-white',
  'sweatshirt-white',
  'longsleeve-white',
  'polo-white',
  'tote-white',
  'cap-white',
  'apron-white',
]);
const cache = new Map<string, Promise<Packed>>();
async function prepare(product: ProductDefinition): Promise<Packed> {
  if (!ids.has(product.id)) throw Error('Неизвестная модель изделия.');
  let promise = cache.get(product.id);
  if (!promise) {
    promise = (async () => {
      const response = await fetch(`/models/catalog/${product.id}.mvgz`);
      if (!response.ok || !response.body)
        throw Error('Не удалось загрузить встроенную модель изделия.');
      const buffer = await new Response(
        response.body.pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer();
      const prefix = new DataView(buffer),
        length = prefix.getUint32(4, true);
      if (prefix.getUint32(0, true) !== 0x3147564d) throw Error('Повреждена модель изделия.');
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
      if (header.version !== 1 || header.productId !== product.id)
        throw Error('Неверная версия модели изделия.');
      return { buffer, start: 8 + Math.ceil(length / 4) * 4, parts: header.parts };
    })().catch((error) => {
      cache.delete(product.id);
      throw error;
    });
    cache.set(product.id, promise);
  }
  return promise;
}
export async function prepareCatalogProduct(product: ProductDefinition) {
  await prepare(product);
}
export async function loadCatalogProduct(product: ProductDefinition): Promise<CatalogGeometry> {
  const packed = await prepare(product),
    result = {} as CatalogGeometry;
  for (const [name, part] of Object.entries(packed.parts)) {
    const g = new BufferGeometry();
    for (const [name, s] of Object.entries(part.attributes))
      g.setAttribute(
        name,
        new BufferAttribute(
          new Float32Array(packed.buffer, packed.start + s.offset, s.length),
          s.itemSize!,
        ),
      );
    const s = part.index;
    g.setIndex(
      new BufferAttribute(new Uint32Array(packed.buffer, packed.start + s.offset, s.length), 1),
    );
    g.computeBoundingBox();
    g.computeBoundingSphere();
    result[name as keyof CatalogGeometry] = g;
  }
  return result;
}
