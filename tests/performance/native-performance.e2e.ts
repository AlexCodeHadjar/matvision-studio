/// <reference types="mocha" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import os from 'node:os';
import { browser, $, expect } from '@wdio/globals';
import { PNG } from 'pngjs';

interface Measurements {
  ready: boolean;
  frameCount: number;
  sourceWidthPx: number;
  sourceHeightPx: number;
  previewWidthPx: number;
  previewHeightPx: number;
  textures: number;
  geometries: number;
  programs: number;
  approximateTextureBytes: number;
  rendererWidthPx: number;
  rendererHeightPx: number;
}

interface FrameSample {
  elapsedMs: number;
  frames: number[];
  visibilityChanges: number;
  focusLosses: number;
  visibilityAtStart: string;
  focusedAtStart: boolean;
  visibilityAtEnd: string;
  focusedAtEnd: boolean;
}

function percentile(sorted: number[], value: number): number {
  const index = (sorted.length - 1) * value;
  return (
    sorted[Math.floor(index)]! +
    (sorted[Math.ceil(index)]! - sorted[Math.floor(index)]!) * (index - Math.floor(index))
  );
}

async function diagnostics(): Promise<Measurements> {
  return JSON.parse(
    String(await $('[data-testid="scene-diagnostics"]').getProperty('textContent')),
  ) as Measurements;
}

async function drop(bytes: Buffer, name: string, widthPx: number, heightPx: number) {
  const began = performance.now();
  await browser.execute(
    (base64, filename) => {
      const decoded = atob(base64);
      const data = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) data[i] = decoded.charCodeAt(i);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], filename, { type: 'image/png' }));
      document
        .querySelector('.viewport-wrap')!
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
    },
    bytes.toString('base64'),
    name,
  );
  await browser.waitUntil(
    async () => {
      const current = await diagnostics();
      const text = String(await $('[data-testid="source-info"]').getProperty('textContent'));
      return (
        text.includes(name) &&
        current.sourceWidthPx === widthPx &&
        current.sourceHeightPx === heightPx
      );
    },
    { timeout: 30_000, timeoutMsg: `Native artwork ${name} did not finish importing` },
  );
  const readyMs = performance.now() - began;
  await browser.pause(750);
  return { name, readyMs, diagnostics: await diagnostics() };
}

async function sample(label: string) {
  await browser.switchToWindow(await browser.getWindowHandle());
  await $('[data-testid="viewport"] canvas').click();
  await browser.waitUntil(() => browser.execute(() => document.hasFocus()), {
    timeout: 5000,
    timeoutMsg: 'Native WebView must have focus before beginning a performance sample',
  });
  await browser.pause(5000);
  const before = await diagnostics();
  const raw = await browser.executeAsync((done: (value: FrameSample) => void) => {
    const result: FrameSample = {
      elapsedMs: 0,
      frames: [],
      visibilityChanges: 0,
      focusLosses: 0,
      visibilityAtStart: document.visibilityState,
      focusedAtStart: document.hasFocus(),
      visibilityAtEnd: '',
      focusedAtEnd: false,
    };
    let began = 0;
    let previous = 0;
    const visibility = () => result.visibilityChanges++;
    const blur = () => result.focusLosses++;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    function frame(now: number) {
      if (!began) began = now;
      if (previous) result.frames.push(now - previous);
      previous = now;
      if (now - began < 30_000) requestAnimationFrame(frame);
      else {
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('blur', blur);
        result.elapsedMs = now - began;
        result.visibilityAtEnd = document.visibilityState;
        result.focusedAtEnd = document.hasFocus();
        done(result);
      }
    }
    requestAnimationFrame(frame);
  });
  const after = await diagnostics();
  const sorted = [...raw.frames].sort((a, b) => a - b);
  expect(raw.visibilityAtStart).toBe('visible');
  expect(raw.visibilityAtEnd).toBe('visible');
  expect(raw.focusedAtStart).toBe(true);
  expect(raw.focusedAtEnd).toBe(true);
  expect(raw.visibilityChanges).toBe(0);
  expect(raw.focusLosses).toBe(0);
  expect(after.frameCount - before.frameCount).toBeGreaterThan(raw.frames.length * 0.9);
  const result = {
    label,
    elapsedMs: raw.elapsedMs,
    observedFrames: raw.frames.length,
    renderedFrames: after.frameCount - before.frameCount,
    fps: (raw.frames.length * 1000) / raw.elapsedMs,
    frameP50Ms: percentile(sorted, 0.5),
    frameP95Ms: percentile(sorted, 0.95),
    frameP99Ms: percentile(sorted, 0.99),
    maxFrameMs: sorted.at(-1),
    framesOver50Ms: sorted.filter((value) => value > 50).length,
    visibilityChanges: raw.visibilityChanges,
    focusLosses: raw.focusLosses,
    focusedAtEnd: raw.focusedAtEnd,
    diagnostics: after,
    jsHeap: await browser.execute(() => {
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      return memory
        ? {
            usedBytes: memory.usedJSHeapSize,
            totalBytes: memory.totalJSHeapSize,
            limitBytes: memory.jsHeapSizeLimit,
          }
        : null;
    }),
  };
  console.log(JSON.stringify({ sample: label, fps: result.fps, frameP95Ms: result.frameP95Ms }));
  return result;
}

