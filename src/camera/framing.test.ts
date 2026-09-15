import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Spherical, Vector3 } from 'three';
import type { CameraPreset } from '../contracts';
import { PRODUCTS } from '../products';
import { createOrbitTransition, presetOrbit, sampleOrbitTransition } from './framing';

describe('physical product camera framing', () => {
  for (const product of PRODUCTS)
    for (const aspect of [0.65, 1, 1.8, 2.8])
      for (const preset of ['top', 'perspective', 'low-angle', 'underside'] as CameraPreset[]) {
        it(`${product.id} ${preset} fits all corners at aspect ${aspect}`, () => {
          const thicknessMm = 6;
          const camera = new PerspectiveCamera(35, aspect, 0.005, 30);
          const target = new Vector3(0, thicknessMm / 2000, 0);
          camera.position
            .setFromSpherical(presetOrbit(preset, product, thicknessMm, camera.fov, aspect))
            .add(target);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          for (const x of [-product.widthMm / 2000, product.widthMm / 2000])
            for (const y of [0, thicknessMm / 1000])
              for (const z of [-product.heightMm / 2000, product.heightMm / 2000]) {
                const point = new Vector3(x, y, z).project(camera);
                expect(Math.abs(point.x)).toBeLessThan(0.9);
                expect(Math.abs(point.y)).toBeLessThan(0.9);
                expect(point.z).toBeGreaterThan(-1);
                expect(point.z).toBeLessThan(1);
              }
        });
      }
});

describe('safe preset transitions', () => {
  const product = PRODUCTS[0]!;
  it('keeps the exact initial pose and ends at the centered destination', () => {
    const fromTarget = new Vector3(0.15, 0.0015, -0.1),
      target = new Vector3(0, 0.0015, 0);
    const from = presetOrbit('close-up', product, 3, 35, 1),
      to = presetOrbit('top', product, 3, 35, 1);
    const transition = createOrbitTransition(from, to, fromTarget, target, product, 0);
    expect(
      sampleOrbitTransition(transition, 0).position.distanceTo(
        new Vector3().setFromSpherical(from).add(fromTarget),
      ),
    ).toBeLessThan(1e-12);
    expect(
      sampleOrbitTransition(transition, 1).position.distanceTo(
        new Vector3().setFromSpherical(to).add(target),
      ),
    ).toBeLessThan(1e-12);
  });
  it('travels outside the product when changing from a panned close-up to underside and back', () => {
    for (const reverse of [false, true]) {
      const target = new Vector3(0, 0.0015, 0),
        panned = new Vector3(0.4, 0.0015, 0);
      const close = presetOrbit('close-up', product, 3, 35, 1),
        underside = presetOrbit('underside', product, 3, 35, 1);
      const transition = reverse
        ? createOrbitTransition(underside, close, target, panned, product, 0)
        : createOrbitTransition(close, underside, panned, target, product, 0);
      for (let i = 0; i <= 1000; i++) {
        const { position } = sampleOrbitTransition(transition, i / 1000);
        const nearProductPlane = position.y > -0.01 && position.y < 0.013;
        if (nearProductPlane)
          expect(Math.hypot(position.x, position.z)).toBeGreaterThan(
            Math.hypot(product.widthMm, product.heightMm) / 2000,
          );
      }
    }
  });
  it('takes the shortest azimuth route through the ±π boundary', () => {
    const from = new Spherical(1, 0.5, Math.PI - 0.02),
      to = new Spherical(1, 0.5, -Math.PI + 0.02);
    const transition = createOrbitTransition(from, to, new Vector3(), new Vector3(), product, 0);
    expect(Math.abs(transition.to.theta - transition.from.theta)).toBeCloseTo(0.04);
  });
});
