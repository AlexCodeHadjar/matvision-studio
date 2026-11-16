import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  RENDER_BUDGET,
  budgetPixelRatio,
  budgetViolations,
  exportWithinBudget,
  governRenderScale,
} from './budget';
import { QUALITY_SETTINGS } from './quality';
import { PREVIEW_EDGE_LIMITS } from '../print-layout/layout';
import { PRODUCTS } from '../products';
import { createMatGeometry } from '../geometry/mat';
import { createStitchedGeometry } from '../geometry/stitch';
import { createDefaultProject, parseProject, serializeProject } from '../project';

const framePixels = (w: number, h: number, ratio: number) =>
  Math.floor(w * ratio) * Math.floor(h * ratio);

describe('frame pixel budget', () => {
  it.each([
    [1440, 900, 1],
    [1920, 1080, 1.5],
    [2560, 1440, 2],
    [3840, 2160, 2],
    [5120, 1440, 3],
    [1000.5, 680.25, 1.25],
  ])('keeps a %f × %f viewport at DPR %f inside the limit', (w, h, dpr) => {
    for (const detailed of [false, true])
      for (const preset of Object.values(QUALITY_SETTINGS)) {
        const ratio = budgetPixelRatio({
          devicePixelRatio: dpr,
          presetPixelRatio: preset.pixelRatio,
          cssWidth: w,
          cssHeight: h,
          renderScale: 1,
          detailed,
        });
        expect(ratio).toBeLessThanOrEqual(RENDER_BUDGET.maxPixelRatio);
        expect(framePixels(w, h, ratio)).toBeLessThanOrEqual(
          detailed ? RENDER_BUDGET.maxDetailedFramePixels : RENDER_BUDGET.maxFramePixels,
        );
      }
  });
  it('never renders above the device or preset ratio', () => {
    const base = { cssWidth: 800, cssHeight: 600, renderScale: 1, detailed: false };
    expect(budgetPixelRatio({ ...base, devicePixelRatio: 1, presetPixelRatio: 2 })).toBe(1);
    expect(budgetPixelRatio({ ...base, devicePixelRatio: 3, presetPixelRatio: 1.5 })).toBe(1.5);
  });
  it('applies the governor scale and its floor', () => {
    const base = {
      cssWidth: 800,
      cssHeight: 600,
      devicePixelRatio: 2,
      presetPixelRatio: 2,
      detailed: false,
    };
    expect(budgetPixelRatio({ ...base, renderScale: 0.5 })).toBe(1);
    expect(budgetPixelRatio({ ...base, renderScale: 0.1 })).toBe(1);
    expect(budgetPixelRatio({ ...base, renderScale: 5 })).toBe(2);
  });
  it('survives an empty host', () =>
    expect(
      budgetPixelRatio({
        devicePixelRatio: 2,
        presetPixelRatio: 2,
        cssWidth: 0,
        cssHeight: 0,
        renderScale: 1,
        detailed: false,
      }),
    ).toBe(1));
});

describe('render scale governor', () => {
  it('lowers the scale on slow frames, down to the floor only', () => {
    let state = { scale: 1, cooldown: 0 };
    for (let i = 0; i < 40; i++) state = governRenderScale(state, 40);
    expect(state.scale).toBe(RENDER_BUDGET.minRenderScale);
  });
  it('holds at target frame time', () => {
    const state = { scale: 1, cooldown: 0 };
    expect(governRenderScale(state, RENDER_BUDGET.targetFrameMs)).toEqual(state);
  });
  it('waits out the cooldown before raising, and never exceeds 1', () => {
    let state = governRenderScale({ scale: 1, cooldown: 0 }, 30);
    const lowered = state.scale;
    expect(lowered).toBeLessThan(1);
    for (let i = 0; i < RENDER_BUDGET.governorCooldownWindows; i++) {
      state = governRenderScale(state, 16.7);
      expect(state.scale).toBe(lowered);
    }
    for (let i = 0; i < 40; i++) state = governRenderScale(state, 16.7);
    expect(state.scale).toBe(1);
  });
  it('ignores invalid measurements', () => {
    const state = { scale: 0.8, cooldown: 2 };
    for (const ms of [NaN, 0, -1, Infinity]) expect(governRenderScale(state, ms)).toBe(state);
  });
});

