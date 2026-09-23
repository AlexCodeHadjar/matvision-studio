import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type {
  CameraPreset,
  CameraState,
  ExportOptions,
  PreviewResolution,
  PrintLayout,
  PrintSource,
  ProjectState,
  SceneController,
  ShowcaseAnimation,
} from '../contracts';
import { getProduct } from '../products';
import { createMatGeometry } from '../geometry/mat';
import { MatRollDeformer } from '../geometry/roll';
import { createStitchedGeometry, STITCH_PITCH_M } from '../geometry/stitch';
import { createFabricMaterial, createInitialFabric } from '../materials/fabric';
import { createRubberMaterial } from '../materials/rubber';
import { createStitchedMaterial } from '../materials/stitched';
import { createPlacementSurfaceMaterial } from '../materials/placementSurface';
import { configureColorPipeline, markColorTexture } from '../color/ColorPipeline';
import { createStudioEnvironment } from './environment';
import { QUALITY_SETTINGS } from './quality';
import { estimateSceneTextureBytes } from './performance';
import { CameraRig } from '../camera/CameraRig';
import { applyPrintLayer } from '../print-layout/material';
import { decodeSource } from '../textures/import';
import { log } from '../app/log';
import { RealtimePipeline } from './RealtimePipeline';
import { decodeMaterials, type DecodedMaterials } from '../materials/assets';
import { createPhotoSnapshot } from '../photo/snapshot';
import { createMatVisionScene, type MatVisionScene } from '../scene-core/MatVisionScene';
import { ThreeSceneAdapter, type MatVisionRealtimeBackend } from './ThreeSceneAdapter';

type DecodedSource = Awaited<ReturnType<typeof decodeSource>>;

const SHOWCASE_DURATION: Record<ShowcaseAnimation, number> = {
  'corner-lift': 4200,
  'soft-wave': 4200,
  'table-drop': 4400,
  'mat-flip': 5600,
  'dual-roll': 5600,
  'edge-flyby': 6500,
  'moving-light': 5200,
  'layer-reveal': 4800,
};

interface ShowcasePlayback {
  id: ShowcaseAnimation;
  start: number;
  camera: CameraState;
  keyPosition: Vector3;
  keyIntensity: number;
  rotationY: number;
}

