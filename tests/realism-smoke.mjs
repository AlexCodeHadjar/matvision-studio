import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = process.env.MATVISION_CHECK_OUTPUT || 'work/realism-check';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [], report = { checks: {}, errors };
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
const save = (name, bytes) => fs.writeFileSync(path.join(output, name), bytes);
try {
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const { StudioScene } = await import('/src/scene/StudioScene.ts');
    const project = await import('/src/project/index.ts');
    window.projectApi = project;
    window.testState = project.createDefaultProject();
    window.testState.realism.mode = 'fast';
    window.testState.edgePreset = 'stitched';
    window.testState.placementSurface = 'white-desk';
    window.probe = new StudioScene(document.querySelector('#host'), window.testState, error => { if (error) console.error(error); });
    window.frames = (count = 3) => new Promise(resolve => {
      const tick = () => { if (--count <= 0) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    window.sourceFor = (kind) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const wave = Math.sin(x * Math.PI / 8) * Math.sin(y * Math.PI / 8);
        const value = Math.round(160 + 60 * wave);
        ctx.fillStyle = kind === 'color' ? '#f4f1ea' : kind === 'normal' ? `rgb(${128 + Math.round(wave * 24)},128,253)` : `rgb(${value},${value},${value})`;
        ctx.fillRect(x, y, 1, 1);
      }
      return { name: `${kind}.png`, mimeType: 'image/png', widthPx: 128, heightPx: 128, dataUrl: canvas.toDataURL('image/png') };
    };
  });
  await page.waitForTimeout(1500);
  async function png(name, widthPx = 1280, heightPx = 800) {
    const data = await page.evaluate(async ({ widthPx, heightPx }) => {
      const blob = await window.probe.exportPng({ widthPx, heightPx });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, { widthPx, heightPx });
    const buffer = Buffer.from(data); save(name, buffer); return PNG.sync.read(buffer);
  }
  const fast = await png('fast.png');
  await page.evaluate(async () => {
    window.testState = { ...window.testState, realism: { ...window.testState.realism, mode: 'detailed', contactShadow: 0 } };
    window.probe.update(window.testState); await window.frames(6);
  });
  const noAO = await png('detailed-no-ao.png');
  let errorSum = 0, clipped = 0;
  for (let i = 0; i < fast.data.length; i += 4) {
    for (let c = 0; c < 3; c++) errorSum += Math.abs(fast.data[i+c] - noAO.data[i+c]);
    if (noAO.data[i] >= 254 && noAO.data[i+1] >= 254 && noAO.data[i+2] >= 254) clipped++;
  }
  report.checks.color = { meanRgbDifference: errorSum / (1280 * 800 * 3), whiteClippedRatio: clipped / (1280 * 800) };
  assert.ok(report.checks.color.meanRgbDifference < 3, 'Tone mapping must match the direct renderer');
  assert.ok(report.checks.color.whiteClippedRatio < 0.01, 'No new white blowout');
  await page.evaluate(async () => {
    window.testState = { ...window.testState, realism: { ...window.testState.realism, contactShadow: 0.7 } };
    window.probe.update(window.testState); await window.frames(6);
  });
  await png('detailed.png');
  report.checks.materials = await page.evaluate(async () => {
    const s = window.probe, state = structuredClone(window.testState);
    for (const target of ['fabric', 'rubber']) for (const kind of ['color', 'normal', 'roughness', 'height']) state.materials[target].maps[kind] = window.sourceFor(kind);
    state.materials.fabric.tileMm = 10;
    state.materials.rubber.tileMm = 16;
    state.materials.fabric.normalY = 'directx';
    state.source = window.sourceFor('roughness');
    await s.loadProject(state);
    await window.frames(4);
    const before = s.source.texture, beforeMaterial = s.fabric.material.normalMap;
    const bad = structuredClone(state);
    bad.source = window.sourceFor('color');
    bad.materials.rubber.maps.height.dataUrl = 'data:image/png;base64,AQID';
    let rejected = false;
    try { await s.loadProject(bad); } catch { rejected = true; }
    const rollback = rejected && s.source.texture === before && s.fabric.material.normalMap === beforeMaterial;
    const serialized = window.projectApi.serializeProject(state);
    const parsed = window.projectApi.parseProject(serialized);
    const sourcePreserved = parsed.source.dataUrl === state.source.dataUrl;
    await s.loadProject(parsed); await window.frames(4);
    window.testState = parsed;
    const normal = s.fabric.material.normalMap;
    return { rollback, sourcePreserved, allMaps: Object.values(s.materialAssets.textures).every(m => Object.keys(m).length === 4), normalY: s.fabric.material.normalScale.y, tiling: normal.repeat.toArray(), savedBytes: new Blob([serialized]).size };
  });
  assert.ok(report.checks.materials.rollback && report.checks.materials.sourcePreserved && report.checks.materials.allMaps);
  assert.ok(report.checks.materials.normalY < 0);
  await png('imported-maps.png');
  // Restore demonstration artwork, keep all material maps, and test each deformed pose.
  await page.evaluate(async () => { window.testState.source = null; await window.probe.loadProject(window.testState); });
  for (const animation of ['corner-lift', 'soft-wave', 'table-drop', 'mat-flip', 'dual-roll', 'edge-flyby', 'moving-light', 'layer-reveal']) {
    await page.evaluate(async animation => {
      const durations = { 'corner-lift': 4200, 'soft-wave': 4200, 'table-drop': 4400, 'mat-flip': 5600, 'dual-roll': 5600, 'edge-flyby': 6500, 'moving-light': 5200, 'layer-reveal': 4800 };
      window.probe.playShowcase(animation);
      window.probe.showcase.start = performance.now() - durations[animation] * 0.42;
      await window.frames(3);
    }, animation);
    await png(`animation-${animation}.png`);
    const pose = await page.evaluate(async () => {
      let finite = true;
      window.probe.mat.traverse(object => {
        const values = object.geometry?.attributes.position?.array;
        if (values && !values.every(Number.isFinite)) finite = false;
      });
      window.probe.stopShowcase(); await window.frames();
      return { finite, restored: window.probe.getDiagnostics().showcase === null };
    });
    assert.ok(pose.finite && pose.restored, animation);
  }
  report.checks.animations = 8;
  await page.evaluate(async () => {
    window.testState.materials = window.projectApi.createDefaultProject().materials;
    await window.probe.loadProject(window.testState);
    window.probe.setCameraPreset('macro');
  });
  await page.waitForTimeout(1200);
  await png('macro.png');
  report.checks.macro = await page.evaluate(() => window.probe.camera.position.y > window.testState.thicknessMm / 1000);
  assert.ok(report.checks.macro);
  report.checks.lifetime = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      window.testState = { ...window.testState, realism: { ...window.testState.realism, mode: 'fast' } };
      window.probe.update(window.testState);
      await window.probe.setMaterialAssets(window.testState.materials);
      window.probe.update(window.testState); await window.frames(4);
      window.testState = { ...window.testState, realism: { ...window.testState.realism, mode: 'detailed' } };
      window.probe.update(window.testState); await window.frames(4);
      samples.push(window.probe.getDiagnostics());
    }
    return samples.map(s => ({ textures: s.textures, geometries: s.geometries, programs: s.programs }));
  });
  assert.ok(report.checks.lifetime.at(-1).textures <= report.checks.lifetime[1].textures + 1, 'Texture leak after switching');
  assert.ok(report.checks.lifetime.at(-1).geometries <= report.checks.lifetime[1].geometries + 1, 'Geometry leak after switching');
  const large = await png('export-4k.png', 3840, 2400);
  assert.equal(large.width, 3840); assert.equal(large.height, 2400);
  report.checks.export4k = true;
  report.checks.restoreSize = await page.evaluate(() => window.probe.renderer.domElement.width === 1280 && window.probe.renderer.domElement.height === 800);
  assert.ok(report.checks.restoreSize);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.probe.dispose());
  console.log(JSON.stringify(report));
} finally {
  save('checks.json', JSON.stringify(report, null, 2));
  await browser.close();
}
