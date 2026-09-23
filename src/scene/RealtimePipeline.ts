import {
  ACESFilmicToneMapping,
  HalfFloatType,
  NoToneMapping,
  Vector2,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/** One pipeline for the viewport and PNG. Effects are allocated only on demand. */
export class RealtimePipeline {
  private composer: EffectComposer | null = null;
  private ao: N8AOPostPass | null = null;
  private detailed = false;
  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private camera: PerspectiveCamera,
  ) {}

  configure(detailed: boolean, intensity: number) {
    this.detailed = detailed;
    if (!detailed) {
      this.disposeEffects();
      this.renderer.autoClear = true;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      return;
    }
    if (!this.composer) {
      this.renderer.toneMapping = NoToneMapping;
      this.composer = new EffectComposer(this.renderer, {
        frameBufferType: HalfFloatType,
        multisampling: Math.min(4, this.renderer.capabilities.maxSamples),
      });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.ao = new N8AOPostPass(this.scene, this.camera);
      this.ao.setQualityMode('Ultra');
      this.ao.configuration.halfRes = false;
      this.ao.configuration.aoRadius = 0.008;
      this.ao.configuration.distanceFalloff = 0.8;
      this.ao.configuration.accumulate = false;
      this.ao.configuration.gammaCorrection = false;
      this.composer.addPass(this.ao);
      this.composer.addPass(
        new EffectPass(this.camera, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })),
      );
      this.composer.addPass(
        new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.ULTRA })),
      );
      this.resize();
    }
    this.ao!.configuration.intensity = intensity;
    this.ao!.enabled = intensity > 0;
  }

  resize() {
    const size = this.renderer.getSize(new Vector2());
    this.composer?.setSize(size.x, size.y, false);
  }

  render() {
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = this.detailed ? NoToneMapping : ACESFilmicToneMapping;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  get approximateBytes() {
    // Conservative working-buffer estimate, separate from source texture storage.
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    return this.composer ? size.x * size.y * 80 : 0;
  }
  private disposeEffects() {
    // N8AO's inherited Pass.dispose handles targets/textures but not its triangle wrappers.
    if (this.ao) {
      const internals = this.ao as unknown as Record<string, { dispose?: () => void } | undefined>;
      for (const key of [
        'copyQuad',
        'accumulationQuad',
        'effectShaderQuad',
        'poissonBlurQuad',
        'effectCompositerQuad',
        'depthDownsampleQuad',
        'depthCopyPass',
      ])
        internals[key]?.dispose?.();
    }
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
  }
  dispose() {
    this.disposeEffects();
  }
}