describe('quality presets stay inside the budget', () => {
  it('has no preset above any limit', () => {
    for (const preset of Object.values(QUALITY_SETTINGS)) {
      expect(preset.pixelRatio).toBeLessThanOrEqual(RENDER_BUDGET.maxPixelRatio);
      expect(preset.shadowSize).toBeLessThanOrEqual(RENDER_BUDGET.maxShadowMapSize);
      expect(preset.environmentWidth).toBeLessThanOrEqual(RENDER_BUDGET.maxEnvironmentWidth);
    }
    for (const edge of Object.values(PREVIEW_EDGE_LIMITS))
      expect(edge).toBeLessThanOrEqual(RENDER_BUDGET.maxPreviewEdgePx);
    expect(Object.keys(QUALITY_SETTINGS)).toEqual(['low', 'balanced', 'high']);
  });
  it('starts new projects on the balanced preset', () =>
    expect(createDefaultProject().quality).toBe('balanced'));
  it('opens projects saved with the removed ultra preset as high', () => {
    const document = JSON.parse(serializeProject(createDefaultProject()));
    document.state.quality = 'ultra';
    expect(parseProject(JSON.stringify(document)).quality).toBe('high');
  });
});

describe('geometry budget', () => {
  const triangles = (geometry: BufferGeometry) =>
    (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
  it.each(PRODUCTS.map((product) => [product.id, product] as const))(
    '%s with a stitched edge fits one frame including its shadow pass',
    (_id, product) => {
      const { body, top } = createMatGeometry(product, product.thicknessMm);
      const stitched = createStitchedGeometry(product, product.thicknessMm);
      const casters = triangles(body) + triangles(top) + triangles(stitched.geometry);
      const threads = triangles(stitched.threadGeometry) * stitched.stitchCount;
      // Shadow casters are drawn twice; yarn loops and the floor once.
      expect(2 * casters + threads + 2).toBeLessThanOrEqual(RENDER_BUDGET.maxTriangles);
    },
  );
});

describe('export and runtime checks', () => {
  it('bounds PNG snapshots by edge, area and GPU limit', () => {
    expect(exportWithinBudget(3840, 2160, 16384)).toBe(true);
    expect(exportWithinBudget(4096, 2025, 16384)).toBe(true);
    expect(exportWithinBudget(4096, 4096, 16384)).toBe(false);
    expect(exportWithinBudget(4097, 100, 16384)).toBe(false);
    expect(exportWithinBudget(3000, 1000, 2048)).toBe(false);
    expect(exportWithinBudget(0, 100, 16384)).toBe(false);
    expect(exportWithinBudget(100.5, 100, 16384)).toBe(false);
  });
  it('reports each exceeded limit by name', () => {
    const inside = {
      triangles: 1_000_000,
      drawCalls: 10,
      approximateTextureBytes: 64 * 1024 * 1024,
      rendererWidthPx: 1920,
      rendererHeightPx: 1080,
      shadowSize: 2048,
      environmentWidth: 1024,
      detailed: true,
    };
    expect(budgetViolations(inside)).toEqual([]);
    expect(
      budgetViolations({
        triangles: 3_000_000,
        drawCalls: 500,
        approximateTextureBytes: 2 ** 31,
        rendererWidthPx: 3840,
        rendererHeightPx: 2160,
        shadowSize: 4096,
        environmentWidth: 2048,
        detailed: false,
      }),
    ).toEqual([
      'frame-pixels',
      'triangles',
      'draw-calls',
      'texture-bytes',
      'shadow-map',
      'environment',
    ]);
    expect(budgetViolations({ ...inside, rendererWidthPx: 2560, rendererHeightPx: 1440 })).toEqual([
      'frame-pixels',
    ]);
  });
});
