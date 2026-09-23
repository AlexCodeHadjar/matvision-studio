import {
  Fog,
  RectAreaLight,
  Vector3,
  type DirectionalLight,
  type MeshBasicMaterial,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { MatVisionScene } from '../scene-core/MatVisionScene';
import { toMetres } from '../scene-core/MatVisionScene';
import type { PlacementSurface } from '../contracts';

/** One completed vertical slice: renderer-independent environment, key and floor. */
export class ThreeSceneAdapter {
  private softboxes: RectAreaLight[] = [];
  private softboxesEnabled = false;
  constructor(
    private readonly runtime: {
      scene: Scene;
      renderer: WebGLRenderer;
      background: MeshBasicMaterial;
      key: DirectionalLight;
      setFloor: (surface: PlacementSurface, color: string) => void;
    },
  ) {}

  syncScene(scene: MatVisionScene): void {
    const key = scene.lights.find((light) => light.role === 'key-shadow');
    if (!key) throw new Error('Scene Core has no shadow key light.');
    this.runtime.background.color.set(scene.environment.backgroundColor);
    this.runtime.setFloor(scene.floor.surface, scene.floor.color);
    this.runtime.scene.fog = new Fog(scene.environment.backgroundColor, 3, 10);
    this.runtime.key.color.set(key.color);
    // The shadow caster remains even with area lights: WebGL RectAreaLight has no shadow map.
    this.runtime.key.intensity = key.intensity * (this.softboxesEnabled ? 0.55 : 1);
    this.runtime.key.position.fromArray(toMetres(key.positionMm));
    this.runtime.scene.environmentIntensity =
      scene.environment.intensity * (this.softboxesEnabled ? 0.75 : 1);
    this.runtime.renderer.toneMappingExposure = scene.environment.exposure;
    if (this.softboxesEnabled) this.updateSoftboxes(scene);
  }

  get softboxesSupported(): boolean {
    return (
      this.runtime.renderer.capabilities.isWebGL2 &&
      this.runtime.renderer.capabilities.maxTextures >= 8
    );
  }

  setSoftboxes(enabled: boolean, scene: MatVisionScene): boolean {
    if (enabled && !this.softboxesSupported) return false;
    this.softboxesEnabled = enabled;
    if (enabled) {
      if (!this.softboxes.length) {
        RectAreaLightUniformsLib.init();
        for (let i = 0; i < SOFTBOX_PROFILE.length; i++) {
          const light = new RectAreaLight();
          light.name = SOFTBOX_PROFILE[i]!.role;
          this.softboxes.push(light);
          this.runtime.scene.add(light);
        }
      }
      this.updateSoftboxes(scene);
    } else {
      for (const light of this.softboxes) this.runtime.scene.remove(light);
      this.softboxes.length = 0;
    }
    this.syncScene(scene);
    return true;
  }

  private updateSoftboxes(scene: MatVisionScene): void {
    const width = scene.product.widthMm / 1000;
    const height = scene.product.heightMm / 1000;
    const warm = scene.environment.preset === 'warm-room';
    const cool = scene.environment.preset === 'desk-setup';
    const target = new Vector3(0, 0, 0);
    SOFTBOX_PROFILE.forEach((profile, index) => {
      const light = this.softboxes[index];
      if (!light) return;
      light.color.set(
        profile.color === 'key' ? (warm ? '#ffe9d4' : cool ? '#eef5ff' : '#ffffff') : profile.color,
      );
      light.intensity = profile.intensity;
      light.width = profile.width * Math.max(1, width / 0.9);
      light.height = profile.height * Math.max(1, height / 0.4);
      light.position.set(
        profile.position[0] * width,
        profile.position[1],
        profile.position[2] * height,
      );
      light.lookAt(target);
      light.visible = true;
    });
  }

  dispose(): void {
    for (const light of this.softboxes) this.runtime.scene.remove(light);
    this.softboxes.length = 0;
  }
}

/** Coordinates scale with the product. Intensities are tuned for Three.js WebGL only. */
const SOFTBOX_PROFILE = [
  {
    role: 'Key Softbox',
    color: 'key',
    intensity: 5,
    width: 0.75,
    height: 0.5,
    position: [-1.2, 0.9, 0.8],
  },
  {
    role: 'Fill Softbox',
    color: '#dbe8ff',
    intensity: 1.5,
    width: 0.6,
    height: 0.4,
    position: [1.1, 0.7, 0.6],
  },
  {
    role: 'Top Softbox',
    color: '#ffffff',
    intensity: 1.2,
    width: 0.55,
    height: 0.45,
    position: [0, 1.1, 0],
  },
  {
    role: 'Strip Light',
    color: '#ffffff',
    intensity: 1,
    width: 0.12,
    height: 0.65,
    position: [-1.4, 0.45, -0.7],
  },
  {
    role: 'Rim Light',
    color: '#e8f0ff',
    intensity: 0.8,
    width: 0.45,
    height: 0.2,
    position: [1.1, 0.35, -0.9],
  },
] as const;

/** Studio owns one existing loop. Photo is a separate long-running backend. */
export interface MatVisionRealtimeBackend {
  readonly id: 'three-realtime';
  syncScene(scene: MatVisionScene): void;
  renderFrame(): void;
  dispose(): void;
}
