import { chromium } from '@playwright/test';
import fs from 'node:fs';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const p = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
fs.mkdirSync('work/garment-review/diagnostics', { recursive: true });
await p.goto('http://127.0.0.1:1420/tests/realism-probe.html');
for (let retry = 0; ; retry++) {
  try {
    await p.evaluate(async () => {
      const { StudioScene } = await import('/src/scene/StudioScene.ts');
      const { createDefaultProject } = await import('/src/project/index.ts');
      const s = createDefaultProject('tshirt-bella-3001');
      window.live = new StudioScene(document.querySelector('#host'), s, console.error);
      await live.loadProject(s);
      live.rig.restore({
        preset: 'perspective',
        position: [0.12, -0.4, 0.09],
        target: [0, 0.09, 0],
        fovDeg: 35,
      });
    });
    break;
  } catch (e) {
    if (retry >= 2 || !String(e).includes('Execution context was destroyed')) throw e;
    await p.waitForTimeout(700);
  }
}
const shoot = async (name) => {
  await p.waitForTimeout(250);
  const b = await p.evaluate(async () =>
    Array.from(
      new Uint8Array(await (await live.exportPng({ widthPx: 1000, heightPx: 1000 })).arrayBuffer()),
    ),
  );
  fs.writeFileSync(`work/garment-review/diagnostics/${name}.png`, Buffer.from(b));
};
await shoot('base');
console.log(await p.evaluate(() => live.mat.children.map((m) => m.name)));
await p.evaluate(() => {
  for (const m of live.mat.children)
    if (m.name.includes('needle') || m.name.includes('Folded cuffs')) m.visible = false;
});
await shoot('no-stitches');
await p.evaluate(() => {
  for (const m of live.mat.children) m.receiveShadow = false;
});
await shoot('no-shadow');
await p.evaluate(() => live.pipeline.configure(false, 0));
await shoot('no-ao');
await p.evaluate(() => {
  for (const m of live.mat.children) if (m.name.startsWith('Cotton ')) m.visible = false;
});
await shoot('inner-only');
await p.evaluate(() => {
  for (const m of live.mat.children)
    if (m.material) {
      m.material.normalMap = null;
      m.material.aoMap = null;
      m.material.needsUpdate = true;
    }
});
await shoot('no-normal');
console.log(
  JSON.stringify(
    await p.evaluate(async () => {
      const Vector3 = live.mat.position.constructor;
      return live.mat.children
        .filter((m) => m.isMesh)
        .map((m) => {
          const g = m.geometry,
            p = g.attributes.position,
            n = g.attributes.normal,
            ix = g.index;
          let reversed = 0;
          const locations = [];
          for (let j = 0; j < (ix ? ix.count : p.count); j += 3) {
            const ids = [0, 1, 2].map((k) => (ix ? ix.getX(j + k) : j + k));
            const [a, b, c] = ids.map((i) => new Vector3().fromBufferAttribute(p, i));
            const geometric = b.clone().sub(a).cross(c.clone().sub(a));
            const average = ids.reduce(
              (v, i) => v.add(new Vector3().fromBufferAttribute(n, i)),
              new Vector3(),
            );
            if (geometric.dot(average) < -1e-14) {
              reversed++;
              if (locations.length < 8)
                locations.push({
                  p: a.toArray(),
                  geom: geometric.normalize().toArray(),
                  normal: average.normalize().toArray(),
                });
            }
          }
          return { name: m.name, reversed, locations };
        });
    }),
    null,
    2,
  ),
);
await p.evaluate(() => live.dispose());
await browser.close();
