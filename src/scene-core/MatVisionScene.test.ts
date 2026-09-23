import { describe, expect, it } from 'vitest';
import { createDefaultProject, migrateProject } from '../project';
import { cameraFromScene, createMatVisionScene, metresToMm, mmToMetres } from './MatVisionScene';

describe('renderer-independent scene projection', () => {
  it('keeps catalogue millimetres and converts camera/light positions at the boundary', () => {
    const state = createDefaultProject();
    const scene = createMatVisionScene(state);
    expect(scene.product.widthMm).toBe(900);
    expect(scene.product.heightMm).toBe(400);
    expect(scene.camera.positionMm).toEqual(state.camera.position.map((value) => value * 1000));
    expect(scene.lights[0]?.positionMm).toEqual([-950, 1250, 650]);
    expect(cameraFromScene(scene)).toEqual(state.camera);
    expect(mmToMetres(metresToMm(0.123))).toBeCloseTo(0.123);
  });

  it('uses asset metadata without duplicating embedded image bytes or mutating a project', () => {
    const state = createDefaultProject();
    const source = {
      name: 'fabric.png',
      mimeType: 'image/png' as const,
      dataUrl: 'data:image/png;base64,AQID',
      widthPx: 64,
      heightPx: 32,
    };
    state.source = source;
    state.materials.fabric.maps.normal = source;
    const before = JSON.stringify(state);
    const scene = createMatVisionScene(state);
    expect(scene.print.source).toEqual({
      name: 'fabric.png',
      mimeType: 'image/png',
      widthPx: 64,
      heightPx: 32,
    });
    expect(scene.materials.fabric.maps.normal).toEqual(scene.print.source);
    expect(JSON.stringify(scene)).not.toContain('base64');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('projects migrated legacy projects without adding fields to the saved format', () => {
    for (const version of [0, 1] as const) {
      const migrated = migrateProject({
        format: 'matvision-project',
        version,
        state:
          version === 0
            ? { productId: 'mousepad-400x450' }
            : createDefaultProject('mousepad-400x450'),
      });
      expect(createMatVisionScene(migrated.state).product.id).toBe('mousepad-400x450');
      expect(migrated.version).toBe(2);
    }
  });
});
