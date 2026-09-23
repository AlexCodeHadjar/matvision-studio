import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  await page.waitForTimeout(2000);
  const result = await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const { ThreePathTracerBackend } = await import('/src/photo/PhotoRenderer.ts');
    const { createDefaultProject } = await import('/src/project/index.ts');
    const state = createDefaultProject();
    state.realism.mode = 'fast';
    const blob = await (await fetch('/tests/fixtures/white.png')).blob();
    const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    state.materials.fabric.maps.height = { name: 'height.png', mimeType: 'image/png', dataUrl, widthPx: 512, heightPx: 512 };
    const live = new StudioScene(document.querySelector('#host'), state, (error) => { if (error) console.error(error); });
    await live.setMaterialAssets(state.materials);
    live.update(state);
    const resume = live.pauseForPhoto();
    const abort = new AbortController();
    const snapshot = await live.preparePhoto(1024, abort.signal, 'studio', 0.1);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const settings = { preset: 'high', samples: 128, longSidePx: 1920, denoise: 'smart', focalLengthMm: null, focusDistanceMm: 500, fStop: 8, displacementMm: 0.1 };
    const photo = new ThreePathTracerBackend(canvas, 640, 400, live.renderer.toneMappingExposure, settings);
    try {
      await photo.prepare(snapshot, abort.signal, () => {});
      while (photo.samples < 2) { photo.step(); await new Promise(requestAnimationFrame); }
      photo.finish(abort.signal);
      const png = await photo.png();
      return { bytes: Array.from(new Uint8Array(await png.arrayBuffer())), stats: photo.stats, samples: photo.samples };
    } finally { photo.dispose(); resume(); live.dispose(); }
  });
  const bytes = Buffer.from(result.bytes);
  const png = PNG.sync.read(bytes);
  assert.equal(png.width, 640);
  assert.equal(png.height, 400);
  assert.ok(result.stats.displacedTriangles > 0);
  assert.ok(result.samples >= 2);
  assert.deepEqual(errors, []);
  fs.mkdirSync('work/photo-017', { recursive: true });
  fs.writeFileSync('work/photo-017/denoise-dof-displacement.png', bytes);
  fs.writeFileSync('work/photo-017/checks.json', JSON.stringify({ samples: result.samples, stats: result.stats, width: png.width, height: png.height, errors }, null, 2));
  console.log(JSON.stringify({ samples: result.samples, stats: result.stats, width: png.width, height: png.height, errors }));
} finally {
  await browser.close();
}
