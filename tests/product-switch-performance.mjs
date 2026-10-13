import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const output = process.argv[2] ?? 'work/switch-performance/after.json';
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
  : await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  if (!native) await page.goto('http://127.0.0.1:1420/');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="viewport"]')?.dataset.rendererState === 'ready',
  );
  await page.evaluate(() => {
    window.switchTasks = [];
    window.switchGaps = [];
    new PerformanceObserver((list) =>
      window.switchTasks.push(
        ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
      ),
    ).observe({ type: 'longtask', buffered: false });
    let last = performance.now();
    window.switchTimer = setInterval(() => {
      const now = performance.now();
      window.switchGaps.push({ start: last, duration: now - last });
      last = now;
    }, 16);
  });
  const results = [];
  for (const [label, id] of [
    ['Футболка', 'tshirt-gildan-5000'],
    [null, 'tshirt-bella-3001'],
    ['Коврик', 'deskmat-900x400'],
    ['Футболка', 'tshirt-gildan-5000'],
  ]) {
    const start = await page.evaluate(() => performance.now());
    if (label) await page.getByRole('button', { name: label, exact: true }).click();
    else await page.getByLabel('Продукт', { exact: true }).selectOption(id);
    await page.waitForFunction(
      (id) =>
        document.querySelector('[aria-label="Продукт"]')?.value === id &&
        !document.querySelector('[aria-label="Продукт"]').disabled,
      id,
    );
    const ready = await page.evaluate(() => performance.now());
    await page.waitForTimeout(500);
    const result = await page.evaluate(
      ({ start, ready, id }) => ({
        id,
        readyMs: ready - start,
        maxLongTaskMs: Math.max(
          0,
          ...window.switchTasks
            .filter((t) => t.start >= start && t.start <= ready)
            .map((t) => t.duration),
        ),
        maxEventLoopGapMs: Math.max(
          0,
          ...window.switchGaps
            .filter((t) => t.start >= start && t.start <= ready)
            .map((t) => t.duration),
        ),
        diagnostics: JSON.parse(
          document.querySelector('[data-testid="scene-diagnostics"]').textContent,
        ),
      }),
      { start, ready, id },
    );
    results.push(result);
    console.log(JSON.stringify(result));
  }
  fs.mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []);
  if (process.env.CHECK_SWITCH_BUDGET) {
    for (const r of results) {
      assert.ok(r.readyMs < 5000, `${r.id}: switching exceeds 5 seconds`);
      assert.ok(r.maxLongTaskMs < 1000, `${r.id}: main thread blocked for a second`);
    }
  }
  await page.evaluate(() => clearInterval(window.switchTimer));
} finally {
  await browser.close();
}
