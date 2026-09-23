import { MeshPhysicalMaterial, SRGBColorSpace } from 'three';
import type { ProductDefinition, ProjectState } from '../contracts';
import { createDefaultProject } from '../project';
import { tileTextures, type MaterialTextures } from './assets';
import { attachFineHeight } from './height';
import { createDataMap } from './microtexture';
const RUBBER_TILE_MM = 16;
const SIZE = 512;

/** Short, interleaved diagonal impressions with rounded ends and fine molded grain. */
function rubberHeights() {
  const data = new Float32Array(SIZE * SIZE);
  let seed = 13841;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const wrap = (n: number) => ((n % SIZE) + SIZE) % SIZE;
  const cell = SIZE / 16;
  for (let row = 0; row < 16; row++)
    for (let column = 0; column < 16; column++) {
      const angle = (((column + row) % 2 ? -1 : 1) * Math.PI) / 4 + (random() - 0.5) * 0.16;
      const dx = Math.cos(angle),
        dy = Math.sin(angle);
      for (let strand = -1; strand <= 1; strand++) {
        const shift = strand * cell * 0.25;
        const cx = (column + 0.5) * cell - dy * shift + (random() - 0.5) * 2;
        const cy = (row + 0.5) * cell + dx * shift + (random() - 0.5) * 2;
        const half = cell * (0.33 + random() * 0.1),
          radius = 1.7 + random() * 0.6;
        const extent = Math.ceil(half + radius * 2);
        for (let y = Math.floor(cy) - extent; y <= Math.ceil(cy) + extent; y++)
          for (let x = Math.floor(cx) - extent; x <= Math.ceil(cx) + extent; x++) {
            const px = x - cx,
              py = y - cy;
            const along = Math.max(-half, Math.min(half, px * dx + py * dy));
            const distance = (px - along * dx) ** 2 + (py - along * dy) ** 2;
            if (distance > radius * radius * 4) continue;
            const i = wrap(y) * SIZE + wrap(x);
            data[i] = Math.max(data[i]!, 0.65 * Math.exp(-distance / (radius * radius * 0.7)));
          }
      }
    }
  for (let i = 0; i < data.length; i++) data[i] = data[i]! + (random() - 0.5) * 0.08;
  return data;
}

export function createRubberMaterial(product: ProductDefinition) {
  const normalBytes = new Uint8Array(SIZE * SIZE * 4),
    colorBytes = new Uint8Array(SIZE * SIZE * 4),
    roughnessBytes = new Uint8Array(SIZE * SIZE * 4);
  const heights = rubberHeights();
  const at = (x: number, y: number) => heights[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const height = at(x, y);
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4,
        dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
      const length = Math.hypot(dx, dy, 1),
        i = (y * SIZE + x) * 4;
      normalBytes[i] = Math.round(127.5 - (127.5 * dx) / length);
      normalBytes[i + 1] = Math.round(127.5 - (127.5 * dy) / length);
      normalBytes[i + 2] = Math.round(127.5 + 127.5 / length);
      normalBytes[i + 3] = 255;
      const gray = Math.round(44 + 35 * Math.max(0, height));
      colorBytes.set([gray, gray + 1, gray, 255], i);
      const rough = Math.round(250 - 25 * Math.max(0, height));
      roughnessBytes.set([rough, rough, rough, 255], i);
    }
  const normal = createDataMap(normalBytes, SIZE),
    color = createDataMap(colorBytes, SIZE),
    roughness = createDataMap(roughnessBytes, SIZE);
  color.colorSpace = SRGBColorSpace;
  const textures = [normal, color, roughness];
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    map: color,
    roughness: 0.96,
    metalness: 0,
    normalMap: normal,
    roughnessMap: roughness,
    specularIntensity: 0.42,
    ior: 1.48,
  });
  material.name = 'MatVision fine embossed herringbone anti-slip rubber';
  attachFineHeight(material);
  material.normalScale.setScalar(0.95);
  let disposed = false;
  let imported: MaterialTextures = {};
  const controller = {
    material,
    setMaps(maps: MaterialTextures) {
      imported = maps;
      material.needsUpdate = true;
    },
    get ownedTextureBytes() {
      return disposed ? 0 : Math.ceil((SIZE * SIZE * 4 * 3 * 4) / 3);
    },
    update(
      nextProduct: ProductDefinition,
      state: ProjectState = createDefaultProject(nextProduct.id),
    ) {
      for (const texture of textures) {
        texture.repeat.set(
          nextProduct.widthMm / RUBBER_TILE_MM,
          nextProduct.heightMm / RUBBER_TILE_MM,
        );
        texture.anisotropy = 8;
      }
      tileTextures(imported, state.materials.rubber, nextProduct.widthMm, nextProduct.heightMm);
      material.map = imported.color ?? color;
      material.normalMap = imported.normal ?? normal;
      material.roughnessMap = imported.roughness ?? roughness;
      material.bumpMap = imported.height ?? null;
      material.bumpScale = 0.00015 * state.realism.rubberRelief;
      const strength = (imported.normal ? 0.6 : 0.95) * state.realism.rubberRelief;
      material.normalScale.set(
        strength,
        imported.normal && state.materials.rubber.normalY === 'directx' ? -strength : strength,
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures) texture.dispose();
      material.dispose();
    },
  };
  controller.update(product);
  return controller;
}