describe('Production Tauri performance — foreground hardware WebView2', () => {
  it('records steady 4K and 8K frame pacing and bounded repeated uploads', async () => {
    await browser.switchToWindow(await browser.getWindowHandle());
    await browser.setTimeout({ script: 60_000 });
    await $('[data-testid="viewport"] canvas').waitForDisplayed();
    await browser.waitUntil(async () => (await diagnostics()).ready);
    const native = await browser.execute(() => '__TAURI_INTERNALS__' in window);
    expect(native).toBe(true);
    const activeWebGL = await browser.execute(() => {
      const gl = document
        .querySelector<HTMLCanvasElement>('[data-testid="viewport"] canvas')!
        .getContext('webgl2')!;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        unmaskedRendererAvailable: Boolean(debug),
        vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
        maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
        userAgent: navigator.userAgent,
        devicePixelRatio: devicePixelRatio,
        windowWidth: innerWidth,
        windowHeight: innerHeight,
      };
    });
    expect(activeWebGL.unmaskedRendererAvailable).toBe(true);
    expect(activeWebGL.renderer).not.toMatch(/swiftshader|llvmpipe|software|basic render/i);
    console.log(JSON.stringify({ activeWebGL }));
    const source8K = readFileSync('tests/fixtures/high-resolution-grid.png');
    const decoded = PNG.sync.read(source8K);
    const reduced = new PNG({ width: 4096, height: 2048 });
    for (let y = 0; y < reduced.height; y++) {
      for (let x = 0; x < reduced.width; x++) {
        const from = (y * 2 * decoded.width + x * 2) * 4;
        reduced.data.set(decoded.data.subarray(from, from + 4), (y * reduced.width + x) * 4);
      }
    }
    const source4K = PNG.sync.write(reduced);
    const binaryPath = resolve(
      process.env.MATVISION_BINARY ?? 'src-tauri/target/release/matvision-studio.exe',
    );
    const report = {
      timestamp: new Date().toISOString(),
      runner: 'Built production Tauri executable through native WebdriverIO/WebView2',
      binarySha256: createHash('sha256').update(readFileSync(binaryPath)).digest('hex'),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      hostRamBytes: os.totalmem(),
      activeWebGL,
      methodology:
        '30-second foreground RAF samples after 5-second warmups; renderer frames cross-checked. Texture bytes are estimates, not driver VRAM.',
      samples: [] as Awaited<ReturnType<typeof sample>>[],
      replacements: [] as Awaited<ReturnType<typeof drop>>[],
      boundedTextureCounts: false,
      status: 'RUNNING',
    };
    mkdirSync('docs/performance', { recursive: true });
    const save = () =>
      writeFileSync('docs/performance/native-benchmark.json', JSON.stringify(report, null, 2));
    try {
      await drop(source4K, 'native-benchmark-4k.png', 4096, 2048);
      report.samples.push(await sample('4K source · Balanced · perspective'));
      save();
      await drop(source8K, 'native-benchmark-8k.png', 8192, 4096);
      report.samples.push(await sample('8K source · Balanced · downsampled preview'));
      save();
      const presets = ['low', 'high', 'ultra'];
      for (const preset of presets) {
        await $('button[aria-label="Настройки"]').click();
        await $('select[aria-label="Качество viewport"]').selectByAttribute('value', preset);
        await $('button[aria-label="Закрыть настройки"]').click();
        report.samples.push(await sample(`8K source · ${preset} · perspective`));
        save();
      }
      await $('button[aria-label="Настройки"]').click();
      await $('select[aria-label="Качество viewport"]').selectByAttribute('value', 'balanced');
      await $('button[aria-label="Закрыть настройки"]').click();
      for (let index = 0; index < 12; index++) {
        const large = index % 2 === 1;
        report.replacements.push(
          await drop(
            large ? source8K : source4K,
            `native-replacement-${index + 1}.png`,
            large ? 8192 : 4096,
            large ? 4096 : 2048,
          ),
        );
      }
      report.boundedTextureCounts =
        new Set(report.replacements.map((value) => value.diagnostics.textures)).size === 1;
      expect(report.boundedTextureCounts).toBe(true);
      for (const value of report.replacements) expect(value.diagnostics.previewWidthPx).toBe(4096);
      report.status = 'PASS';
      await browser.saveScreenshot('docs/performance/native-benchmark-window.png');
    } catch (error) {
      report.status = 'FAIL';
      throw error;
    } finally {
      save();
    }
  });
});
