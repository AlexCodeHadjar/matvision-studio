import { chromium } from '@playwright/test';
import fs from 'node:fs';
const output = process.argv[2] ?? 'work/garment-review/r1';
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
  for (let attempt = 0; ; attempt++) {
    try {
      await page.evaluate(async () => {
        const { StudioScene } = await import('/src/scene/StudioScene.ts');
        const { createDefaultProject } = await import('/src/project/index.ts');
        window.makeState = createDefaultProject;
        window.live = new StudioScene(
          document.querySelector('#host'),
          createDefaultProject('tshirt-gildan-5000'),
          (e) => {
            if (e) console.error(e);
          },
        );
      });
      break;
    } catch (e) {
      if (attempt >= 2 || !String(e).includes('Execution context was destroyed')) throw e;
      await page.waitForTimeout(1000);
    }
  }
  const shirtViews = [
    ['front', [0, 0.39, 1.65], [0, 0.37, 0]],
    ['quarter', [0.8, 0.62, 1.4], [0, 0.36, 0]],
    ['back', [-0.3, 0.48, -1.6], [0, 0.36, 0]],
    ['neck', [0.12, 0.87, 0.4], [0, 0.65, 0]],
    ['hem', [0.16, -0.21, 0.34], [0, 0.12, 0]],
    ['sleeve', [0.58, 0.45, 0.14], [0.29, 0.51, 0]],
    ['collar', [0.05, 0.735, 0.215], [0.01, 0.668, 0.02]],
    ['cotton', [0.04, 0.33, 0.15], [0.02, 0.32, 0.058]],
  ];
  const mugViews = [
    ['quarter', [0.18, 0.15, 0.23], [0.012, 0.047, 0]],
    ['top', [0.09, 0.3, 0.13], [0.005, 0.052, 0]],
    ['handle', [0.17, 0.11, 0.14], [0.043, 0.051, 0]],
    ['front', [-0.18, 0.09, 0.25], [0, 0.047, 0]],
  ];
  for (const id of ['tshirt-gildan-5000', 'tshirt-bella-3001', 'mug-11oz']) {
    await page.evaluate(async (id) => {
      const state = window.makeState(id);
      await window.live.loadProject(state);
      window.currentState = state;
    }, id);
    for (const [name, position, target] of id === 'mug-11oz' ? mugViews : shirtViews) {
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
  fs.writeFileSync(`${output}/errors.json`, JSON.stringify(errors));
  await page.evaluate(() => window.live.dispose());
} finally {
  await browser.close();
}
