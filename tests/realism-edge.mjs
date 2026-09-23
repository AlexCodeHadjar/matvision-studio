import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  await page.waitForTimeout(1000);
  const result = await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const { createDefaultProject } = await import('/src/project/index.ts');
    const state = createDefaultProject(); state.realism.mode = 'detailed';
    const messages = [];
    const s = new StudioScene(document.querySelector('#host'), state, message => messages.push(message));
    const frames = (n = 3) => new Promise(resolve => { const tick = () => --n > 0 ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick); });
    await frames(6);
    const tiny = await s.exportPng({ widthPx: 1, heightPx: 1 });
    let bounded = false;
    try { await s.exportPng({ widthPx: 8192, heightPx: 8192 }); } catch { bounded = true; }
    const latest = await Promise.all([s.setMaterialAssets(state.materials), s.setMaterialAssets(state.materials)]);
    const gl = s.renderer.getContext(), extension = gl.getExtension('WEBGL_lose_context');
    let recovered = null;
    if (extension) {
      await new Promise(resolve => { s.renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true }); extension.loseContext(); });
      await new Promise(resolve => setTimeout(resolve, 150));
      await new Promise(resolve => { s.renderer.domElement.addEventListener('webglcontextrestored', resolve, { once: true }); extension.restoreContext(); });
      await frames(8);
      const blob = await s.exportPng({ widthPx: 800, heightPx: 600 });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(0, 0, 800, 600).data;
      let min = 255, max = 0;
      for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); }
      recovered = !s.getDiagnostics().contextLost && max - min > 20;
    }
    const diagnostics = s.getDiagnostics();
    s.dispose();
    return { tinyPng: tiny.size > 0, bounded, latest, recovered, shaderFailed: s.shaderFailed, messages, dimensionsRestored: diagnostics.rendererWidthPx === 800 && diagnostics.rendererHeightPx === 600 };
  });
  assert.ok(result.tinyPng && result.bounded && result.dimensionsRestored);
  assert.deepEqual(result.latest, [false, true]);
  assert.equal(result.recovered, true);
  assert.equal(result.shaderFailed, false);
  assert.deepEqual(errors, []);
  fs.writeFileSync('work/realism-check/edge-checks.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
