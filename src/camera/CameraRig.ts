import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraPreset, CameraState, ProductDefinition } from '../contracts';
import { productKind, isTextile } from '../products';
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
  private product: ProductDefinition | null = null;
  setProduct(product: ProductDefinition) {
    this.product = product;
    this.setLimits();
  }
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
    if (this.product && productKind(this.product) !== 'mat') {
      this.controls.maxTargetRadius = isTextile(this.product) ? 1.5 : 0.45;
      this.controls.minPolarAngle = 0.015;
      this.controls.maxPolarAngle = Math.PI - 0.015;
      return;
    }
    this.controls.maxTargetRadius = 0.45;
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
    this.setProduct(product);
    if (productKind(product) !== 'mat') {
      const pose = product.defaultCameraFraming;
      const target = new Vector3().fromArray(pose.target);
      let position = new Vector3().fromArray(pose.position);
      const shirt = isTextile(product);
      const referenceCut = ['hoodie', 'sweatshirt', 'longsleeve'].includes(product.kind ?? '');
      const size = referenceCut ? product.heightMm / 1000 :
        Math.max(product.widthMm, product.heightMm, product.kind === 'cap' ? 340 : 0) / 1000;
      const h = product.heightMm / 1000;
      if (shirt) {
        if (preset === 'top') position.set(0, target.y, size * 2.15);
        if (preset === 'underside') position.set(0, target.y, -size * 2.15);
        if (preset === 'low-angle') position.set(size * 0.65, target.y, size * 1.9);
        if (preset === 'close-up') {
          target.set(0, h * 0.6, 0.02);
          position.set(size * 0.1, h * 0.63, size);
        }
        if (preset === 'macro') {
          target.set(size * 0.12, h * 0.5, 0.02);
          position.set(size * 0.15, h * 0.52, size * 0.27);
        }
      } else {
        if (preset === 'top') position.set(0.01, 0.36, 0.02);
        if (preset === 'underside') position.set(0.28, 0.15, 0.22);
        if (preset === 'low-angle') position.set(-0.28, 0.06, 0.25);
        if (preset === 'close-up') position.set(-0.15, 0.12, 0.18);
        if (preset === 'macro') {
          target.set(-0.035, 0.05, 0.02);
          position.set(-0.14, 0.075, 0.11);
        }
      }
      this.restore({
        preset,
        position: position.toArray(),
        target: target.toArray(),
        fovDeg: pose.fovDeg,
      });
      this.controls.minDistance = shirt ? 0.08 : 0.025;
      this.controls.maxDistance = 3;
      return;
    }
    this.clearMomentum();
    this.controls.minDistance = 0.08;
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
    if (this.product && productKind(this.product) !== 'mat') {
      this.controls.update();
      if (productKind(this.product) === 'mug')
        this.camera.position.y = Math.max(0.003, this.camera.position.y);
      this.camera.lookAt(this.controls.target);
      return;
    }
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
    return this.preset === 'underside' && (!this.product || productKind(this.product) === 'mat');
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
