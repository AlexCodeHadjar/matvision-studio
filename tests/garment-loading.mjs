import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
try {
  await page.route('**/tshirt-bella-3001.mvgz', (r) =>
    r.fulfill({ status: 404, body: 'missing test resource' }),
  );
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  const failure = await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts'),
      { createDefaultProject } = await import('/src/project/index.ts');
    window.live = new StudioScene(
      document.querySelector('#host'),
      createDefaultProject(),
      console.error,
    );
    window.makeState = createDefaultProject;
    let rejected = false;
    try {
      await live.loadProject(makeState('tshirt-bella-3001'));
    } catch {
      rejected = true;
    }
    return { rejected, product: live.getDiagnostics().productId, meshes: live.mat.children.length };
  });
  assert.ok(failure.rejected);
  assert.equal(failure.product, 'deskmat-900x400');
  assert.ok(failure.meshes > 0);
  await page.unroute('**/tshirt-bella-3001.mvgz');
  const retry = await page.evaluate(async () => {
    await live.loadProject(makeState('tshirt-bella-3001'));
    return {
      product: live.getDiagnostics().productId,
      meshes: live.mat.children.length,
      surface: !!live.surface,
    };
  });
  assert.equal(retry.product, 'tshirt-bella-3001');
  assert.equal(retry.meshes, 7);
  assert.ok(retry.surface);
  const race = await page.evaluate(async () => {
    const shirt = live.loadProject(makeState('tshirt-gildan-5000'));
    const mug = live.loadProject(makeState('mug-11oz'));
    await Promise.all([shirt, mug]);
    await new Promise((r) => setTimeout(r, 100));
    const result = {
      product: live.getDiagnostics().productId,
      names: live.mat.children.map((m) => m.name),
    };
    live.dispose();
    return result;
  });
  assert.equal(race.product, 'mug-11oz');
  assert.equal(race.names.length, 2);
  assert.ok(race.names.every((n) => !n.includes('Cotton')));
  fs.mkdirSync('work/switch-performance', { recursive: true });
  fs.writeFileSync(
    'work/switch-performance/loading.json',
    JSON.stringify({ failure, retry, race }, null, 2),
  );
  console.log(JSON.stringify({ failure, retry, race }));
} finally {
  await browser.close();
}
