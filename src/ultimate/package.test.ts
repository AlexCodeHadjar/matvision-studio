import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../project';
import { createCyclesPackage, cyclesPrototypeWarnings } from './package';
import { existsSync, readFileSync } from 'node:fs';

describe('Cycles temporary package', () => {
  it('keeps camera, dimensions and print transform separate from the project schema', () => {
    const state = createDefaultProject();
    const document = createCyclesPackage(state, state.camera, {
      widthPx: 512,
      heightPx: 320,
      samples: 16,
      device: 'CPU',
    });
    expect(document.schemaVersion).toBe(1);
    expect(document.product).toMatchObject({ widthMm: 900, heightMm: 400, thicknessMm: 3 });
    expect(document.printInverse).toHaveLength(9);
    expect(document.camera.positionMm[0]).toBeCloseTo(700);
    expect('dataUrl' in document).toBe(false);
  });

  it('warns about every scene feature missing from the prototype', () => {
    const state = createDefaultProject();
    state.edgePreset = 'stitched';
    state.rollAmount = 0.5;
    expect(cyclesPrototypeWarnings(state)).toHaveLength(3);
  });

  it('keeps eight named reference scenes with present print fixtures', () => {
    const manifest = JSON.parse(
      readFileSync('tests/fixtures/renderer-reference-scenes.json', 'utf8'),
    ) as {
      scenes: { id: string; print: string }[];
    };
    expect(manifest.scenes).toHaveLength(8);
    expect(new Set(manifest.scenes.map((scene) => scene.id)).size).toBe(8);
    for (const scene of manifest.scenes)
      expect(existsSync(`tests/fixtures/${scene.print}`), scene.id).toBe(true);
  });
});