export class StudioScene implements SceneController, MatVisionRealtimeBackend {
  readonly id = 'three-realtime' as const;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(35, 1, 0.005, 30);
  readonly mat = new Group();
  readonly rig: CameraRig;
  private state: ProjectState;
  private readonly pipeline: RealtimePipeline;
  private readonly adapter: ThreeSceneAdapter;
  private materialAssets: DecodedMaterials | null = null;
  private materialGeneration = 0;
  private environment: ReturnType<typeof createStudioEnvironment>;
  private readonly fabric: ReturnType<typeof createFabricMaterial>;
  private readonly rubber: ReturnType<typeof createRubberMaterial>;
  private readonly stitches: ReturnType<typeof createStitchedMaterial>;
  private readonly artwork: ReturnType<typeof createInitialFabric>;
  private readonly printLayer: ReturnType<typeof applyPrintLayer>;
  private readonly placementSurface: ReturnType<typeof createPlacementSurfaceMaterial>;
  private readonly floor: Mesh;
  private readonly backgroundMaterial = new MeshBasicMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });
  private readonly background = new Mesh(new BoxGeometry(24, 24, 24), this.backgroundMaterial);
  private readonly key = new DirectionalLight();
  private readonly undersideLight = new DirectionalLight('#f0f2ed', 0);
  private stitchThreads: InstancedMesh | null = null;
  private edgeBinding: Mesh | null = null;
  private rollDeformer = new MatRollDeformer();
  private readonly references = new Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private surface: Mesh | null = null;
  private backingCap: Mesh | null = null;
  private clothBacking: Mesh | null = null;
  private source: DecodedSource | null = null;
  private sourceGeneration = 0;
  private pendingLoads = 0;
  private shaderFailed = false;
  private sourceDimensions: PreviewResolution = { widthPx: 1800, heightPx: 800 };
  private frame = 0;
  private frameCount = 0;
  private disposed = false;
  private contextLost = false;
  private exporting = false;
  private editPrint = false;
  private printDrag: { id: number; point: Vector3; layout: PrintLayout } | null = null;
  private lastTime = performance.now();
  private previousFrameTime = performance.now();
  private intervalFrames = 0;
  private fps = 0;
  private bounds = new Vector3();
  private showcase: ShowcasePlayback | null = null;

  constructor(
    private readonly host: HTMLElement,
    state: ProjectState,
    private readonly onError: (message: string) => void,
    private readonly onLayoutChange?: (layout: PrintLayout) => void,
  ) {
    this.state = state;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!context)
      throw new Error('WebGL2 недоступен. Обновите драйвер видеокарты и перезапустите приложение.');
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.debug.onShaderError = () => {
      this.shaderFailed = true;
      this.host.dataset.rendererState = 'error';
      this.onError(
        'Не удалось построить материал на видеокарте. Сохраните проект и перезапустите приложение.',
      );
      log('RENDERER', 'shader-compile-failed');
    };
    configureColorPipeline(this.renderer);
    this.pipeline = new RealtimePipeline(this.renderer, this.scene, this.camera);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.placementSurface = createPlacementSurfaceMaterial(
      200,
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.adapter = new ThreeSceneAdapter({
      scene: this.scene,
      renderer: this.renderer,
      background: this.backgroundMaterial,
      key: this.key,
      setFloor: (surface, color) => this.placementSurface.update(surface, color),
    });
    this.floor = new Mesh(new PlaneGeometry(200, 200), this.placementSurface.material);
    const product = getProduct(state.productId);
    this.fabric = createFabricMaterial(product, state);
    this.rubber = createRubberMaterial(product);
    this.stitches = createStitchedMaterial((product.widthMm + product.heightMm) / 500);
    this.artwork = createInitialFabric();
    this.artwork.material.dispose();
    this.artwork.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.fabric.setPrintTexture(this.artwork.texture);
    this.printLayer = applyPrintLayer(
      this.fabric.material,
      this.sourceDimensions,
      product.printableArea,
      state.layout,
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.00002;
    this.floor.receiveShadow = true;
    this.background.renderOrder = -1000;
    this.scene.add(this.floor, this.background, this.mat, this.references);
    this.key.castShadow = true;
    this.key.shadow.camera.left = -1.1;
    this.key.shadow.camera.right = 1.1;
    this.key.shadow.camera.top = 1.1;
    this.key.shadow.camera.bottom = -1.1;
    this.key.shadow.camera.near = 0.1;
    this.key.shadow.camera.far = 5;
    this.key.shadow.normalBias = 0.00006;
    this.key.shadow.bias = -0.000002;
    this.key.shadow.intensity = 0.85;
    this.scene.add(this.key);
    this.undersideLight.position.set(-0.7, -0.9, 0.6);
    this.scene.add(this.undersideLight);
    this.environment = createStudioEnvironment(
      this.renderer,
      state.environment,
      QUALITY_SETTINGS[state.quality].environmentWidth,
    );
    this.scene.environment = this.environment.texture;
    this.applyEnvironmentSettings();
    this.applyQuality();
    this.rig = new CameraRig(this.camera, canvas);
    this.rig.restore(state.camera);
    host.append(canvas);
    canvas.setAttribute('aria-label', 'Трёхмерный предпросмотр коврика');
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    canvas.addEventListener('pointerdown', this.onPointerDown, true);
    canvas.addEventListener('pointermove', this.onPointerMove, true);
    canvas.addEventListener('pointerup', this.onPointerUp, true);
    canvas.addEventListener('pointercancel', this.onPointerUp, true);
    canvas.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.rebuildMat();
    this.pipeline.configure(state.realism.mode === 'detailed', state.realism.contactShadow);
    this.resize();
    this.animate();
    log('RENDERER', 'initialized', {
      backend: 'WebGL2',
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
    });
  }
  get controls() {
    return this.rig.controls;
  }
  pauseForPhoto() {
    if (this.exporting || this.disposed || this.contextLost)
      throw new Error('Сцена сейчас недоступна для фото.');
    const start = performance.now(),
      controlsEnabled = this.controls.enabled;
    this.exporting = true;
    this.controls.enabled = false;
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      if (this.showcase) this.showcase.start += performance.now() - start;
      this.previousFrameTime = performance.now();
      this.exporting = false;
      this.controls.enabled = controlsEnabled;
    };
  }
  get hasFabricHeightMap(): boolean {
    return Boolean(this.fabric.material.bumpMap);
  }
  preparePhoto(
    textureSize: number,
    signal: AbortSignal,
    lighting: 'studio' | 'hdri' = 'hdri',
    displacementMm = 0,
  ) {
    const product = getProduct(this.state.productId);
    return createPhotoSnapshot({
      renderer: this.renderer,
      mat: this.mat,
      floor: this.floor,
      camera: this.camera,
      state: this.state,
      fabric: this.fabric.material,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      textureSize,
      signal,
      lighting,
      displacementMm,
    });
  }
  private applyQuality() {
    const quality = QUALITY_SETTINGS[this.state.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    if (this.key.shadow.mapSize.x !== quality.shadowSize) {
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
      this.key.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      this.key.shadow.needsUpdate = true;
    }
    this.fitShadowToProduct();
  }
  private fitShadowToProduct() {
    const product = getProduct(this.state.productId);
    // Enclose every turntable angle, retaining resolution for a millimetre-scale shadow.
    const extent = Math.hypot(product.widthMm, product.heightMm) / 2000 + 0.12;
    const camera = this.key.shadow.camera;
    camera.left = camera.bottom = -extent;
    camera.right = camera.top = extent;
    camera.updateProjectionMatrix();
    // Keep a small soft edge in world units across the quality presets.
    this.key.shadow.radius = Math.max(1, (0.002 * this.key.shadow.mapSize.x) / (2 * extent));
    this.key.shadow.needsUpdate = true;
  }
  private applyEnvironmentSettings() {
    this.syncScene(createMatVisionScene(this.state));
  }
  syncScene(scene: MatVisionScene) {
    this.adapter.syncScene(scene);
  }
  renderFrame() {
    this.pipeline.render();
  }
  setSoftboxLighting(enabled: boolean): boolean {
    if (this.disposed || this.contextLost) return false;
    const changed = this.adapter.setSoftboxes(enabled, createMatVisionScene(this.state));
    if (changed) {
      this.fabric.setEnhancedMicrorelief(enabled);
      this.renderer.shadowMap.needsUpdate = true;
    }
    return changed;
  }
  private replaceEnvironment() {
    const next = createStudioEnvironment(
      this.renderer,
      this.state.environment,
      QUALITY_SETTINGS[this.state.quality].environmentWidth,
    );
    const previous = this.environment;
    this.environment = next;
    this.scene.environment = next.texture;
    previous.dispose();
    this.applyEnvironmentSettings();
  }
  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.host.dataset.rendererState = 'lost';
    this.onError('Графический контекст потерян. Ожидаем восстановления; проект сохранён в памяти.');
  };
  private onContextRestored = () => {
    try {
      this.renderer.shadowMap.needsUpdate = true;
      this.replaceEnvironment();
      this.artwork.texture.needsUpdate = true;
      if (this.source) this.source.texture.needsUpdate = true;
      if (this.materialAssets)
        for (const maps of Object.values(this.materialAssets.textures))
          for (const texture of Object.values(maps)) texture.needsUpdate = true;
      this.contextLost = false;
      this.onError('');
      log('RENDERER', 'context-restored');
    } catch {
      this.onError('Не удалось восстановить графику. Сохраните проект и перезапустите приложение.');
    }
  };
  private resize = () => {
    if (this.exporting) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height);
    this.pipeline.resize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
  private clearReferences() {
    this.references.traverse((object) => {
      if (object instanceof LineSegments) {
        object.geometry.dispose();
        const m = object.material;
        if (m instanceof LineBasicMaterial) m.dispose();
      }
      if (object instanceof Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    this.references.clear();
  }
  private rebuildReferences() {
    this.clearReferences();
    const product = getProduct(this.state.productId);
    const width = Math.min(product.widthMm / 1000, 0.5),
      z = product.heightMm / 2000 + 0.06;
    const positions: number[] = [-width / 2, 0.001, z, width / 2, 0.001, z];
    for (let mm = 0; mm <= Math.round(width * 1000); mm += 10) {
      const x = -width / 2 + mm / 1000;
      positions.push(x, 0.001, z, x, 0.001, z + (mm % 50 === 0 ? 0.012 : 0.005));
      if (mm % 100 === 0) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#596a58';
        ctx.font = '28px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText(`${mm} mm`, 64, 40);
        const texture = new CanvasTexture(c);
        markColorTexture(texture);
        const label = new Sprite(
          new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
        );
        label.position.set(x, 0.01, z + 0.031);
        label.scale.set(0.05, 0.025, 1);
        this.references.add(label);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.references.add(new LineSegments(geometry, new LineBasicMaterial({ color: '#71806a' })));
    this.references.visible = this.state.referenceMode;
  }
  private rebuildMat() {
    if (this.showcase) this.stopShowcase();
    this.rollDeformer = new MatRollDeformer();
    for (const child of [...this.mat.children]) {
      if (child instanceof InstancedMesh) child.dispose();
      if (child instanceof Mesh) child.geometry.dispose();
      this.mat.remove(child);
    }
    const product = getProduct(this.state.productId);
    this.stitchThreads = null;
    this.edgeBinding = null;
    this.floor.position.y = this.state.edgePreset === 'stitched' ? -0.00028 : -0.00002;
    const { body, top } = createMatGeometry(product, this.state.thicknessMm);
    const underside = new Mesh(body, this.rubber.material);
    underside.castShadow = true;
    underside.receiveShadow = true;
    this.surface = new Mesh(top, this.fabric.material);
    this.surface.castShadow = true;
    this.surface.receiveShadow = true;
    this.mat.add(underside, this.surface);
    // Hidden mating faces avoid coplanar surfaces in the assembled product.
    this.backingCap = new Mesh(top.clone(), this.rubber.material);
    this.backingCap.visible = false;
    this.backingCap.receiveShadow = true;
    const clothGeometry = top.clone();
    const clothIndex = clothGeometry.getIndex()!;
    for (let i = 0; i < clothIndex.count; i += 3) {
      const a = clothIndex.getX(i);
      clothIndex.setX(i, clothIndex.getX(i + 2));
      clothIndex.setX(i + 2, a);
    }
    clothGeometry.translate(0, -0.00025, 0);
    clothGeometry.computeVertexNormals();
    this.clothBacking = new Mesh(clothGeometry, this.rubber.material);
    this.clothBacking.visible = false;
    this.mat.add(this.backingCap, this.clothBacking);
    this.bounds = body.boundingBox!.getSize(new Vector3());
    this.rollDeformer.add(body);
    this.rollDeformer.add(top);
    if (this.state.edgePreset === 'stitched') {
      const { geometry, threadGeometry, matrices, colors, stitchCount, perimeterM } =
        createStitchedGeometry(product, this.state.thicknessMm);
      this.stitches.update(perimeterM);
      const binding = new Mesh(geometry, this.stitches.material);
      binding.castShadow = true;
      this.mat.add(binding);
      this.edgeBinding = binding;
      this.rollDeformer.add(geometry);
      this.stitchThreads = new InstancedMesh(
        threadGeometry,
        this.stitches.threadMaterial,
        stitchCount,
      );
      this.stitchThreads.instanceMatrix.array.set(matrices);
      this.stitchThreads.instanceMatrix.needsUpdate = true;
      this.stitchThreads.instanceColor = new InstancedBufferAttribute(colors, 3);
      this.stitchThreads.name = 'Individual overlock loops and interlocking needle chain';
      // The padded binding casts the edge shadow. Submillimetre strands are below
      // shadow-map resolution and use geometry/filament normals for their own shading.
      this.stitchThreads.frustumCulled = false;
      this.mat.add(this.stitchThreads);
      this.rollDeformer.addThreads(this.stitchThreads);
    }
    this.applyRoll();
    this.host.dataset.productId = product.id;
    this.fitShadowToProduct();
    this.rebuildReferences();
  }
  private applyRoll() {
    this.renderer.shadowMap.needsUpdate = true;
    this.rollDeformer.apply(
      getProduct(this.state.productId).heightMm / 1000,
      this.state.thicknessMm / 1000,
      this.state.rollAmount,
      this.state.edgePreset === 'stitched',
    );
    this.printDrag = null;
  }
  playShowcase(animation: ShowcaseAnimation) {
    this.stopShowcase();
    this.showcase = {
      id: animation,
      start: performance.now(),
      camera: this.rig.getState(),
      keyPosition: this.key.position.clone(),
      keyIntensity: this.key.intensity,
      rotationY: this.mat.rotation.y,
    };
    this.rig.restore(this.showcase.camera);
    this.controls.enabled = animation !== 'edge-flyby';
    this.printDrag = null;
    this.mat.position.set(0, 0, 0);
    this.mat.rotation.set(0, 0, 0);
    this.rollDeformer.apply(
      getProduct(this.state.productId).heightMm / 1000,
      this.state.thicknessMm / 1000,
      0,
      this.state.edgePreset === 'stitched',
    );
    this.host.dataset.showcase = animation;
    log('ANIMATION', 'showcase-started', { animation });
  }
  stopShowcase() {
    const playback = this.showcase;
    this.showcase = null;
    this.mat.position.set(0, 0, 0);
    if (playback) this.mat.rotation.set(0, playback.rotationY, 0);
    if (this.backingCap) this.backingCap.visible = false;
    if (this.clothBacking) this.clothBacking.visible = false;
    if (this.surface) this.surface.position.set(0, 0, 0);
    if (this.edgeBinding) this.edgeBinding.position.set(0, 0, 0);
    if (this.stitchThreads) this.stitchThreads.position.set(0, 0, 0);
    this.applyRoll();
    if (playback) {
      this.key.position.copy(playback.keyPosition);
      this.key.intensity = playback.keyIntensity;
      this.rig.restore(playback.camera);
      log('ANIMATION', 'showcase-stopped', { animation: playback.id });
    }
    this.controls.enabled = true;
    delete this.host.dataset.showcase;
  }
  private updateShowcase(now: number) {
    const playback = this.showcase;
    if (!playback) return;
    const duration = SHOWCASE_DURATION[playback.id];
    const progress = Math.max(0, Math.min(1, (now - playback.start) / duration));
    const eased = progress * progress * (3 - 2 * progress);
    const product = getProduct(this.state.productId);
    const width = product.widthMm / 1000;
    const height = product.heightMm / 1000;
    const thickness = this.state.thicknessMm / 1000;
    if (
      playback.id === 'corner-lift' ||
      playback.id === 'soft-wave' ||
      playback.id === 'dual-roll' ||
      playback.id === 'table-drop'
    ) {
      this.rollDeformer.applyShowcase(
        width,
        height,
        thickness,
        playback.id,
        eased,
        this.state.edgePreset === 'stitched',
      );
    } else if (playback.id === 'mat-flip') {
      const turn =
        progress < 0.42
          ? Math.PI * (progress / 0.42) ** 2 * (3 - 2 * (progress / 0.42))
          : progress < 0.58
            ? Math.PI
            : Math.PI *
              (1 - ((progress - 0.58) / 0.42) ** 2 * (3 - 2 * ((progress - 0.58) / 0.42)));
      this.mat.rotation.x = turn;
      this.mat.position.y =
        (Math.abs(Math.sin(turn)) * height) / 2 +
        Math.max(0, -Math.cos(turn)) * thickness +
        Math.sin(Math.PI * progress) ** 2 * 0.055;
    } else if (playback.id === 'edge-flyby') {
      const savedPosition = new Vector3().fromArray(playback.camera.position);
      const savedTarget = new Vector3().fromArray(playback.camera.target);
      const a = new Vector3(-width * 0.42, Math.max(0.025, thickness * 5), height * 0.62);
      const b = new Vector3(width * 0.42, Math.max(0.022, thickness * 4), height * 0.62);
      const c = new Vector3(width * 0.57, Math.max(0.03, thickness * 6), height * 0.38);
      if (progress < 0.18) {
        this.camera.position.lerpVectors(savedPosition, a, progress / 0.18);
        this.controls.target.lerpVectors(
          savedTarget,
          new Vector3(-width * 0.3, thickness, height / 2),
          progress / 0.18,
        );
      } else if (progress < 0.67) {
        const segment = (progress - 0.18) / 0.49;
        this.camera.position.lerpVectors(a, b, segment);
        this.controls.target.set(-width * 0.3 + width * 0.8 * segment, thickness, height / 2);
      } else if (progress < 0.82) {
        const segment = (progress - 0.67) / 0.15;
        this.camera.position.lerpVectors(b, c, segment);
        this.controls.target.set(width / 2, thickness, height * (0.5 - segment * 0.24));
      } else {
        const segment = (progress - 0.82) / 0.18;
        this.camera.position.lerpVectors(c, savedPosition, segment);
        this.controls.target.lerpVectors(
          new Vector3(width / 2, thickness, height * 0.26),
          savedTarget,
          segment,
        );
      }
      this.camera.lookAt(this.controls.target);
    } else if (playback.id === 'moving-light') {
      const angle = 2 * Math.PI * eased;
      const origin = playback.keyPosition;
      this.key.position.set(
        origin.x * Math.cos(angle) - origin.z * Math.sin(angle),
        origin.y,
        origin.x * Math.sin(angle) + origin.z * Math.cos(angle),
      );
    } else if (playback.id === 'layer-reveal') {
      const separation = Math.sin(Math.PI * progress) ** 2 * Math.min(0.065, height * 0.15);
      if (this.surface) this.surface.position.y = separation;
      if (this.backingCap) this.backingCap.visible = separation > 0.0003;
      if (this.clothBacking) {
        this.clothBacking.visible = separation > 0.0003;
        this.clothBacking.position.y = separation;
      }
      if (this.edgeBinding) this.edgeBinding.position.y = separation;
      if (this.stitchThreads) this.stitchThreads.position.y = separation;
    }
    if (progress >= 1) this.stopShowcase();
  }
  update(state: ProjectState) {
    this.renderer.shadowMap.needsUpdate = true;
    const before = this.state;
    const newProduct = state.productId !== before.productId;
    const rebuild =
      newProduct ||
      state.thicknessMm !== before.thicknessMm ||
      state.edgePreset !== before.edgePreset;
    const qualityChanged = state.quality !== before.quality;
    if (
      this.showcase &&
      (rebuild ||
        qualityChanged ||
        state.rollAmount !== before.rollAmount ||
        state.environment !== before.environment)
    )
      this.stopShowcase();
    this.state = state;
    const product = getProduct(state.productId);
    if (rebuild) this.rebuildMat();
    else if (state.rollAmount !== before.rollAmount) this.applyRoll();
    this.fabric.update(product, state);
    this.rubber.update(product, state);
    if (
      state.realism.mode !== before.realism.mode ||
      state.realism.contactShadow !== before.realism.contactShadow
    )
      this.pipeline.configure(state.realism.mode === 'detailed', state.realism.contactShadow);
    this.printLayer.update(this.sourceDimensions, product.printableArea, state.layout);
    this.references.visible = state.referenceMode && !this.rig.underside;
    if (newProduct) this.setCameraPreset('perspective');
    if (state.environment !== before.environment || qualityChanged) this.replaceEnvironment();
    else if (newProduct || state.placementSurface !== before.placementSurface)
      this.syncScene(createMatVisionScene(state));
    if (qualityChanged) {
      log('PERFORMANCE', 'quality-changed', { preset: state.quality });
      this.applyQuality();
      this.resize();
      if (state.source && this.pendingLoads === 0)
        void this.setPrintSource(state.source).catch(() =>
          this.onError('Не удалось изменить разрешение GPU-preview.'),
        );
    }
  }
  cancelPendingPrint(): void {
    this.sourceGeneration++;
    this.materialGeneration++;
  }
  /** Prepare all maps before committing. A failed import never removes current materials. */
  async setMaterialAssets(materials: ProjectState['materials']): Promise<boolean> {
    const generation = ++this.materialGeneration;
    const next = await decodeMaterials(
      materials,
      this.renderer.capabilities.maxTextureSize,
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    if (this.disposed || generation !== this.materialGeneration) {
      next.dispose();
      return false;
    }
    this.commitMaterialAssets(next);
    return true;
  }
  private commitMaterialAssets(next: DecodedMaterials) {
    const previous = this.materialAssets;
    this.materialAssets = next;
    this.fabric.setMaps(next.textures.fabric);
    this.rubber.setMaps(next.textures.rubber);
    previous?.dispose();
  }
  /** Opening a project is atomic across artwork and all material maps. */
  async loadProject(state: ProjectState): Promise<PreviewResolution | null | undefined> {
    const generation = ++this.sourceGeneration;
    const materialGeneration = ++this.materialGeneration;
    let next: DecodedSource | null = null;
    let assets: DecodedMaterials | null = null;
    try {
      next = state.source
        ? await decodeSource(state.source, this.renderer.capabilities.maxTextureSize, state.quality)
        : null;
      assets = await decodeMaterials(
        state.materials,
        this.renderer.capabilities.maxTextureSize,
        Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
      );
    } catch (error) {
      next?.dispose();
      assets?.dispose();
      throw error;
    }
    if (
      this.disposed ||
      generation !== this.sourceGeneration ||
      materialGeneration !== this.materialGeneration
    ) {
      next?.dispose();
      assets.dispose();
      return undefined;
    }
    if (next) next.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const previous = this.source;
    this.source = next;
    this.sourceDimensions = state.source ?? { widthPx: 1800, heightPx: 800 };
    this.fabric.setPrintTexture(next?.texture ?? this.artwork.texture);
    this.commitMaterialAssets(assets);
    // Already decoded at the requested quality; avoid a redundant artwork decode in update.
    this.pendingLoads++;
    try {
      this.update(state);
    } finally {
      this.pendingLoads--;
    }
    this.restoreCamera(state.camera);
    previous?.dispose();
    return next ? { widthPx: next.widthPx, heightPx: next.heightPx } : null;
  }
  async setPrintSource(source: PrintSource | null): Promise<PreviewResolution | null> {
    const generation = ++this.sourceGeneration;
    const quality = this.state.quality;
    this.pendingLoads++;
    let next: DecodedSource | null;
    try {
      next = source
        ? await decodeSource(source, this.renderer.capabilities.maxTextureSize, quality)
        : null;
    } finally {
      this.pendingLoads--;
    }
    if (this.disposed || generation !== this.sourceGeneration) {
      next?.dispose();
      return null;
    }
    if (source && quality !== this.state.quality) {
      next?.dispose();
      return this.setPrintSource(source);
    }
    if (next) next.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const previous = this.source;
    this.source = next;
    this.sourceDimensions = source ?? { widthPx: 1800, heightPx: 800 };
    this.fabric.setPrintTexture(next?.texture ?? this.artwork.texture);
    this.printLayer.update(
      this.sourceDimensions,
      getProduct(this.state.productId).printableArea,
      this.state.layout,
    );
    previous?.dispose();
    log('TEXTURE', 'preview-ready', {
      width: next?.widthPx ?? 1800,
      height: next?.heightPx ?? 800,
    });
    return next ? { widthPx: next.widthPx, heightPx: next.heightPx } : null;
  }
  setEditPrint(enabled: boolean) {
    this.editPrint = enabled;
    if (!enabled) this.printDrag = null;
  }
  private pointOnMat(event: PointerEvent): Vector3 | null {
    if (!this.surface) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      this.camera,
    );
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    if (!hit?.uv) return null;
    // Recover the undeformed print coordinates: dragging works on a curled surface too.
    const product = getProduct(this.state.productId),
      area = product.printableArea;
    return new Vector3(
      (area.xMm + hit.uv.x * area.widthMm - product.widthMm / 2) / 1000,
      this.state.thicknessMm / 1000,
      (area.yMm + (1 - hit.uv.y) * area.heightMm - product.heightMm / 2) / 1000,
    );
  }
  private onPointerDown = (event: PointerEvent) => {
    if (!this.editPrint || event.button !== 0) return;
    const point = this.pointOnMat(event);
    if (!point) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.printDrag = { id: event.pointerId, point, layout: { ...this.state.layout } };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };
  private onPointerMove = (event: PointerEvent) => {
    const drag = this.printDrag;
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = this.pointOnMat(event);
    if (!point) return;
    const area = getProduct(this.state.productId).printableArea;
    this.onLayoutChange?.({
      ...drag.layout,
      offsetX: Math.max(
        -5,
        Math.min(5, drag.layout.offsetX + (point.x - drag.point.x) / (area.widthMm / 1000)),
      ),
      offsetY: Math.max(
        -5,
        Math.min(5, drag.layout.offsetY - (point.z - drag.point.z) / (area.heightMm / 1000)),
      ),
    });
  };
  private onPointerUp = (event: PointerEvent) => {
    if (!this.printDrag || this.printDrag.id !== event.pointerId) return;
    event.stopImmediatePropagation();
    this.printDrag = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId))
      this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.onLayoutChange?.({
      ...this.state.layout,
      scale: Math.max(
        0.05,
        Math.min(20, this.state.layout.scale * Math.exp(-event.deltaY * 0.001)),
      ),
    });
  };
  setCameraPreset(preset: CameraPreset) {
    if (this.showcase) this.stopShowcase();
    this.rig.setPreset(preset, getProduct(this.state.productId), this.state.thicknessMm);
    this.floor.visible = preset !== 'underside';
    this.references.visible = this.state.referenceMode && preset !== 'underside';
  }
  restoreCamera(state: CameraState) {
    this.rig.restore(state);
    this.floor.visible = state.preset !== 'underside';
    this.references.visible = this.state.referenceMode && state.preset !== 'underside';
  }
  getCameraState(): CameraState {
    return this.showcase?.camera ?? this.rig.getState();
  }
  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now(),
      dt = Math.min(0.1, (now - this.previousFrameTime) / 1000);
    this.previousFrameTime = now;
    if (this.contextLost || this.exporting || this.shaderFailed) return;
    if (this.state.turntable && !this.editPrint && !this.showcase) this.mat.rotation.y += dt * 0.12;
    if (this.showcase?.id !== 'edge-flyby') this.rig.update(now, this.state.thicknessMm);
    this.updateShowcase(now);
    if (this.showcase || this.state.turntable) this.renderer.shadowMap.needsUpdate = true;
    // A user can interrupt a transition before it crosses the mat. Use the actual
    // camera hemisphere so the floor never obscures a cancelled underside view.
    this.floor.visible = this.camera.position.y >= this.state.thicknessMm / 2000;
    this.references.visible = this.state.referenceMode && this.floor.visible;
    this.undersideLight.intensity = this.floor.visible ? 0 : 2.4;
    if (this.stitchThreads) {
      const distance = Math.max(0.01, this.camera.position.distanceTo(this.controls.target));
      const pixelsPerStitch =
        (this.renderer.domElement.height * STITCH_PITCH_M) /
        (2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance);
      this.stitchThreads.visible = pixelsPerStitch > (this.stitchThreads.visible ? 0.7 : 1.0);
    }
    this.background.position.copy(this.camera.position);
    this.renderFrame();
    this.frameCount++;
    this.intervalFrames++;
    this.host.dataset.rendererState = 'ready';
    if (now - this.lastTime >= 500) {
      this.fps = (1000 * this.intervalFrames) / (now - this.lastTime);
      this.lastTime = now;
      this.intervalFrames = 0;
    }
  };
  async exportPng(options: ExportOptions): Promise<Blob> {
    if (this.contextLost || this.disposed || this.shaderFailed)
      throw new Error('Графика недоступна для экспорта.');
    if (this.exporting) throw new Error('Экспорт уже выполняется.');
    if (this.state.realism.mode === 'detailed' && options.widthPx * options.heightPx > 10_000_000)
      throw new Error(
        'Детальный PNG ограничен 10 мегапикселями. Уменьшите размер или выберите быстрый режим.',
      );
    const limit = Math.min(8192, this.renderer.capabilities.maxTextureSize);
    if (
      ![options.widthPx, options.heightPx].every((n) => Number.isInteger(n) && n > 0 && n <= limit)
    )
      throw new Error(`Экспорт поддерживает размеры от 1 до ${limit} px.`);
    this.exporting = true;
    const size = this.renderer.getSize(new Vector2()),
      ratio = this.renderer.getPixelRatio(),
      aspect = this.camera.aspect;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(options.widthPx, options.heightPx, false);
      this.camera.aspect = options.widthPx / options.heightPx;
      this.camera.updateProjectionMatrix();
      this.pipeline.resize();
      this.renderer.shadowMap.needsUpdate = true;
      this.renderFrame();
      const blob = await new Promise<Blob>((resolve, reject) =>
        this.renderer.domElement.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Не удалось закодировать PNG.'))),
          'image/png',
        ),
      );
      log('EXPORT', 'png-rendered', { width: options.widthPx, height: options.heightPx });
      return blob;
    } finally {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(size.x, size.y);
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      this.exporting = false;
      this.resize();
    }
  }
  getDiagnostics() {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const approximateTextureBytes = estimateSceneTextureBytes({
      fallback: { widthPx: 1800, heightPx: 800 },
      print: this.source,
      referenceLabelCount: this.references.children.filter((o) => o instanceof Sprite).length,
      materialBytes:
        this.fabric.ownedTextureBytes +
        this.rubber.ownedTextureBytes +
        this.stitches.ownedTextureBytes +
        this.placementSurface.ownedTextureBytes +
        (this.materialAssets?.approximateBytes ?? 0),
      environmentWidth: this.environment.width,
      environmentHeight: this.environment.height,
      shadowSize: this.key.shadow.mapSize.x,
    });
    return {
      ready: this.frameCount > 0,
      renderer: 'WebGL2',
      productId: this.state.productId,
      widthM: this.bounds.x,
      heightM: this.bounds.z,
      thicknessM: this.bounds.y,
      frameCount: this.frameCount,
      cameraPosition: this.camera.position.toArray(),
      cameraTarget: this.rig.getState().target,
      cameraPreset: this.rig.getState().preset,
      fovDeg: this.camera.fov,
      exposure: this.renderer.toneMappingExposure,
      outputColorSpace: this.renderer.outputColorSpace,
      toneMapping: 'ACESFilmic',
      environmentId: this.state.environment,
      placementSurface: this.state.placementSurface,
      rollAmount: this.state.rollAmount,
      fps: this.fps,
      frameTimeMs: this.fps > 0 ? 1000 / this.fps : 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      programs: this.renderer.info.programs?.length ?? 0,
      approximateTextureBytes,
      approximateEffectBytes: this.pipeline.approximateBytes,
      realismMode: this.state.realism.mode,
      rendererWidthPx: size.x,
      rendererHeightPx: size.y,
      contextLost: this.contextLost,
      previewWidthPx: this.source?.widthPx ?? 1800,
      previewHeightPx: this.source?.heightPx ?? 800,
      sourceWidthPx: this.sourceDimensions.widthPx,
      sourceHeightPx: this.sourceDimensions.heightPx,
      matRotationY: this.mat.rotation.y,
      showcase: this.showcase?.id ?? null,
    };
  }
  dispose() {
    this.disposed = true;
    this.stopShowcase();
    this.sourceGeneration++;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.rig.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    canvas.removeEventListener('pointermove', this.onPointerMove, true);
    canvas.removeEventListener('pointerup', this.onPointerUp, true);
    canvas.removeEventListener('pointercancel', this.onPointerUp, true);
    canvas.removeEventListener('wheel', this.onWheel, true);
    this.clearReferences();
    this.scene.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.printLayer.dispose();
    this.source?.dispose();
    this.materialAssets?.dispose();
    this.pipeline.dispose();
    this.artwork.texture.dispose();
    this.fabric.dispose();
    this.rubber.dispose();
    this.stitches.dispose();
    this.rollDeformer = new MatRollDeformer();
    this.placementSurface.dispose();
    this.adapter.dispose();
    this.backgroundMaterial.dispose();
    this.environment.dispose();
    this.key.shadow.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
