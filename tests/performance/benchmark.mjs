/** Hardware benchmark: run against a settled Vite server, without SwiftShader flags.
 * PLAYWRIGHT_BROWSERS_PATH must name the pinned Chromium install when not in default cache.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';

const baseURL = process.env.MATVISION_BENCH_URL ?? 'http://127.0.0.1:1420';
const durationMs = Number(process.env.MATVISION_BENCH_MS ?? 30_000);
if (!Number.isFinite(durationMs) || durationMs < 10_000 || durationMs > 60_000)
  throw new Error('Steady sample duration must be 10000–60000 ms.');
const outputDirectory = path.resolve('docs/performance');
await mkdir(outputDirectory, { recursive: true });
const fixture = new PNG({ width: 4096, height: 2048 });
for (let y = 0; y < fixture.height; y++) {
  for (let x = 0; x < fixture.width; x++) {
    const offset = (y * fixture.width + x) * 4;
    const checker = ((x >> 7) + (y >> 7)) % 2;
    fixture.data[offset] = checker ? 210 : 30;
    fixture.data[offset + 1] = Math.round((x / 4095) * 255);
    fixture.data[offset + 2] = Math.round((y / 2047) * 255);
    fixture.data[offset + 3] = 255;
  }
}
const image4K = PNG.sync.write(fixture);
const image8K = await readFile('tests/fixtures/high-resolution-grid.png');
const errors = [];
const browser = await chromium.launch({
  headless: false,
  channel: 'chromium',
  args: ['--enable-precise-memory-info'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'en-US',
});
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const browserSession = await browser.newBrowserCDPSession();
const systemInfo = await browserSession.send('SystemInfo.getInfo');
const report = {
  timestamp: new Date().toISOString(),
  methodology: {
    runner: 'Headful Playwright Chromium, production scene through the real application UI',
    url: baseURL,
    durationMs,
    warmupMs: 5000,
    launchArgs: ['--enable-precise-memory-info'],
    viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    frameTime: 'requestAnimationFrame intervals; renderer frameCount cross-checked',
    memory:
      'JS heap is Chromium performance.memory; texture bytes are estimated owned texture storage, not GPU VRAM',
  },
  environment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    hostRamBytes: os.totalmem(),
    browser: browser.version(),
    gpu: systemInfo.gpu,
  },
  samples: [],
  replacements: [],
  errors,
};

function quantile(sorted, fraction) {
  const at = (sorted.length - 1) * fraction;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}

async function diagnostics() {
  return JSON.parse(await page.getByTestId('scene-diagnostics').textContent());
}

async function settle() {
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="scene-diagnostics"]')?.textContent;
    return text && JSON.parse(text).ready && !document.querySelector('.busy-indicator');
  });
  await page.waitForTimeout(750);
}

async function upload(bytes, name, width, height) {
  const start = performance.now();
  await page
    .getByTestId('image-input')
    .setInputFiles({ name, mimeType: 'image/png', buffer: bytes });
  await page.getByTestId('source-info').getByText(name, { exact: true }).waitFor();
  await page.waitForFunction(
    ({ width, height }) => {
      const text = document.querySelector('[data-testid="scene-diagnostics"]')?.textContent;
      if (!text) return false;
      const value = JSON.parse(text);
      return value.sourceWidthPx === width && value.sourceHeightPx === height;
    },
    { width, height },
  );
  const readyMs = performance.now() - start;
  await settle();
  return { name, readyMs, diagnostics: await diagnostics() };
}

async function quality(value) {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('combobox', { name: 'Качество viewport', exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  await settle();
}

async function sample(label) {
  await page.bringToFront();
  await page.waitForTimeout(5000);
  const start = await diagnostics();
  const raw = await page.evaluate(
    (sampleMs) =>
      new Promise((resolve, reject) => {
        if (document.visibilityState !== 'visible' || !document.hasFocus()) {
          reject(new Error('Benchmark requires a visible, focused foreground page.'));
          return;
        }
        let began = 0;
        let previous = 0;
        let visibilityChanges = 0;
        let focusLosses = 0;
        const frames = [];
        const visibility = () => visibilityChanges++;
        const blur = () => focusLosses++;
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('blur', blur);
        function frame(now) {
          if (!began) began = now;
          if (previous) frames.push(now - previous);
          previous = now;
          if (now - began < sampleMs) requestAnimationFrame(frame);
          else {
            document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('blur', blur);
            resolve({
              elapsedMs: now - began,
              frames,
              visibilityChanges,
              focusLosses,
              focusedAtEnd: document.hasFocus(),
              visibilityAtEnd: document.visibilityState,
              jsHeap: performance.memory
                ? {
                    usedBytes: performance.memory.usedJSHeapSize,
                    totalBytes: performance.memory.totalJSHeapSize,
                    limitBytes: performance.memory.jsHeapSizeLimit,
                  }
                : null,
            });
          }
        }
        requestAnimationFrame(frame);
      }),
    durationMs,
  );
  const end = await diagnostics();
  const sorted = [...raw.frames].sort((a, b) => a - b);
  const result = {
    label,
    elapsedMs: raw.elapsedMs,
    observedFrames: raw.frames.length,
    renderedFrames: end.frameCount - start.frameCount,
    fps: (raw.frames.length * 1000) / raw.elapsedMs,
    frameP50Ms: quantile(sorted, 0.5),
    frameP95Ms: quantile(sorted, 0.95),
    frameP99Ms: quantile(sorted, 0.99),
    maxFrameMs: sorted.at(-1),
    framesOver50Ms: sorted.filter((value) => value > 50).length,
    visibilityChanges: raw.visibilityChanges,
    focusLosses: raw.focusLosses,
    focusedAtEnd: raw.focusedAtEnd,
    visibilityAtEnd: raw.visibilityAtEnd,
    jsHeap: raw.jsHeap,
    diagnostics: end,
  };
  if (
    result.visibilityChanges !== 0 ||
    result.focusLosses !== 0 ||
    !result.focusedAtEnd ||
    result.visibilityAtEnd !== 'visible'
  )
    throw new Error(`Foreground requirement violated for ${label}.`);
  if (result.renderedFrames < result.observedFrames * 0.9)
    throw new Error(`Renderer stalled despite browser RAF for ${label}.`);
  report.samples.push(result);
  console.log(
    JSON.stringify({
      sample: label,
      fps: result.fps,
      p95: result.frameP95Ms,
      textures: end.textures,
    }),
  );
  await writeFile(
    path.join(outputDirectory, 'hardware-benchmark.json'),
    JSON.stringify(report, null, 2),
  );
}

try {
  await page.goto(baseURL);
  await settle();
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('[data-testid="viewport"] canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      unmaskedRendererAvailable: Boolean(debug),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      version: gl.getParameter(gl.VERSION),
    };
  });
  report.environment.activeWebGL = gpu;
  console.log(JSON.stringify({ activeWebGL: gpu }));
  if (!gpu.unmaskedRendererAvailable)
    throw new Error('The active hardware adapter could not be identified.');
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu.renderer))
    throw new Error('Software renderer cannot produce hardware acceptance evidence.');
  await upload(image4K, 'benchmark-4k.png', 4096, 2048);
  await sample('4K source · Balanced · perspective');
  await upload(image8K, 'benchmark-8k.png', 8192, 4096);
  await sample('8K source · Balanced · downsampled preview');
  for (const preset of ['low', 'high', 'ultra']) {
    await quality(preset);
    await sample(`8K source · ${preset} · perspective`);
  }
  await quality('balanced');
  await page.getByLabel('Turntable · вращать коврик').check();
  await sample('8K source · Balanced · turntable');
  await page.getByLabel('Turntable · вращать коврик').uncheck();
  await page.getByRole('combobox', { name: 'Край', exact: true }).selectOption('stitched');
  await page.getByLabel('Линейка · реальный масштаб').check();
  await settle();
  report.replacementBaseline = await diagnostics();
  for (let index = 0; index < 12; index++) {
    const large = index % 2 === 1;
    const result = await upload(
      large ? image8K : image4K,
      `replacement-${index + 1}.png`,
      large ? 8192 : 4096,
      large ? 4096 : 2048,
    );
    report.replacements.push(result);
    console.log(
      JSON.stringify({
        replacement: index + 1,
        readyMs: result.readyMs,
        textures: result.diagnostics.textures,
      }),
    );
  }
  const counts = report.replacements.map((entry) => entry.diagnostics.textures);
  report.boundedTextureCounts = new Set(counts).size === 1;
  if (!report.boundedTextureCounts)
    throw new Error(`Texture count failed to plateau: ${counts.join(', ')}`);
  for (const entry of report.replacements) {
    if (entry.diagnostics.previewWidthPx > 4096 || entry.diagnostics.previewHeightPx > 4096)
      throw new Error('Balanced preview exceeded 4096-pixel bound.');
  }
  report.status = errors.length === 0 ? 'PASS' : 'FAIL';
  await page
    .getByTestId('viewport')
    .locator('canvas')
    .screenshot({ path: path.join(outputDirectory, 'hardware-benchmark-viewport.png') });
} catch (error) {
  report.status = 'FAIL';
  report.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await writeFile(
    path.join(outputDirectory, 'hardware-benchmark.json'),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
