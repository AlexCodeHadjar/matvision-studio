import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = process.argv[2] ?? 'work/catalog-smoke';
fs.mkdirSync(out, { recursive: true });
const native = process.env.NATIVE_CDP;
const browser = native
  ? await chromium.connectOverCDP(native)
  : await chromium.launch({
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
      args: ['--force_high_performance_gpu'],
    });
const page = native
  ? browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('tauri.localhost'))
  : await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.setDefaultTimeout(45000);
if (!native) await page.routeWebSocket('**', () => {});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const report = { errors, switches: [] };
const resources = [];
page.on('response', r => {
  if (/models\/catalog\/|cotton-jersey/.test(r.url())) resources.push({url:r.url(),status:r.status()});
});
try {
  if (!native) await page.goto('http://127.0.0.1:1420/');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="viewport"]')?.dataset.rendererState === 'ready',
  );
  if (native) {
    report.runtime = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('runtime_info', {}));
    assert.equal(report.runtime.appVersion, '0.3.0', 'The tested native executable must be the new release');
  }
  const choices = [
    ['Кружка', 'mug-11oz'],
    ['Худи', 'hoodie-white'],
    ['Свитшот', 'sweatshirt-white'],
    ['Сумка-шоппер', 'tote-white'],
    ['Лонгслив', 'longsleeve-white'],
    ['Поло', 'polo-white'],
    ['Бейсболка', 'cap-white'],
    ['Фартук', 'apron-white'],
    ['Футболка', 'tshirt-gildan-5000'],
    ['Коврик', 'deskmat-900x400'],
  ];
  for (const [label, id] of choices) {
    const start = Date.now();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(
      (id) =>
        document.querySelector('[aria-label="Продукт"]')?.value === id &&
        !document.querySelector('[aria-label="Продукт"]').disabled,
      id,
    );
    const ms = Date.now() - start;
    assert.ok(ms < 6000, `${id} selection took ${ms}ms`);
    await page.getByTestId('image-input').setInputFiles('tests/fixtures/color-patches.png');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Продукт"]').disabled);
    const twoSides = ['hoodie', 'sweatshirt', 'tote', 'longsleeve', 'polo', 'tshirt'].some((k) =>
      id.startsWith(k),
    );
    if (twoSides) {
      await page.getByRole('button', { name: 'Сзади', exact: true }).first().click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Продукт"]').disabled);
      await page.getByTestId('image-input').setInputFiles('tests/fixtures/landscape-grid.png');
      await page.waitForFunction(() => !document.querySelector('[aria-label="Продукт"]').disabled);
      await page.getByRole('button', { name: 'Спереди', exact: true }).first().click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Продукт"]').disabled);
      assert.ok(
        await page.getByText('color-patches.png', { exact: true }).count(),
        `${id} front artwork lost`,
      );
    }
    report.switches.push({ id, readyMs: ms, twoSides });
    if (id === 'hoodie-white' || id === 'cap-white')
      await page.screenshot({ path: `${out}/${id}-ui.png` });
  }
  if (!native) {
    await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
    report.products = await page.evaluate(async () => {
      const { StudioScene } = await import('/src/scene/StudioScene.ts');
      const { PRODUCTS, validateProduct } = await import('/src/products/index.ts');
      const { createDefaultProject, serializeProject, parseProject } =
        await import('/src/project/index.ts');
      const live = new StudioScene(document.querySelector('#host'), createDefaultProject(), (e) => {
        if (e) throw Error(e);
      });
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 128, 128);
      const red = {
        name: 'front.png',
        mimeType: 'image/png',
        widthPx: 128,
        heightPx: 128,
        dataUrl: c.toDataURL(),
      };
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 128, 128);
      const blue = { ...red, name: 'back.png', dataUrl: c.toDataURL() };
      const records = [];
      for (const p of PRODUCTS.filter((p) => p.kind && p.kind !== 'tshirt')) {
        validateProduct(p);
        const s = createDefaultProject(p.id);
        s.source = red;
        s.layout = { mode: 'stretch', scale: 3, offsetX: 0, offsetY: 0, rotationDeg: 0 };
        if (p.backPrintableArea) s.sidePrints.back = { source: blue, layout: { ...s.layout } };
        const parsed = parseProject(serializeProject(s));
        await live.loadProject(parsed);
        const canvas = live.merch.canvases.front,
          cx = canvas.getContext('2d');
        const x = Math.floor(
            ((p.printableArea.xMm + p.printableArea.widthMm / 2) / p.widthMm) * canvas.width,
          ),
          y = Math.floor(
            ((p.printableArea.yMm + p.printableArea.heightMm / 2) / p.heightMm) * canvas.height,
          );
        const center = Array.from(cx.getImageData(x, y, 1, 1).data),
          outside = Array.from(cx.getImageData(0, 0, 1, 1).data);
        const snapshot = await live.preparePhoto(512, new AbortController().signal, 'studio');
        const photoMeshes = snapshot.scene.children.length;
        snapshot.dispose();
        const blob = await live.exportPng({ widthPx: 400, heightPx: 400 });
        records.push({
          id: p.id,
          restored: parsed.productId,
          back: parsed.sidePrints.back?.source?.name,
          center,
          outside,
          photoMeshes,
          pngBytes: blob.size,
        });
      }
      live.dispose();
      return records;
    });
    for (const p of report.products) {
      assert.equal(p.restored, p.id);
      assert.deepEqual(p.center, [255, 0, 0, 255]);
      assert.ok(p.outside[1] > 180, `${p.id} print leaked outside safe area`);
      assert.ok(p.pngBytes > 1000);
      assert.ok(p.photoMeshes > 0);
      if (p.back) assert.equal(p.back, 'back.png');
    }
  }
  assert.deepEqual(errors, []);
  if (native) {
    report.resources = resources;
    assert.ok(resources.every(r => r.status === 200), 'All bundled product resources must load');
    assert.ok(resources.filter(r => r.url.includes('models/catalog/')).length >= 7, 'All seven catalogue models must be bundled');
  }
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
