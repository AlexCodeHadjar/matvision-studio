import { BufferGeometry, Float32BufferAttribute, type Texture } from 'three';

function checkpoint(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Photo displacement отменён.', 'AbortError');
}

export interface HeightPixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  repeatX: number;
  repeatY: number;
  offsetX: number;
  offsetY: number;
  flipY: boolean;
}

export function readHeightPixels(texture: Texture): HeightPixels {
  const source = texture.image as CanvasImageSource & { width: number; height: number };
  if (!source?.width || !source?.height)
    throw new Error('Карта высоты недоступна для Photo displacement.');
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Не удалось прочитать карту высоты.');
  context.drawImage(source, 0, 0);
  return {
    width: canvas.width,
    height: canvas.height,
    rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
    repeatX: texture.repeat.x,
    repeatY: texture.repeat.y,
    offsetX: texture.offset.x,
    offsetY: texture.offset.y,
    flipY: texture.flipY,
  };
}

function heightAt(map: HeightPixels, u: number, v: number): number {
  const wrappedU = (((u * map.repeatX + map.offsetX) % 1) + 1) % 1;
  const wrappedV = (((v * map.repeatY + map.offsetY) % 1) + 1) % 1;
  const x = Math.min(map.width - 1, Math.floor(wrappedU * map.width));
  const y = Math.min(
    map.height - 1,
    Math.floor((map.flipY ? 1 - wrappedV : wrappedV) * map.height),
  );
  return map.rgba[(y * map.width + x) * 4]! / 255;
}

interface Vertex {
  p: [number, number, number];
  n: [number, number, number];
  uv: [number, number];
}

function middle(a: Vertex, b: Vertex): Vertex {
  return {
    p: [0, 1, 2].map((i) => (a.p[i]! + b.p[i]!) / 2) as Vertex['p'],
    n: [0, 1, 2].map((i) => (a.n[i]! + b.n[i]!) / 2) as Vertex['n'],
    uv: [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2],
  };
}

/** Only the cloned Photo top cap is subdivided. Realtime geometry is untouched. */
export async function displacePhotoGeometry(
  input: BufferGeometry,
  map: HeightPixels,
  amplitudeMm: number,
  signal: AbortSignal,
  maxTriangles = 200_000,
): Promise<BufferGeometry> {
  if (!(amplitudeMm > 0 && amplitudeMm <= 0.3)) throw new Error('Неверная амплитуда рельефа.');
  const source = input.index ? input.toNonIndexed() : input.clone();
  try {
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    if (!position || !normal || !uv)
      throw new Error('Для геометрического рельефа нужны UV и нормали.');
    const triangles = position.count / 3;
    const levels = triangles * 16 <= maxTriangles ? 2 : triangles * 4 <= maxTriangles ? 1 : 0;
    if (!levels)
      throw new Error(
        `Сцена слишком детальна для безопасного Photo displacement: ${triangles} треугольников до subdivision.`,
      );
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const emit = (a: Vertex, b: Vertex, c: Vertex, depth: number): void => {
      if (depth) {
        const ab = middle(a, b),
          bc = middle(b, c),
          ca = middle(c, a);
        emit(a, ab, ca, depth - 1);
        emit(ab, b, bc, depth - 1);
        emit(ca, bc, c, depth - 1);
        emit(ab, bc, ca, depth - 1);
        return;
      }
      for (const vertex of [a, b, c]) {
        const [u, v] = vertex.uv;
        // Taper displacement near the printable border so the cap meets the binding.
        const fade = Math.max(0, Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 50));
        const length = Math.hypot(...vertex.n) || 1;
        const amount = ((heightAt(map, u, v) - 0.5) * amplitudeMm * fade) / 1000;
        positions.push(...vertex.p.map((p, i) => p + (vertex.n[i]! / length) * amount));
        normals.push(...vertex.n.map((n) => n / length));
        uvs.push(u, v);
      }
    };
    const vertex = (i: number): Vertex => ({
      p: [position.getX(i), position.getY(i), position.getZ(i)],
      n: [normal.getX(i), normal.getY(i), normal.getZ(i)],
      uv: [uv.getX(i), uv.getY(i)],
    });
    for (let i = 0; i < position.count; i += 3) {
      if (i % 768 === 0) {
        checkpoint(signal);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      emit(vertex(i), vertex(i + 1), vertex(i + 2), levels);
    }
    checkpoint(signal);
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    result.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    result.computeVertexNormals();
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  } finally {
    source.dispose();
  }
}
