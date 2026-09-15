import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  PCFShadowMap,
  Vector3,
  WebGLRenderer,
  Vector2,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraPreset, ProjectState } from '../contracts';
import { getProduct } from '../products';
import { createMatGeometry } from '../geometry/mat';
import { createInitialFabric } from '../materials/fabric';
import { configureColorPipeline } from '../color/ColorPipeline';
import { createStudioEnvironment } from './environment';
import { log } from '../app/log';

export class StudioScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(35, 1, 0.005, 30);
  readonly controls: OrbitControls;
  readonly mat = new Group();
  private environment;
  private readonly fabric = createInitialFabric();
  private readonly rubber = new MeshStandardMaterial({
    color: '#171b1b',
    roughness: 0.96,
    metalness: 0,
  });
  private readonly floorMaterial = new MeshStandardMaterial({ color: '#b9b7af', roughness: 0.97 });
  private readonly floor = new Mesh(new PlaneGeometry(200, 200), this.floorMaterial);
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private frameCount = 0;
  private disposed = false;
  private contextLost = false;
  private lastTime = performance.now();
  private intervalFrames = 0;
  private fps = 0;
  private state: ProjectState;
  private bounds = new Vector3();
  private transition: { from: Vector3; to: Vector3; start: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    state: ProjectState,
    private readonly onError: (message: string) => void,
  ) {
    this.state = state;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!context)
      throw new Error('WebGL2 недоступен. Обновите драйвер видеокарты и перезапустите приложение.');
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    configureColorPipeline(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.background = new Color('#c3c2bc');
    this.environment = createStudioEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.7;
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.00002;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor, this.mat);
    const key = new DirectionalLight('#fffaf2', 2.3);
    key.position.set(-0.6, 1.8, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1.1;
    key.shadow.camera.right = 1.1;
    key.shadow.camera.top = 1.1;
    key.shadow.camera.bottom = -1.1;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 5;
    key.shadow.normalBias = 0.0003;
    key.shadow.bias = -0.00001;
    key.shadow.radius = 3;
    this.scene.add(key);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 3;
    this.controls.minPolarAngle = 0.015;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.015;
    this.controls.maxTargetRadius = 0.45;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', this.cancelTransition);
    this.camera.position.fromArray(state.camera.position);
    this.controls.target.fromArray(state.camera.target);
    host.append(canvas);
    canvas.setAttribute('aria-label', 'Трёхмерный предпросмотр коврика');
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.rebuildMat();
    this.resize();
    this.animate();
    log('RENDERER', 'initialized', {
      backend: 'WebGL2',
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
    });
  }
  private cancelTransition = () => {
    this.transition = null;
  };
  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.host.dataset.rendererState = 'lost';
    this.onError('Графический контекст потерян. Ожидаем восстановления; проект сохранён в памяти.');
  };
  private onContextRestored = () => {
    // Render-target pixels do not survive context loss. Recompute the PMREM
    // instead of asking Three to reallocate an empty environment target.
    const environment = createStudioEnvironment(this.renderer);
    this.scene.environment = environment.texture;
    this.environment.dispose();
    this.environment = environment;
    this.fabric.texture.needsUpdate = true;
    this.contextLost = false;
    this.onError('');
    log('RENDERER', 'context-restored');
  };
  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
  private rebuildMat() {
    for (const child of [...this.mat.children]) {
      if (child instanceof Mesh) child.geometry.dispose();
      this.mat.remove(child);
    }
    const product = getProduct(this.state.productId);
    const { body, top } = createMatGeometry(product, this.state.thicknessMm);
    const underside = new Mesh(body, this.rubber);
    underside.castShadow = true;
    underside.receiveShadow = true;
    const surface = new Mesh(top, this.fabric.material);
    surface.castShadow = true;
    surface.receiveShadow = true;
    this.mat.add(underside, surface);
    this.bounds = new Box3().setFromObject(underside).getSize(new Vector3());
    this.host.dataset.productId = product.id;
  }
  update(state: ProjectState) {
    const rebuild =
      state.productId !== this.state.productId || state.thicknessMm !== this.state.thicknessMm;
    this.state = state;
    if (rebuild) {
      this.rebuildMat();
      this.setCameraPreset('perspective');
    }
    this.fabric.material.roughness = state.roughness;
  }
  setCameraPreset(preset: CameraPreset) {
    const product = getProduct(this.state.productId);
    const s = Math.max(product.widthMm, product.heightMm) / 1000;
    let to: Vector3;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.015;
    this.floor.visible = true;
    switch (preset) {
      case 'top':
        to = new Vector3(0, s * 1.8, 0.001);
        break;
      case 'low-angle':
        to = new Vector3(s * 0.65, s * 0.16, s * 0.8);
        break;
      case 'close-up':
        to = new Vector3(s * 0.12, 0.08, s * 0.2);
        break;
      case 'underside':
        to = new Vector3(s * 0.5, -s, s * 0.6);
        this.floor.visible = false;
        this.controls.maxPolarAngle = Math.PI - 0.02;
        break;
      default:
        to = new Vector3().fromArray(product.defaultCameraFraming.position);
    }
    this.controls.target.set(0, this.state.thicknessMm / 2000, 0);
    this.transition = { from: this.camera.position.clone(), to, start: performance.now() };
  }
  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    if (this.contextLost) return;
    const now = performance.now();
    if (this.transition) {
      const t = Math.min(1, (now - this.transition.start) / 450);
      this.camera.position.lerpVectors(
        this.transition.from,
        this.transition.to,
        t * t * (3 - 2 * t),
      );
      if (t === 1) this.transition = null;
    }
    this.controls.update();
    this.controls.target.y = this.state.thicknessMm / 2000;
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    this.intervalFrames++;
    this.host.dataset.rendererState = 'ready';
    if (now - this.lastTime >= 500) {
      this.fps = (1000 * this.intervalFrames) / (now - this.lastTime);
      this.lastTime = now;
      this.intervalFrames = 0;
    }
  };
  getCameraState() {
    return {
      ...this.state.camera,
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fovDeg: this.camera.fov,
    };
  }
  getDiagnostics() {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    return {
      ready: this.frameCount > 0,
      renderer: 'WebGL2',
      productId: this.state.productId,
      widthM: this.bounds.x,
      heightM: this.bounds.z,
      thicknessM: this.bounds.y,
      frameCount: this.frameCount,
      cameraPosition: this.camera.position.toArray(),
      outputColorSpace: this.renderer.outputColorSpace,
      toneMapping: 'ACESFilmic',
      environmentId: this.state.environment,
      fps: this.fps,
      frameTimeMs: this.fps > 0 ? 1000 / this.fps : 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      approximateTextureBytes: (1800 * 800 * 4 * 4) / 3,
      rendererWidthPx: size.x,
      rendererHeightPx: size.y,
      contextLost: this.contextLost,
    };
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('start', this.cancelTransition);
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.scene.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.fabric.texture.dispose();
    this.fabric.material.dispose();
    this.rubber.dispose();
    this.floorMaterial.dispose();
    this.environment.dispose();
    this.scene.traverse((object) => {
      if (object instanceof DirectionalLight) object.shadow.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
