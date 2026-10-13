import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const output = process.argv[2] ?? 'work/garment-review/r4';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--force_high_performance_gpu'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const api = await import('/src/project/index.ts');
    const products = await import('/src/products/index.ts');
    window.api = api;
    window.products = products;
    window.live = new StudioScene(
      document.querySelector('#host'),
      api.createDefaultProject('tshirt-gildan-5000'),
      (e) => {
        if (e) throw Error(e);
      },
    );
    window.makePrint = (back, wide = false) => {
      const c = document.createElement('canvas');
      c.width = wide ? 1800 : 900;
      c.height = wide ? 750 : 1000;
      const ctx = c.getContext('2d');
      ctx.scale(c.width / 900, c.height / 1000);
      ctx.fillStyle = back ? '#223f63' : '#d76140';
      ctx.fillRect(70, 40, 760, 740);
      ctx.fillStyle = back ? '#c0d9de' : '#f8d9a7';
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.ellipse(450, 410, 330 - i * 35, 320 - i * 33, Math.PI * 0.11, 0, Math.PI * 2);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 11;
        ctx.stroke();
      }
      ctx.fillStyle = '#132e36';
      ctx.textAlign = 'center';
      ctx.font = 'bold 70px Arial';
      ctx.fillText(back ? 'REVERSE / 02' : 'STUDIO / 01', 450, 880);
      return {
        name: back ? 'review-back.png' : 'review-front.png',
        mimeType: 'image/png',
        widthPx: c.width,
        heightPx: c.height,
        dataUrl: c.toDataURL(),
      };
    };
  });
  const report = { errors, products: {} };
  for (const id of ['tshirt-gildan-5000', 'tshirt-bella-3001', 'mug-11oz']) {
    report.products[id] = await page.evaluate(async (id) => {
      const s = window.api.createDefaultProject(id),
        src = window.makePrint(false, id === 'mug-11oz'),
        back = window.makePrint(true);
      s.source = src;
      s.layout = window.products.initialPrintLayout(id, src);
      if (id.startsWith('tshirt'))
        s.sidePrints.back = {
          source: back,
          layout: window.products.initialPrintLayout(id, back, 'back'),
        };
      window.currentState = s;
      await window.live.loadProject(s);
      const restored = window.api.parseProject(window.api.serializeProject(s));
      const photo = await window.live.preparePhoto(512, new AbortController().signal, 'studio');
      const photoMeshes = photo.scene.children.length;
      photo.dispose();

      const ray = window.live.raycaster;
      ray.ray.origin.set(0, 0.9, 0);
      ray.ray.direction.set(0, -1, 0);
      window.live.mat.updateMatrixWorld(true);
      const openNeck = ray.intersectObjects(window.live.mat.children).length === 0;
      return {
        backSaved: restored.sidePrints.back?.source?.name,
        photoMeshes,
        openNeck,
        innerPrinted: window.live.mat.children
          .filter((m) => m.name.includes('inner cotton'))
          .some((m) => !!m.material.map),
      };
    }, id);
    const views =
      id === 'mug-11oz'
        ? [
            ['printed-quarter', [-0.055, 0.13, 0.3], [0.012, 0.047, 0]],
            ['printed-front', [-0.19, 0.12, 0.23], [0, 0.047, 0]],
            ['printed-top', [-0.09, 0.3, 0.13], [0.005, 0.052, 0]],
            ['printed-handle-gap', [0.15, 0.1, 0.19], [0.026, 0.052, 0]],
          ]
        : [
            ['printed-front', [0.35, 0.48, 1.6], [0, 0.36, 0]],
            ['printed-back', [-0.35, 0.48, -1.6], [0, 0.36, 0]],
            ['printed-neck', [0.12, 0.87, 0.4], [0, 0.65, 0]],
            ['printed-hem', [0.12, -0.4, 0.09], [0, 0.09, 0]],
          ];
    for (const [name, position, target] of views) {
      await page.evaluate(
        ({ position, target }) =>
          window.live.rig.restore({ preset: 'perspective', position, target, fovDeg: 35 }),
        { position, target },
      );
      await page.waitForTimeout(220);
      const bytes = await page.evaluate(async () =>
        Array.from(
          new Uint8Array(
            await (await window.live.exportPng({ widthPx: 1200, heightPx: 1200 })).arrayBuffer(),
          ),
        ),
      );
      fs.writeFileSync(`${output}/${id}-${name}.png`, Buffer.from(bytes));
      console.log(id, name);
    }
  }
  assert.equal(errors.length, 0);
  for (const [id, result] of Object.entries(report.products))
    if (id.startsWith('tshirt')) {
      assert.ok(result.openNeck);
      assert.equal(result.innerPrinted, false);
      assert.equal(result.backSaved, 'review-back.png');
    }
  fs.writeFileSync(`${output}/print-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await page.evaluate(() => window.live.dispose());
} finally {
  await browser.close();
}
