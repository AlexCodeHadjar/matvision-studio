import { WebGLRenderer } from 'three';
import { PhysicalCamera, WebGLPathTracer } from 'three-gpu-pathtracer';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { configureColorPipeline } from '../color/ColorPipeline';
import { checkpoint, type PhotoSnapshot } from './snapshot';
import { createDenoiser } from './denoise';
import { DEFAULT_PHOTO_SETTINGS, validatePhotoSettings, type PhotoSettings } from './settings';

/** A separate renderer keeps progressive photo buffers independent from the live preview. */
export class ThreePathTracerBackend {
  readonly renderer: WebGLRenderer;
  private readonly tracer: WebGLPathTracer;
  private readonly worker: GenerateMeshBVHWorker;
  private snapshot: PhotoSnapshot | null = null;
  private disposed = false;
  private failed = false;
  private readonly denoiser;
  readonly settings: PhotoSettings;
  constructor(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    exposure: number,
    settings: PhotoSettings = DEFAULT_PHOTO_SETTINGS,
  ) {
    this.settings = validatePhotoSettings(settings);
    this.denoiser = createDenoiser(settings.denoise);
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    const gl = this.renderer.getContext();
    const adapterInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const adapter = adapterInfo ? String(gl.getParameter(adapterInfo.UNMASKED_RENDERER_WEBGL)) : '';
    // This tested Intel UHD / D3D11 combination silently corrupts material shading.
    // Reject it instead of exporting a blank or incorrectly coloured photo.
    if (/Intel.*UHD/i.test(adapter) && /D3D11|Direct3D11/i.test(adapter)) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw new Error(
        'Фоторежим некорректно работает на Intel UHD. Выберите мощную видеокарту для MatVision Studio в настройках графики Windows и перезапустите программу. Обычный просмотр и экспорт PNG доступны.',
      );
    }
    configureColorPipeline(this.renderer);
    this.renderer.toneMappingExposure = exposure;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      this.failed = true;
      console.error(
        'Photo shader compile failed',
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertex),
        gl.getShaderInfoLog(fragment),
      );
    };
    this.tracer = new WebGLPathTracer(this.renderer);
    this.worker = new GenerateMeshBVHWorker();
    this.tracer.setBVHWorker(this.worker);
    // Ten bounces are the previously verified default; a higher value needs measured benefit.
    this.tracer.bounces = 10;
    this.tracer.multipleImportanceSampling = true;
    this.tracer.filterGlossyFactor = 0;
    this.tracer.tiles.set(3, 3);
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 1;
    this.tracer.fadeDuration = 0;
    this.tracer.dynamicLowRes = false;
    this.tracer.rasterizeScene = false;
  }
  async prepare(
    snapshot: PhotoSnapshot,
    signal: AbortSignal,
    onProgress: (fraction: number) => void,
  ) {
    this.snapshot = snapshot;
    checkpoint(signal);
    const camera = new PhysicalCamera();
    camera.copy(snapshot.camera);
    camera.aspect = this.renderer.domElement.width / this.renderer.domElement.height;
    if (this.settings.focalLengthMm !== null) camera.setFocalLength(this.settings.focalLengthMm);
    camera.focusDistance = this.settings.focusDistanceMm / 1000;
    camera.fStop = this.settings.fStop ?? Infinity;
    camera.updateProjectionMatrix();
    snapshot.camera = camera;
    this.tracer.textureSize.setScalar(snapshot.textureSize);
    let abort = () => {};
    try {
      await Promise.race([
        this.tracer.setSceneAsync(snapshot.scene, snapshot.camera, { onProgress }),
        new Promise<never>((_, reject) => {
          abort = () => reject(new DOMException('Фоторендер отменён.', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
    checkpoint(signal);
  }
  get samples() {
    return this.tracer.samples;
  }
  get stats() {
    return this.snapshot?.stats;
  }
  step() {
    if (this.disposed) return;
    if (this.failed || this.renderer.getContext().isContextLost())
      throw new Error('Видеокарта не завершила фоторендер. Уменьшите размер кадра и повторите.');
    this.tracer.renderSample();
  }
  finish(signal?: AbortSignal): void {
    if (this.tracer.samples < 1) return;
    this.denoiser.apply(this.tracer.target, this.renderer, signal);
  }
  async png(): Promise<Blob> {
    if (this.tracer.samples < 1) throw new Error('Дождитесь первого полного прохода.');
    // The photo canvas preserves its completed pixels, with the same ACES output as the preview.
    return new Promise((resolve, reject) =>
      this.renderer.domElement.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сохранить фото.'))),
        'image/png',
      ),
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    (this.worker as unknown as { dispose(): void }).dispose();
    this.tracer.dispose();
    this.denoiser.dispose();
    this.snapshot?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** Compatibility for existing callers while the backend contract is adopted. */
export { ThreePathTracerBackend as PhotoRenderer };
