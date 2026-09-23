import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraPreset, CameraState, ProductDefinition } from '../contracts';
import {
  CAMERA_CLEARANCE,
  createOrbitTransition,
  presetOrbit,
  sampleOrbitTransition,
  type OrbitTransition,
} from './framing';

export class CameraRig {
  readonly controls: OrbitControls;
  private preset: CameraPreset = 'perspective';
  private transition: OrbitTransition | null = null;
  constructor(
    readonly camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 3;
    this.controls.maxTargetRadius = 0.45;
    this.controls.screenSpacePanning = false;
    this.setLimits();
    this.controls.addEventListener('start', this.cancelTransition);
  }
  private cancelTransition = () => {
    if (this.transition)
      this.preset = this.camera.position.y < this.controls.target.y ? 'underside' : 'perspective';
    this.transition = null;
    this.controls.enableDamping = true;
    this.setLimits();
  };
  private setLimits() {
    this.controls.minPolarAngle = this.preset === 'underside' ? Math.PI / 2 + 0.015 : 0.015;
    this.controls.maxPolarAngle =
      this.preset === 'underside' ? Math.PI - 0.015 : Math.PI / 2 - 0.015;
  }
  private clearMomentum() {
    // Consume the remaining OrbitControls delta before recording an exact start/restore pose.
    this.controls.enableDamping = false;
    this.controls.update();
  }
  restore(state: CameraState) {
    this.transition = null;
    this.clearMomentum();
    this.preset = state.preset;
    this.camera.position.fromArray(state.position);
    this.controls.target.fromArray(state.target);
    this.camera.fov = state.fovDeg;
    this.camera.updateProjectionMatrix();
    this.setLimits();
    this.controls.update();
    this.controls.enableDamping = true;
  }
  setPreset(preset: CameraPreset, product: ProductDefinition, thicknessMm: number) {
    this.clearMomentum();
    const from = new Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    const to = presetOrbit(preset, product, thicknessMm, this.camera.fov, this.camera.aspect);
    this.controls.maxDistance = Math.max(3, to.radius * 1.5);
    this.preset = preset;
    this.transition = createOrbitTransition(
      from,
      to,
      this.controls.target,
      preset === 'close-up' || preset === 'macro'
        ? new Vector3(
            product.widthMm / 2000 - (preset === 'macro' ? 0.014 : 0.035),
            thicknessMm / 2000,
            product.heightMm / 2000 - (preset === 'macro' ? 0.009 : 0.025),
          )
        : new Vector3(0, thicknessMm / 2000, 0),
      product,
      performance.now(),
    );
    this.controls.minPolarAngle = 0.001;
    this.controls.maxPolarAngle = Math.PI - 0.001;
  }
  update(now: number, thicknessMm: number) {
    if (this.transition) {
      const progress = MathUtils.clamp((now - this.transition.start) / 650, 0, 1);
      const pose = sampleOrbitTransition(this.transition, progress);
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      if (progress === 1) {
        this.transition = null;
        this.controls.enableDamping = true;
        this.setLimits();
      }
    }
    this.controls.update();
    this.controls.target.y = thicknessMm / 2000;
    if (!this.transition) {
      if (this.preset === 'underside')
        this.camera.position.y = Math.min(-CAMERA_CLEARANCE, this.camera.position.y);
      else
        this.camera.position.y = Math.max(
          thicknessMm / 1000 + CAMERA_CLEARANCE,
          this.camera.position.y,
        );
    }
    this.camera.lookAt(this.controls.target);
  }
  get underside() {
    return this.preset === 'underside';
  }
  getState(): CameraState {
    return {
      preset: this.preset,
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fovDeg: this.camera.fov,
    };
  }
  dispose() {
    this.controls.removeEventListener('start', this.cancelTransition);
    this.controls.dispose();
  }
}
