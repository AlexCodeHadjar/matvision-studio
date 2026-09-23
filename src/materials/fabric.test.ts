import { describe, expect, it } from 'vitest';
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { createDefaultMaterialProfile, createDefaultProject } from '../project';
import { getProduct } from '../products';
import { createFabricMaterial } from './fabric';
import { FABRIC_PRESETS, generateFabricMaps } from './microtexture';
import { compensateLinearColor } from './profile';
import { createRubberMaterial } from './rubber';
import { createStitchedMaterial } from './stitched';
import { STITCH_PITCH_M } from '../geometry/stitch';

describe('physical fabric and resource ownership', () => {
  it('keeps weave scale physical and independent from the artwork layout', () => {
    const state = createDefaultProject();
    const desk = getProduct(state.productId);
    const cloth = createFabricMaterial(desk, state);
    const normal = cloth.material.normalMap!;
    expect(normal.colorSpace).toBe(NoColorSpace);
    expect(cloth.material.roughnessMap!.colorSpace).toBe(NoColorSpace);
    expect(normal.wrapS).toBe(RepeatWrapping);
    expect(normal.repeat.x).toBe(225);
    expect(normal.repeat.y).toBe(100);
    cloth.update(desk, { ...state, layout: { ...state.layout, scale: 3, rotationDeg: 47 } });
    expect(normal.repeat.toArray()).toEqual([225, 100]);
    cloth.update(getProduct('mousepad-400x450'), state);
    expect(normal.repeat.toArray()).toEqual([100, 112.5]);
    expect(cloth.material.metalness).toBe(0);
    expect(cloth.material.clearcoat).toBe(0);
    expect(cloth.material.transmission).toBe(0);
    expect(cloth.material.roughness).toBeCloseTo(0.88);
    cloth.dispose();
  });

  it('disposes replaced procedural maps and leaves imported artwork to its owner', () => {
    const state = createDefaultProject();
    const product = getProduct(state.productId);
    const cloth = createFabricMaterial(product, state);
    const artwork = new Texture();
    const counts = { oldNormal: 0, oldRoughness: 0, newNormal: 0, material: 0, artwork: 0 };
    cloth.material.normalMap!.addEventListener('dispose', () => counts.oldNormal++);
    cloth.material.roughnessMap!.addEventListener('dispose', () => counts.oldRoughness++);
    cloth.material.addEventListener('dispose', () => counts.material++);
    artwork.addEventListener('dispose', () => counts.artwork++);
    cloth.setPrintTexture(artwork);
    expect(artwork.colorSpace).toBe(SRGBColorSpace);
    cloth.update(product, { ...state, materialPreset: 'gaming-fabric' });
    expect(counts.oldNormal).toBe(1);
    expect(counts.oldRoughness).toBe(1);
    cloth.material.normalMap!.addEventListener('dispose', () => counts.newNormal++);
    cloth.dispose();
    cloth.dispose();
    expect(counts).toEqual({
      oldNormal: 1,
      oldRoughness: 1,
      newNormal: 1,
      material: 1,
      artwork: 0,
    });
    expect(cloth.ownedTextureBytes).toBe(0);
  });

  it('keeps every preset matte while applying live and supplier roughness controls', () => {
    const state = createDefaultProject();
    const product = getProduct(state.productId);
    const cloth = createFabricMaterial(product, state);
    for (const materialPreset of ['smooth-cloth', 'fine-weave', 'gaming-fabric'] as const) {
      cloth.update(product, { ...state, materialPreset });
      expect(cloth.material.roughness).toBeCloseTo(FABRIC_PRESETS[materialPreset].roughness);
      expect(cloth.material.sheen).toBeLessThan(0.25);
    }
    cloth.update(product, { ...state, roughness: 0.6 });
    expect(cloth.material.roughness).toBeCloseTo(0.6);
    cloth.update(product, {
      ...state,
      materialProfile: { ...state.materialProfile, roughness: 0.7 },
    });
    expect(cloth.material.roughness).toBeCloseTo(0.7);
    cloth.dispose();
  });
});

it('encodes finite upper-hemisphere unit normals and high roughness data', () => {
  for (const preset of ['smooth-cloth', 'fine-weave', 'gaming-fabric'] as const) {
    const { normal, roughness } = generateFabricMaps(preset, 64);
    let variedNormals = 0;
    for (let i = 0; i < normal.length; i += 4) {
      const x = (normal[i]! / 255) * 2 - 1;
      const y = (normal[i + 1]! / 255) * 2 - 1;
      const z = (normal[i + 2]! / 255) * 2 - 1;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
      expect(z).toBeGreaterThan(0);
      expect(roughness[i + 1]).toBeGreaterThanOrEqual(244);
      if (Math.hypot(x, y) > 0.05) variedNormals++;
    }
    expect(variedNormals).toBeGreaterThan(100);
  }
});

it('preserves neutral profile identity and exposes empirical black and saturation effects', () => {
  const profile = createDefaultMaterialProfile();
  const rgb: [number, number, number] = [0.08, 0.35, 0.77];
  const neutral = compensateLinearColor(rgb, profile);
  neutral.forEach((value, i) => expect(value).toBeCloseTo(rgb[i]!));
  expect(compensateLinearColor([0, 0, 0], { ...profile, blackLevel: 0.04 })).toEqual([
    0.04, 0.04, 0.04,
  ]);
  const gray = compensateLinearColor(rgb, { ...profile, saturation: 0 });
  expect(gray[0]).toBeCloseTo(gray[1]);
  expect(gray[1]).toBeCloseTo(gray[2]);
  const clamped = compensateLinearColor(rgb, { ...profile, brightness: 2, contrast: 2 });
  clamped.forEach((value) => expect(value >= 0 && value <= 1).toBe(true));
});

it('uses separate nonmetallic backing and stitch materials with bounded owned maps', () => {
  const rubber = createRubberMaterial(getProduct('deskmat-900x400'));
  const stitch = createStitchedMaterial(2.6);
  expect(rubber.material.roughness).toBeGreaterThan(0.9);
  expect(rubber.material.metalness).toBe(0);
  expect(stitch.material.metalness).toBe(0);
  expect(stitch.material.normalMap!.repeat.x).toBe(Math.round(2.6 / STITCH_PITCH_M));
  expect(rubber.ownedTextureBytes + stitch.ownedTextureBytes).toBeLessThan(5_000_000);
  rubber.dispose();
  stitch.dispose();
  expect(rubber.ownedTextureBytes + stitch.ownedTextureBytes).toBe(0);
});
