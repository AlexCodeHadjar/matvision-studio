/// <reference types="mocha" />
import { mkdirSync, writeFileSync } from 'node:fs';
import { browser, $, expect } from '@wdio/globals';
import { imageEvidence, changedPixelFraction, cropViewport } from '../helpers/image-evidence';
import { parseDiagnostics } from '../helpers/scene-diagnostics';

describe('Built Tauri application — first vertical slice', () => {
  it('renders the physical desk mat in a native WebView and accepts real orbit input', async () => {
    // Explicitly select the sole native window. The service then avoids optional
    // test-plugin auto-focus probes before every standard WebDriver command.
    await browser.switchToWindow(await browser.getWindowHandle());
    const canvas = $('[data-testid="viewport"] canvas');
    await canvas.waitForDisplayed();
    const isNative = await browser.execute(() => '__TAURI_INTERNALS__' in window);
    expect(isNative).toBe(true);
    const runtime = await browser.execute(async () => {
      const nativeWindow = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
          ) => Promise<{ appVersion: string; platform: string; architecture: string }>;
        };
      };
      return nativeWindow.__TAURI_INTERNALS__.invoke('runtime_info');
    });
    expect(runtime.appVersion).toBe('0.1.0');
    expect(runtime.platform).toBe(process.platform === 'win32' ? 'windows' : process.platform);
    expect(runtime.architecture).toBe('x86_64');
    await browser.waitUntil(async () => {
      const text = await $('[data-testid="scene-diagnostics"]').getProperty('textContent');
      return parseDiagnostics(String(text)).ready;
    });
    const scene = parseDiagnostics(
      String(await $('[data-testid="scene-diagnostics"]').getProperty('textContent')),
    );
    expect(scene.renderer).toBe('WebGL2');
    expect(scene.productId).toBe('deskmat-900x400');
    expect(scene.widthM).toBeCloseTo(0.9, 5);
    expect(scene.heightM).toBeCloseTo(0.4, 5);
    expect(scene.thicknessM).toBeCloseTo(0.003, 5);
    expect(scene.triangles).toBeGreaterThan(12);
    expect(scene.drawCalls).toBeGreaterThanOrEqual(2);
    expect(scene.outputColorSpace).toBe('srgb');
    expect(scene.environmentId).toBe('neutral-studio');
    mkdirSync('test-results/native', { recursive: true });
    const rect = await browser.execute(() => {
      const target = document.querySelector('[data-testid="viewport"] canvas');
      if (!target) throw new Error('Native canvas is missing');
      const bounds = target.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    const nativeWindow = Buffer.from(await browser.takeScreenshot(), 'base64');
    writeFileSync('test-results/native/vertical-slice-native-window.png', nativeWindow);
    const before = cropViewport(nativeWindow, rect);
    writeFileSync('test-results/native/vertical-slice-before-orbit.png', before);
    const pixels = imageEvidence(before);
    expect(pixels.width).toBeGreaterThan(400);
    expect(pixels.height).toBeGreaterThan(300);
    expect(pixels.uniqueColors).toBeGreaterThan(64);
    expect(pixels.luminanceVariance).toBeGreaterThan(4);
    await browser
      .action('pointer')
      .move({ origin: canvas })
      .down()
      .move({ origin: canvas, x: 120, y: 50, duration: 400 })
      .up()
      .perform();
    await browser.waitUntil(async () => {
      const current = parseDiagnostics(
        String(await $('[data-testid="scene-diagnostics"]').getProperty('textContent')),
      );
      return (
        Math.hypot(
          ...current.cameraPosition.map((value, i) => value - (scene.cameraPosition[i] ?? 0)),
        ) > 0.02
      );
    });
    const after = cropViewport(Buffer.from(await browser.takeScreenshot(), 'base64'), rect);
    writeFileSync('test-results/native/vertical-slice-after-orbit.png', after);
    expect(changedPixelFraction(before, after)).toBeGreaterThan(0.01);
    writeFileSync(
      'test-results/native/vertical-slice-evidence.json',
      JSON.stringify({ scene, pixels }, null, 2),
    );
  });
});
