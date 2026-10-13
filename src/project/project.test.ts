import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  migrateProject,
  parseProject,
  serializeProject,
  validateProjectState,
} from './index';

describe('project schema', () => {
  it('round trips original pixels, portable source bytes and every user setting', () => {
    const state = createDefaultProject('mousepad-400x450');
    state.source = {
      name: 'тест image.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQID',
      widthPx: 10630,
      heightPx: 4724,
    };
    state.layout = { mode: 'contain', scale: 1.25, offsetX: -0.2, offsetY: 0.1, rotationDeg: 37 };
    state.edgePreset = 'stitched';
    state.thicknessMm = 4;
    state.camera.preset = 'top';
    state.turntable = true;
    state.referenceMode = true;
    state.materialProfile.saturation = 0.9;
    expect(parseProject(serializeProject(state))).toEqual(state);
    expect(serializeProject(state)).not.toContain('previewResolution');
  });

  it('creates independent mutable states', () => {
    const first = createDefaultProject();
    first.camera.position[0] = 99;
    first.layout.scale = 4;
    first.materialProfile.roughness = 0.5;
    const second = createDefaultProject();
    expect(second.camera.position[0]).toBe(0.7);
    expect(second.layout.scale).toBe(1);
    expect(second.materialProfile.roughness).toBe(0.88);
  });

  it('migrates the explicit version 0 schema and preserves supplied settings', () => {
    const migrated = migrateProject({
      format: 'matvision-project',
      version: 0,
      state: { productId: 'mousepad-400x450', layout: { scale: 2 } },
    });
    expect(migrated.version).toBe(2);
    expect(migrated.state.productId).toBe('mousepad-400x450');
    expect(migrated.state.layout).toEqual({
      mode: 'cover',
      scale: 2,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
    });
    expect(migrated.state.source).toBeNull();
  });

  it('rejects unknown schemas, malformed data and unsafe numeric values', () => {
    expect(() => parseProject('{')).toThrow();
    expect(() => migrateProject({ format: 'unrelated', version: 1 })).toThrow();
    expect(() => migrateProject({ format: 'matvision-project', version: 3 })).toThrow(
      'Unsupported project version',
    );
    expect(() => validateProjectState({ ...createDefaultProject(), thicknessMm: -3 })).toThrow();
    expect(() => validateProjectState({ ...createDefaultProject(), roughness: NaN })).toThrow();
    expect(() => validateProjectState({ ...createDefaultProject(), turntable: 'false' })).toThrow();
    expect(() =>
      validateProjectState({
        ...createDefaultProject(),
        layout: { mode: 'cover', scale: Infinity },
      }),
    ).toThrow();
    expect(() =>
      validateProjectState({
        ...createDefaultProject(),
        camera: { preset: 'top', position: [0, 0, 0], target: [0, 0, 0], fovDeg: 35 },
      }),
    ).toThrow();
  });

  it('rejects mismatched source MIME, remote references and fractional dimensions', () => {
    const state = createDefaultProject();
    const source = {
      name: 'image.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQID',
      widthPx: 100,
      heightPx: 100,
    };
    for (const changed of [
      { ...source, dataUrl: 'https://example.com/image.png' },
      { ...source, mimeType: 'image/jpeg' },
      { ...source, widthPx: 1.5 },
      { ...source, dataUrl: 'data:image/png;base64,???=' },
    ])
      expect(() => validateProjectState({ ...state, source: changed })).toThrow();
  });
});
