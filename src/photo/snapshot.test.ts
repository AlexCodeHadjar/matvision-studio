import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { expandThreads } from './snapshot';

describe('photo stitched geometry', () => {
  it('preserves world transforms, opaque RGBA colours and unit normals', async () => {
    const source = new BoxGeometry(1, 1, 1),
      material = new MeshStandardMaterial();
    const mesh = new InstancedMesh(source, material, 2);
    mesh.position.y = 3;
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0));
    mesh.setMatrixAt(1, new Matrix4().makeRotationZ(Math.PI / 2).setPosition(2, 0, 0));
    mesh.setColorAt(0, new Color().setRGB(0.2, 0.3, 0.4));
    mesh.setColorAt(1, new Color().setRGB(0.5, 0.6, 0.7));
    mesh.updateMatrixWorld(true);
    const result = await expandThreads(mesh, new AbortController().signal);
    try {
      result.computeBoundingBox();
      expect(result.boundingBox!.min.toArray()).toEqual([-2.5, 2.5, -0.5]);
      expect(result.boundingBox!.max.toArray()).toEqual([2.5, 3.5, 0.5]);
      const colors = result.getAttribute('color'),
        normals = result.getAttribute('normal');
      expect(colors.itemSize).toBe(4);
      expect(colors.getX(0)).toBeCloseTo(0.2);
      expect(colors.getX(colors.count / 2)).toBeCloseTo(0.5);
      for (let i = 0; i < colors.count; i++) {
        expect(colors.getW(i)).toBe(1);
        expect(new Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1);
      }
      expect(source.getAttribute('position').count).toBe(24);
    } finally {
      result.dispose();
      source.dispose();
      material.dispose();
    }
  });
  it('cancels preparation before changing source geometry', async () => {
    const geometry = new BoxGeometry(),
      material = new MeshStandardMaterial();
    const mesh = new InstancedMesh(geometry, material, 1),
      abort = new AbortController();
    abort.abort();
    await expect(expandThreads(mesh, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(geometry.getAttribute('position').count).toBe(24);
    geometry.dispose();
    material.dispose();
  });
});
