import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const target = Number(process.argv[2] || 128);
fs.mkdirSync('work/photo-check', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
try {
  await page.route('**/@vite/client', route => route.fulfill({ body: 'export const injectQuery=(url,q)=>url+(url.includes("?")?"&":"?")+q; export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},send(){}});', contentType: 'application/javascript' }));
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  await page.waitForTimeout(2000);
  const result = await page.evaluate(async target => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const { PhotoRenderer } = await import('/src/photo/PhotoRenderer.ts');
    const { createDefaultProject } = await import('/src/project/index.ts');
    const { loadLibraryFabric } = await import('/src/materials/library.ts');
    const state = createDefaultProject(); state.realism.mode = 'fast'; state.edgePreset = 'stitched'; state.placementSurface = 'white-desk';
    const live = new StudioScene(document.querySelector('#host'), state, error => { if(error) console.error(error); });
    state.materials.fabric = await loadLibraryFabric();
    await live.setMaterialAssets(state.materials); live.update(state);
    const resume = live.pauseForPhoto(), abort = new AbortController();
    const snapshot = await live.preparePhoto(2048, abort.signal);
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const photo = new PhotoRenderer(canvas, 800, 500, live.renderer.toneMappingExposure);
    try {
      const gl = photo.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const adapter = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
      await photo.prepare(snapshot, abort.signal, () => {});
      const start = performance.now();
      while (photo.samples < target) {
        photo.step(); await new Promise(requestAnimationFrame);
        if (performance.now() - start > 600000) throw new Error('Photo check exceeded 10 minutes');
      }
      const blob = await photo.png();
      return { adapter, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), stats: photo.stats, samples: photo.samples };
    } finally { photo.dispose(); resume(); live.dispose(); }
  }, target);
  const pixels = PNG.sync.read(Buffer.from(result.bytes));
  fs.writeFileSync('work/photo-check/photo.png', Buffer.from(result.bytes));
  assert.equal(pixels.width, 800); assert.equal(pixels.height, 500);
  let red = 0, green = 0;
  for(let y=220;y<270;y++)for(let x=375;x<425;x++) { const i=(y*800+x)*4;red+=pixels.data[i];green+=pixels.data[i+1]; }
  assert.ok(green > red * 1.15, 'The teal print must retain its colour under physical lighting');
  assert.ok(pixels.data.filter((v,i)=>i%4===3 && v===255).length > 800*500*.99, 'Photo must be opaque');
  assert.ok(result.stats.expandedThreads > 4000 && result.stats.bakedPrint);
  assert.deepEqual(errors, []);
  delete result.bytes;
  fs.writeFileSync('work/photo-check/checks.json', JSON.stringify({ ...result, colourPreserved: true, opaque: true, errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { if(errors.length)console.log(errors); await browser.close(); }
