import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const output = 'work/garment-photo';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--force_high_performance_gpu'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  const result = await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const { PhotoRenderer } = await import('/src/photo/PhotoRenderer.ts');
    const { createDefaultProject } = await import('/src/project/index.ts');
    const s = createDefaultProject('tshirt-gildan-5000');
    s.realism.mode = 'fast';
    const artwork = document.createElement('canvas');
    artwork.width = artwork.height = 200;
    const ctx = artwork.getContext('2d');
    ctx.fillStyle = '#d93b27';
    ctx.fillRect(0, 0, 200, 200);
    s.source = {
      name: 'red.png',
      mimeType: 'image/png',
      widthPx: 200,
      heightPx: 200,
      dataUrl: artwork.toDataURL(),
    };
    const live = new StudioScene(document.querySelector('#host'), s, console.error);
    await live.loadProject(s);
    const results = [];
    for (const [name, position, target] of [
      ['front', [0, 0.39, 1.65], [0, 0.37, 0]],
      ['inside', [0.12, -0.4, 0.09], [0, 0.09, 0]],
    ]) {
      live.rig.restore({ preset: 'perspective', position, target, fovDeg: 35 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const resume = live.pauseForPhoto(),
        abort = new AbortController();
      const snapshot = await live.preparePhoto(1024, abort.signal, 'studio');
      const canvas = document.createElement('canvas');
      const photo = new PhotoRenderer(canvas, 400, 400, live.renderer.toneMappingExposure);
      try {
        await photo.prepare(snapshot, abort.signal, () => {});
        const started = performance.now();
        while (photo.samples < 12) {
          photo.step();
          await new Promise(requestAnimationFrame);
          if (performance.now() - started > 180000) throw Error('Photo rendering timed out');
        }
        const bytes = Array.from(new Uint8Array(await (await photo.png()).arrayBuffer()));
        results.push({ name, bytes, samples: photo.samples, stats: photo.stats });
      } finally {
        photo.dispose();
        resume();
      }
    }
    live.dispose();
    return results;
  });
  for (const r of result) {
    fs.writeFileSync(`${output}/${r.name}.png`, Buffer.from(r.bytes));
    delete r.bytes;
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${output}/report.json`, JSON.stringify({ result, errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
