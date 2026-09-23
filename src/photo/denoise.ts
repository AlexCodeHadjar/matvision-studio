import { DenoiseMaterial } from 'three-gpu-pathtracer';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import type { DenoiseMode } from './settings';

/** The input is the path tracer's linear RGBA32F target, before ACES/sRGB output. */
export interface DenoiserBackend {
  readonly id: DenoiseMode;
  apply(target: WebGLRenderTarget, renderer: WebGLRenderer, signal?: AbortSignal): void;
  dispose(): void;
}

export class NoDenoise implements DenoiserBackend {
  readonly id = 'off';
  apply(): void {}
  dispose(): void {}
}

/** Bundled, edge-aware GLSL filter. It is a modest spatial filter, not OIDN. */
export class SmartDenoise implements DenoiserBackend {
  readonly id = 'smart';
  private readonly material = new DenoiseMaterial({ sigma: 2, kSigma: 1, threshold: 0.05 });
  private readonly quad = new FullScreenQuad(this.material);

  apply(target: WebGLRenderTarget, renderer: WebGLRenderer, signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Шумоподавление отменено.', 'AbortError');
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    try {
      this.material.map = target.texture;
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
      this.material.map = null;
    }
  }

  dispose(): void {
    this.quad.dispose();
  }
}

export function createDenoiser(mode: DenoiseMode): DenoiserBackend {
  return mode === 'smart' ? new SmartDenoise() : new NoDenoise();
}
