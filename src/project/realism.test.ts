import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  migrateProject,
  parseProject,
  serializeProject,
  validateProjectState,
} from './index';
import { createFabricMaterial } from '../materials/fabric';
import { getProduct } from '../products';
import { Matrix3, NoColorSpace, Texture } from 'three';

describe('portable materials and legacy projects', () => {
  it('opens v1 with neutral controls and embeds independent fabric/backing sets in v2', () => {
    const original = createDefaultProject();
    const legacy = { ...original, materials: undefined, realism: undefined };
    expect(
      migrateProject({ format: 'matvision-project', version: 1, state: legacy }).state,
    ).toEqual(original);
    original.materials.fabric.maps.normal = {
      name: 'normal.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQID',
      widthPx: 16,
      heightPx: 16,
    };
    original.materials.fabric.tileMm = 42;
    original.materials.fabric.normalY = 'directx';
    original.realism.mode = 'detailed';
    expect(parseProject(serializeProject(original))).toEqual(original);
    expect(JSON.parse(serializeProject(original)).version).toBe(2);
    expect(original.materials.rubber.maps).toEqual({});
  });
  it('rejects malformed material settings and oversized maps before GPU decoding', () => {
    const state = createDefaultProject();
    for (const tileMm of [0, NaN, Infinity, 2001]) {
      state.materials.fabric.tileMm = tileMm;
      expect(() => validateProjectState(state)).toThrow();
    }
    state.materials.fabric.tileMm = 100;
    state.materials.fabric.maps.height = {
      name: 'height.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQID',
      widthPx: 8192,
      heightPx: 8192,
    };
    expect(() => validateProjectState(state)).toThrow('16');
    state.materials.fabric.maps.height.widthPx = 16;
    state.materials.fabric.maps.height.dataUrl = 'https://example.com/private-file';
    expect(() => validateProjectState(state)).toThrow();
    state.materials.fabric.maps.height.dataUrl =
      'data:image/png;base64,' + 'AAAA'.repeat(2_800_000);
    expect(() => validateProjectState(state)).toThrow('8');
    state.materials.fabric.maps = {};
    state.realism.relief = -1;
    expect(() => validateProjectState(state)).toThrow();
  });
});

it('keeps physical material tiling separate from print UV, flips normal Y, and preserves ownership', () => {
  const state = createDefaultProject(),
    product = getProduct(state.productId);
  const cloth = createFabricMaterial(product, state);
  const normal = new Texture(),
    height = new Texture(),
    color = new Texture(),
    print = new Texture();
  normal.colorSpace = NoColorSpace;
  state.materials.fabric.tileMm = 50;
  state.materials.fabric.normalY = 'directx';
  cloth.setMaps({ normal, color, height });
  cloth.setPrintTexture(print);
  cloth.update(product, state);
  expect(cloth.material.normalMap).toBe(normal);
  expect(cloth.material.map).toBe(print);
  expect(normal.repeat.toArray()).toEqual([18, 8]);
  expect(cloth.material.normalScale.y).toBeLessThan(0);
  expect(cloth.material.bumpMap).toBe(height);
  const transform = new Matrix3().copy(normal.matrix);
  state.layout.scale = 3;
  cloth.update(product, state);
  expect(normal.matrix.equals(transform)).toBe(true);
  let disposed = 0;
  normal.addEventListener('dispose', () => disposed++);
  cloth.setMaps({});
  cloth.update(product, state);
  expect(cloth.material.normalMap).not.toBe(normal);
  expect(cloth.material.bumpMap).toBeNull();
  expect(cloth.material.normalScale.y).toBeGreaterThan(0);
  cloth.dispose();
  expect(disposed).toBe(0); // Scene, not material, owns imported maps.
  [normal, height, color, print].forEach((texture) => texture.dispose());
});
