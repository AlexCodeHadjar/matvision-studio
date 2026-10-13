import { BufferAttribute, BufferGeometry } from 'three';
import type { ProductDefinition } from '../contracts';
import type { createGarment } from './garment';

type Garment = ReturnType<typeof createGarment>;
interface Stream {
  offset: number;
  length: number;
  itemSize?: number;
}
interface PackedGarment {
  buffer: ArrayBuffer;
  dataOffset: number;
  parts: Record<keyof Garment, { attributes: Record<string, Stream>; index: Stream }>;
}
// Only the two bundled profiles are cached. GPU geometries remain instance-owned.
const cache = new Map<string, Promise<PackedGarment>>();

async function readModel(id: string): Promise<PackedGarment> {
  const response = await fetch(`/models/garments/${id}.mvgz`);
  if (!response.ok || !response.body)
    throw new Error('Не удалось загрузить встроенную модель футболки.');
  const buffer = await new Response(
    response.body.pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
  const prefix = new DataView(buffer);
  if (prefix.getUint32(0, true) !== 0x3147564d) throw new Error('Повреждена модель футболки.');
  const length = prefix.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  if (header.version !== 1 || header.productId !== id)
    throw new Error('Неверная версия модели футболки.');
  return { buffer, parts: header.parts, dataOffset: 8 + Math.ceil(length / 4) * 4 };
}

async function preparedModel(product: ProductDefinition): Promise<PackedGarment> {
  if (!['tshirt-gildan-5000', 'tshirt-bella-3001'].includes(product.id))
    throw new Error('Неизвестная модель футболки.');
  let pending = cache.get(product.id);
  if (!pending) {
    pending = readModel(product.id).catch((error) => {
      cache.delete(product.id);
      throw error;
    });
    cache.set(product.id, pending);
  }
  return pending;
}

/** Fail before replacing the current product if a packaged resource is missing. */
export async function prepareGarment(product: ProductDefinition): Promise<void> {
  await preparedModel(product);
}

/** Load the already prepared garment; no tessellation or relaxation runs in the UI. */
export async function loadGarment(product: ProductDefinition): Promise<Garment> {
  const packed = await preparedModel(product);
  const geometries = {} as Garment;
  for (const [name, part] of Object.entries(packed.parts)) {
    const geometry = new BufferGeometry();
    for (const [attribute, stream] of Object.entries(part.attributes))
      geometry.setAttribute(
        attribute,
        new BufferAttribute(
          new Float32Array(packed.buffer, packed.dataOffset + stream.offset, stream.length),
          stream.itemSize!,
        ),
      );
    geometry.setIndex(
      new BufferAttribute(
        new Uint32Array(packed.buffer, packed.dataOffset + part.index.offset, part.index.length),
        1,
      ),
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometries[name as keyof Garment] = geometry;
  }
  return geometries;
}
