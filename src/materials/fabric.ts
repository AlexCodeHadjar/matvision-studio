import { CanvasTexture, MeshStandardMaterial } from 'three';
import { markColorTexture } from '../color/ColorPipeline';
export function createInitialFabric() {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось подготовить материал поверхности.');
  ctx.fillStyle = '#24464c';
  ctx.fillRect(0, 0, 1800, 800);
  ctx.strokeStyle = '#56736f';
  ctx.lineWidth = 2;
  for (let x = 45; x < 1800; x += 55) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 800);
    ctx.stroke();
  }
  for (let y = 15; y < 800; y += 55) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1800, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#d8d6b9';
  ctx.font = '500 84px Segoe UI, sans-serif';
  ctx.fillText('MAKE IT YOURS.', 104, 190);
  ctx.font = '26px Segoe UI, sans-serif';
  ctx.fillText('MATVISION STUDIO  /  900 × 400', 109, 251);
  ctx.strokeStyle = '#d8d6b9';
  ctx.lineWidth = 3;
  for (let r = 45; r < 340; r += 30) {
    ctx.beginPath();
    ctx.arc(1420, 460, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  markColorTexture(texture);
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.88, metalness: 0 });
  return { material, texture };
}
