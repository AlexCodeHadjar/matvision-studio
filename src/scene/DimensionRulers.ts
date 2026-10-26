import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { ProductDefinition } from '../contracts';
import { createRulerLayout, type RulerLabel } from '../geometry/rulers';
import { markColorTexture } from '../color/ColorPipeline';

export class DimensionRulers extends Group {
  private labels: { sprite: Sprite; definition: RulerLabel }[] = [];
  private readonly point = new Vector3();
  private readonly cameraPoint = new Vector3();
  widthMm = 0;
  heightMm = 0;
  rebuild(product: ProductDefinition) {
    this.disposeContents();
    const layout = createRulerLayout(product);
    this.widthMm = layout.widthMm;
    this.heightMm = layout.heightMm;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(layout.positions, 3));
    const line = new LineSegments(
      geometry,
      new LineBasicMaterial({
        color: '#31594f',
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 1000;
    this.add(line);
    for (const definition of layout.labels) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#f6f8f1';
      ctx.beginPath();
      ctx.roundRect(2, 5, 124, 54, 8);
      ctx.fill();
      if (definition.primary) {
        ctx.strokeStyle = '#31594f';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = '#263f37';
      ctx.font = `${definition.primary ? '600 34' : '500 28'}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(definition.text, 64, 33, 116);
      const map = new CanvasTexture(canvas);
      markColorTexture(map);
      const sprite = new Sprite(
        new SpriteMaterial({
          map,
          transparent: true,
          toneMapped: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      sprite.position.fromArray(definition.position);
      sprite.name = `ruler-${definition.axis}-${definition.primary ? 'total' : definition.valueMm}`;
      sprite.renderOrder = definition.primary ? 1002 : 1001;
      this.add(sprite);
      this.labels.push({ sprite, definition });
    }
  }
  /** Keep text readable in CSS pixels and suppress crowded intermediate numbers at shallow angles. */
  updateLabels(camera: PerspectiveCamera, viewportWidth: number, viewportHeight: number) {
    this.updateMatrixWorld(true);
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    const sorted = [...this.labels].sort(
      (a, b) =>
        Number(b.definition.primary) - Number(a.definition.primary) ||
        Number(b.definition.endpoint) - Number(a.definition.endpoint),
    );
    for (const { sprite, definition } of sorted) {
      sprite.getWorldPosition(this.point);
      this.cameraPoint.copy(this.point).applyMatrix4(camera.matrixWorldInverse);
      const pixels = definition.primary ? 36 : 26;
      const height =
        (2 * Math.abs(this.cameraPoint.z) * Math.tan((camera.fov * Math.PI) / 360) * pixels) /
        Math.max(1, viewportHeight);
      sprite.scale.set(height * 2, height, 1);
      this.point.project(camera);
      const box = {
        x: ((this.point.x + 1) * viewportWidth) / 2,
        y: ((1 - this.point.y) * viewportHeight) / 2,
        w: pixels * 2,
        h: pixels,
      };
      sprite.visible =
        this.cameraPoint.z < 0 &&
        (definition.primary ||
          !occupied.some(
            (other) =>
              Math.abs(box.x - other.x) < (box.w + other.w) / 2 + 3 &&
              Math.abs(box.y - other.y) < (box.h + other.h) / 2 + 3,
          ));
      if (sprite.visible) occupied.push(box);
    }
  }
  disposeContents() {
    for (const child of this.children) {
      if (child instanceof LineSegments) {
        child.geometry.dispose();
        (child.material as LineBasicMaterial).dispose();
      }
      if (child instanceof Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    }
    this.labels = [];
    this.clear();
  }
}
