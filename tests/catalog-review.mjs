import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = process.argv[2] ?? 'work/catalog-review/r1';
const requested = process.argv.slice(3);
// REVIEW_VIEWS=reference,quarter,... limits captures during quick iterations.
const only = process.env.REVIEW_VIEWS?.split(',');
const wanted = (name) => !only || only.includes(name);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.REVIEW_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--force_high_performance_gpu', ...(process.env.REVIEW_BROWSER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
// A review run retains the loaded module revision while other files are being edited.
await page.routeWebSocket('**', () => {});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const previous = requested.length && fs.existsSync(`${out}/report.json`)
  ? JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')) : null;
const report = { errors, products: previous?.products ?? {} };
try {
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const { createDefaultProject } = await import('/src/project/index.ts');
    const { PRODUCTS } = await import('/src/products/index.ts');
    window.catalog = PRODUCTS;
    window.makeState = createDefaultProject;
    window.live = new StudioScene(
      document.querySelector('#host'),
      createDefaultProject('mug-11oz'),
      (e) => {
        if (e) console.error(e);
      },
    );
  });
  const products = await page.evaluate(() =>
    window.catalog.filter((p) => p.kind && p.kind !== 'tshirt'),
  );
  for (const p of products.filter((p) => !requested.length || requested.includes(p.id))) {
    const start = Date.now();
    await page.evaluate(async (id) => {
      window.s = window.makeState(id);
      await window.live.loadProject(window.s);
    }, p.id);
    const h = p.heightMm / 1000,
      w = p.widthMm / 1000;
    const referenceCut = ['hoodie', 'sweatshirt', 'longsleeve', 'polo'].includes(p.kind);
    const center = h / 2,
      distance = referenceCut ? h * 2 : Math.max(h, w, p.kind === 'cap' ? 0.34 : 0) * 2.15;
    const mug = p.kind === 'mug';
    const views = mug
      ? [
          ['front', [0.012, 0.067, 0.32], [0.012, 0.047, 0]],
          ['quarter', [0.18, 0.15, 0.23], [0.012, 0.047, 0]],
          ['reverse', [0.18, 0.13, -0.23], [0.012, 0.047, 0]],
          ['handle', [0.15, 0.1, 0.19], [0.047, 0.048, 0]],
          ['top', [0.07, 0.28, 0.1], [0.01, 0.048, 0]],
        ]
      : [
          ['front', [0, center, distance], [0, center, 0]],
          ['quarter', [distance * 0.48, center + distance * 0.15, distance * 0.82], [0, center, 0]],
          ['back', [-distance * 0.1, center, -distance], [0, center, 0]],
          ['detail', [w * 0.15, h * 1.07, h * 0.5], [0, h * (referenceCut ? .87 : .78), 0]],
          ['inside', [w * 0.22, -h * 0.15, h * 0.42], [0, h * 0.18, 0]],
        ];
    if (p.kind === 'tote') views.push(['opening', [0.18, 0.82, 0.36], [0, 0.405, 0]]);
    // REVIEW_EXTRA='[["name",[x,y,z],[tx,ty,tz],fov]]' adds ad-hoc diagnostic views.
    if (process.env.REVIEW_EXTRA) views.push(...JSON.parse(process.env.REVIEW_EXTRA));
    // Long-lens view framed like the supplied catalogue photographs.
    if (!mug) {
      // Frame like each photo: the tote fills ≈ 91.5 % of its frame height.
      const fit = (p.kind === 'cap' ? 0.27 : h * (p.kind === 'tote' ? 1.093 : 1.12)) / 2 / Math.tan((6 * Math.PI) / 180);
      views.push(p.kind === 'cap'
        ? ['reference', [0, 0.08 + fit * 0.14, fit * 0.99], [0, 0.07, 0.03], 12]
        : ['reference', [0, center, fit], [0, center, 0], 12]);
    }
    if (p.kind === 'polo') {
      const cuff = await page.evaluate(() => {
        const positions = window.live.merch.surfaces.front.geometry.getAttribute('position');
        let best = null;
        for (let i = 0; i < positions.count; i++)
          if (!best || positions.getX(i) > best.x) best = { x: positions.getX(i), y: positions.getY(i) };
        return best;
      });
      views.push(['cuff', [cuff.x + 0.12, cuff.y - 0.02, 0.22], [cuff.x - 0.04, cuff.y, 0]]);
    }
    if (['hoodie', 'sweatshirt', 'longsleeve'].includes(p.kind)) {
      const cuff = await page.evaluate(() => {
        const positions=window.live.merch.surfaces.front.geometry.getAttribute('position');
        let bottom=Infinity;for(let i=0;i<positions.count;i++)bottom=Math.min(bottom,positions.getY(i));
        let lo=Infinity,hi=-Infinity;for(let i=0;i<positions.count;i++)
          if(positions.getY(i)<bottom+.02&&positions.getX(i)>.10){lo=Math.min(lo,positions.getX(i));hi=Math.max(hi,positions.getX(i));}
        return {x:(lo+hi)/2,y:bottom+.035};
      });
      views.push(['cuff', [cuff.x + 0.05, cuff.y + .12, 0.25], [cuff.x, cuff.y, 0]]);
    }
    for (const [name, position, target, fovDeg = 35] of views.filter(([name]) => wanted(name))) {
      await page.evaluate(
        ({ position, target, fovDeg }) => {
          // The long-lens view is further away than the orbit limit used in the app.
          window.live.rig.controls.maxDistance = Math.max(window.live.rig.controls.maxDistance, 20);
          window.live.camera.far = Math.max(window.live.camera.far, 60);
          window.live.rig.restore({ preset: 'perspective', position, target, fovDeg });
        },
        { position, target, fovDeg },
      );
      await page.waitForTimeout(200);
      const bytes = await page.evaluate(async () =>
        Array.from(
          new Uint8Array(
            await (await window.live.exportPng({ widthPx: 1000, heightPx: 1000 })).arrayBuffer(),
          ),
        ),
      );
      fs.writeFileSync(`${out}/${p.id}-${name}.png`, Buffer.from(bytes));
    }
    if (referenceCut && wanted('directional')) {
      // Additional diagnostic lighting; ordinary captures above retain the app defaults.
      await page.evaluate(({ h, distance }) => {
        window.reviewLight = {
          position: window.live.productSoftbox.position.clone(),
          quaternion: window.live.productSoftbox.quaternion.clone(),
          intensity: window.live.productSoftbox.intensity,
          fill: window.live.productFill.intensity,
          environment: window.live.scene.environmentIntensity,
        };
        window.live.productSoftbox.position.set(-h * 1.2, h * .9, h * .45);
        window.live.productSoftbox.lookAt(0, h / 2, 0);
        window.live.productSoftbox.intensity = 6;
        window.live.productFill.intensity = .2;
        window.live.scene.environmentIntensity *= .5;
        window.live.rig.restore({ preset: 'perspective', position: [0, h / 2, distance], target: [0, h / 2, 0], fovDeg: 35 });
      }, {h, distance});
      const bytes = await page.evaluate(async () => Array.from(new Uint8Array(
        await (await window.live.exportPng({ widthPx: 1000, heightPx: 1000 })).arrayBuffer(),
      )));
      fs.writeFileSync(`${out}/${p.id}-directional.png`, Buffer.from(bytes));
      await page.evaluate(() => {
        const saved = window.reviewLight;
        window.live.productSoftbox.position.copy(saved.position);
        window.live.productSoftbox.quaternion.copy(saved.quaternion);
        window.live.productSoftbox.intensity = saved.intensity;
        window.live.productFill.intensity = saved.fill;
        window.live.scene.environmentIntensity = saved.environment;
      });
    }
    const printed = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 360;
      c.height = 280;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#184677';
      ctx.fillRect(0, 0, 360, 280);
      ctx.fillStyle = '#ffc86b';
      ctx.fillRect(12, 12, 336, 16);
      ctx.font = 'bold 52px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('STUDIO', 180, 126);
      ctx.font = '24px sans-serif';
      ctx.fillText('FRONT · 01', 180, 185);
      const src = {
        name: 'front.png',
        mimeType: 'image/png',
        dataUrl: c.toDataURL(),
        widthPx: 360,
        heightPx: 280,
      };
      window.s.source = src;
      ctx.fillStyle = '#693254';
      ctx.fillRect(0, 0, 360, 280);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText('BACK', 180, 150);
      window.s.sidePrints = {
        back: {
          source: { ...src, name: 'back.png', dataUrl: c.toDataURL() },
          layout: { mode: 'contain', scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 },
        },
      };
      await window.live.loadProject(window.s);
      return {
        meshes: window.live.mat.children.filter((m) => m.isMesh).length,
        triangles: window.live.mat.children.reduce(
          (n, m) =>
            n +
            (m.geometry
              ? (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3
              : 0),
          0,
        ),
      };
    });
    for (const side of ['front', ...(p.backPrintableArea ? ['back'] : [])].filter((side) => wanted(`printed-${side}`))) {
      const pose = side === 'back' ? views[2] : views[0];
      await page.evaluate(
        ({ position, target }) =>
          window.live.rig.restore({ preset: 'perspective', position, target, fovDeg: 35 }),
        { position: pose[1], target: pose[2] },
      );
      await page.waitForTimeout(150);
      const bytes = await page.evaluate(async () =>
        Array.from(
          new Uint8Array(
            await (await window.live.exportPng({ widthPx: 1000, heightPx: 1000 })).arrayBuffer(),
          ),
        ),
      );
      fs.writeFileSync(`${out}/${p.id}-printed-${side}.png`, Buffer.from(bytes));
    }
    report.products[p.id] = { ...printed, captureMs: Date.now() - start };
    console.log(p.id, printed);
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.live.dispose());
} finally {
  await browser.close();
}
