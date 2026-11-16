/** Hard realtime limits. Every number the renderer may spend lives here.
 * Code clamps to these values; tests and the build check that nothing exceeds them.
 */
export const RENDER_BUDGET = Object.freeze({
  /** 60 FPS target. */
  targetFrameMs: 1000 / 60,
  /** Sustained frames slower than this lower the render scale. */
  slowFrameMs: 22,
  /** Sustained frames at least this fast may raise the render scale again. */
  fastFrameMs: 17.5,
  minRenderScale: 0.5,
  renderScaleStepDown: 0.85,
  renderScaleStepUp: 1.1,
  /** Continuous frames averaged before the governor decides. */
  governorWindowFrames: 30,
  /** Windows to wait after lowering the scale before trying to raise it. */
  governorCooldownWindows: 6,
  /** With nothing changing, the scene refreshes at most this often. */
  idleRefreshMs: 500,
  maxPixelRatio: 2,
  /** 2560 × 1440. */
  maxFramePixels: 3_686_400,
  /** 1920 × 1080: detailed mode adds AO, SMAA and half-float multisampled targets. */
  maxDetailedFramePixels: 2_073_600,
  maxShadowMapSize: 2048,
  maxEnvironmentWidth: 1024,
  maxPreviewEdgePx: 4096,
  maxAnisotropy: 8,
  /** Owned texture storage estimate, see performance.ts. */
  maxTextureBytes: 256 * 1024 * 1024,
  /** Per frame, shadow pass included. The largest stitched mat measures about 1.61 million. */
  maxTriangles: 2_000_000,
  maxDrawCalls: 64,
  maxExportEdgePx: 4096,
  /** 3840 × 2160. */
  maxExportPixels: 8_294_400,
  exportHighEdgePx: 3840,
  /** Largest emitted JavaScript chunk, uncompressed. Checked by scripts/check-bundle-budget.mjs. */
  maxBundleJsBytes: 1_600_000,
});

/** Pixel ratio that keeps the drawing buffer inside the frame budget. */
export function budgetPixelRatio(input: {
  devicePixelRatio: number;
  presetPixelRatio: number;
  cssWidth: number;
  cssHeight: number;
  renderScale: number;
  detailed: boolean;
}): number {
  const { cssWidth, cssHeight } = input;
  if (!(cssWidth > 0) || !(cssHeight > 0)) return 1;
  const wanted =
    Math.min(input.devicePixelRatio, input.presetPixelRatio, RENDER_BUDGET.maxPixelRatio) *
    Math.min(1, Math.max(RENDER_BUDGET.minRenderScale, input.renderScale));
  const pixels = input.detailed
    ? RENDER_BUDGET.maxDetailedFramePixels
    : RENDER_BUDGET.maxFramePixels;
  // The drawing buffer is floor(css × ratio); stay strictly under the limit.
  const fit = Math.sqrt(pixels / (cssWidth * cssHeight));
  return Math.max(0.25, Math.min(wanted, fit));
}

export interface GovernorState {
  scale: number;
  /** Windows left before an increase is allowed. */
  cooldown: number;
}

/** One decision per window of continuous frames. Lowers quickly, raises cautiously. */
export function governRenderScale(state: GovernorState, averageFrameMs: number): GovernorState {
  if (!Number.isFinite(averageFrameMs) || averageFrameMs <= 0) return state;
  if (averageFrameMs > RENDER_BUDGET.slowFrameMs) {
    const scale = Math.max(
      RENDER_BUDGET.minRenderScale,
      state.scale * RENDER_BUDGET.renderScaleStepDown,
    );
    return { scale, cooldown: RENDER_BUDGET.governorCooldownWindows };
  }
  if (state.cooldown > 0) return { scale: state.scale, cooldown: state.cooldown - 1 };
  if (averageFrameMs <= RENDER_BUDGET.fastFrameMs && state.scale < 1)
    return { scale: Math.min(1, state.scale * RENDER_BUDGET.renderScaleStepUp), cooldown: 1 };
  return state;
}

export function exportWithinBudget(widthPx: number, heightPx: number, gpuLimit: number): boolean {
  const edge = Math.min(RENDER_BUDGET.maxExportEdgePx, gpuLimit);
  return (
    [widthPx, heightPx].every((n) => Number.isInteger(n) && n > 0 && n <= edge) &&
    widthPx * heightPx <= RENDER_BUDGET.maxExportPixels
  );
}

export interface BudgetSample {
  triangles: number;
  drawCalls: number;
  approximateTextureBytes: number;
  rendererWidthPx: number;
  rendererHeightPx: number;
  shadowSize: number;
  environmentWidth: number;
  detailed: boolean;
}

/** Names of exceeded limits; empty when the frame is inside the budget. */
export function budgetViolations(sample: BudgetSample): string[] {
  const out: string[] = [];
  const pixels = sample.detailed
    ? RENDER_BUDGET.maxDetailedFramePixels
    : RENDER_BUDGET.maxFramePixels;
  if (sample.rendererWidthPx * sample.rendererHeightPx > pixels) out.push('frame-pixels');
  if (sample.triangles > RENDER_BUDGET.maxTriangles) out.push('triangles');
  if (sample.drawCalls > RENDER_BUDGET.maxDrawCalls) out.push('draw-calls');
  if (sample.approximateTextureBytes > RENDER_BUDGET.maxTextureBytes) out.push('texture-bytes');
  if (sample.shadowSize > RENDER_BUDGET.maxShadowMapSize) out.push('shadow-map');
  if (sample.environmentWidth > RENDER_BUDGET.maxEnvironmentWidth) out.push('environment');
  return out;
}
