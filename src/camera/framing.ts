import { MathUtils, Spherical, Vector3 } from 'three';
import type { CameraPreset, ProductDefinition } from '../contracts';

export const CAMERA_CLEARANCE = 0.01;

/** Fit the physical bounding box against both frustum axes, including perspective depth. */
export function presetOrbit(
  preset: CameraPreset,
  product: ProductDefinition,
  thicknessMm: number,
  fovDeg: number,
  aspect: number,
): Spherical {
  const width = product.widthMm / 1000,
    height = product.heightMm / 1000;
  let direction: Vector3;
  switch (preset) {
    case 'top':
      direction = new Vector3(0, 1, 0.015);
      break;
    case 'low-angle':
      direction = new Vector3(0.7, 0.13, 1);
      break;
    case 'close-up':
      direction = new Vector3(0.35, 0.4, 1);
      break;
    case 'macro':
      direction = new Vector3(0.35, 0.65, 1);
      break;
    case 'underside':
      direction = new Vector3(0.5, -1, 0.6);
      break;
    default:
      direction = new Vector3()
        .fromArray(product.defaultCameraFraming.position)
        .sub(new Vector3().fromArray(product.defaultCameraFraming.target));
  }
  direction.normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
  const up = new Vector3().crossVectors(direction, right).normalize();
  const tanV = Math.tan(MathUtils.degToRad(fovDeg / 2)),
    tanH = tanV * aspect;
  let distance = 0;
  for (const x of [-width / 2, width / 2])
    for (const y of [-thicknessMm / 2000, thicknessMm / 2000])
      for (const z of [-height / 2, height / 2]) {
        const point = new Vector3(x, y, z);
        distance = Math.max(
          distance,
          point.dot(direction) +
            Math.max(Math.abs(point.dot(right)) / tanH, Math.abs(point.dot(up)) / tanV),
        );
      }
  distance =
    preset === 'macro'
      ? 0.085
      : preset === 'close-up'
        ? Math.max(0.08, Math.max(width, height) * 0.26)
        : distance * 1.2;
  return new Spherical().setFromVector3(direction.multiplyScalar(distance));
}

export interface OrbitTransition {
  start: number;
  from: Spherical;
  to: Spherical;
  fromTarget: Vector3;
  toTarget: Vector3;
  /** A hemisphere change travels outside this enclosing sphere before crossing the edge. */
  clearanceRadius: number | null;
}

export function createOrbitTransition(
  from: Spherical,
  to: Spherical,
  fromTarget: Vector3,
  toTarget: Vector3,
  product: ProductDefinition,
  start: number,
): OrbitTransition {
  const destination = to.clone();
  while (destination.theta - from.theta > Math.PI) destination.theta -= Math.PI * 2;
  while (destination.theta - from.theta < -Math.PI) destination.theta += Math.PI * 2;
  const crossesProduct = from.phi < Math.PI / 2 !== to.phi < Math.PI / 2;
  const clearanceRadius = crossesProduct
    ? Math.max(
        from.radius,
        to.radius,
        Math.hypot(product.widthMm, product.heightMm) / 2000 +
          Math.max(Math.hypot(fromTarget.x, fromTarget.z), Math.hypot(toTarget.x, toTarget.z)) +
          0.03,
      )
    : null;
  return {
    start,
    from: from.clone(),
    to: destination,
    fromTarget: fromTarget.clone(),
    toTarget: toTarget.clone(),
    clearanceRadius,
  };
}

const smoothstep = (value: number) => {
  const t = MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Separate radial travel from a hemisphere change so a close-up never cuts through the mat. */
export function sampleOrbitTransition(
  transition: OrbitTransition,
  progress: number,
): { position: Vector3; target: Vector3 } {
  const { from, to, fromTarget, toTarget, clearanceRadius } = transition;
  let rotation = smoothstep(progress),
    radius = MathUtils.lerp(from.radius, to.radius, rotation);
  if (clearanceRadius !== null) {
    rotation = smoothstep((progress - 0.25) / 0.5);
    radius =
      progress < 0.25
        ? MathUtils.lerp(from.radius, clearanceRadius, smoothstep(progress / 0.25))
        : progress > 0.75
          ? MathUtils.lerp(clearanceRadius, to.radius, smoothstep((progress - 0.75) / 0.25))
          : clearanceRadius;
  }
  const target = fromTarget.clone().lerp(toTarget, rotation);
  const orbit = new Spherical(
    radius,
    MathUtils.lerp(from.phi, to.phi, rotation),
    MathUtils.lerp(from.theta, to.theta, rotation),
  );
  return { position: new Vector3().setFromSpherical(orbit).add(target), target };
}
