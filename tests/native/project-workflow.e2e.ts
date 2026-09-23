/// <reference types="mocha" />
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { browser, $, expect } from '@wdio/globals';
import { PNG } from 'pngjs';
import { imageEvidence } from '../helpers/image-evidence';
import { parseDiagnostics } from '../helpers/scene-diagnostics';

const executeFile = promisify(execFile);
async function nativeDialog(
  path: string,
  action: 'Open' | 'Save',
  trigger: () => Promise<unknown>,
) {
  const dialog = executeFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('tests/native/file-dialog.ps1'),
      '-Path',
      path,
      '-Action',
      action,
    ],
    { windowsHide: true, timeout: 35_000 },
  );
  await trigger();
  try {
    await dialog;
  } catch (error) {
    console.error('Native dialog UI Automation output:', (error as { stdout?: string }).stdout);
    await browser.saveScreenshot(resolve('test-results/native/dialog-failure.png'));
    throw error;
  }
}
async function scene() {
  return parseDiagnostics(
    String(await $('[data-testid="scene-diagnostics"]').getProperty('textContent')),
  );
}
async function waitForSavedFile(path: string) {
  await browser.waitUntil(
    async () => {
      try {
        return (await stat(path)).size > 100;
      } catch {
        return false;
      }
    },
    { timeout: 20_000, timeoutMsg: `Native save did not create ${path}` },
  );
}

describe('Native full project workflow', () => {
  it('uses real Windows dialogs to import, save, close/relaunch, restore and export', async function () {
    this.timeout(180_000);
    await browser.switchToWindow(await browser.getWindowHandle());
    await $('[data-testid="viewport"] canvas').waitForDisplayed();
    const directory = resolve('test-results/native', `Проверка проекта ${Date.now()}`);
    await mkdir(directory, { recursive: true });
    const projectPath = resolve(directory, 'Мой проект с пробелами.matvision');
    const exportPath = resolve(directory, 'Предпросмотр коврика.png');
    const imageName = 'Рисунок с пробелами.png';
    const imagePath = resolve(directory, imageName);
    await copyFile(resolve('tests/fixtures', 'landscape-grid.png'), imagePath);
    await nativeDialog(imagePath, 'Open', () => $('button*=Изображение').click());
    await browser.waitUntil(async () =>
      (await $('[data-testid="source-info"]').getText()).includes(imageName),
    );
    await $('[aria-label="Продукт"]').selectByAttribute('value', 'mousepad-400x450');
    await $('[aria-label="Размещение"]').selectByAttribute('value', 'contain');
    await $('[aria-label="Край"]').selectByAttribute('value', 'stitched');
    await $('button=Сверху').click();
    await browser.waitUntil(async () => (await scene()).cameraPreset === 'top');
    await nativeDialog(projectPath, 'Save', () => $('button=Сохранить проект').click());
    await waitForSavedFile(projectPath);
    expect((await stat(projectPath)).size).toBeGreaterThan(1000);
    const saved = JSON.parse(await readFile(projectPath, 'utf8')) as {
      state: {
        productId: string;
        source: { widthPx: number };
        layout: { mode: string };
        edgePreset: string;
      };
    };
    expect(saved.state.productId).toBe('mousepad-400x450');
    expect(saved.state.layout.mode).toBe('contain');
    expect(saved.state.source.widthPx).toBe(1800);
    expect(saved.state.edgePreset).toBe('stitched');
    // New WebDriver session closes the original process and launches the built app again.
    await browser.reloadSession();
    await browser.switchToWindow(await browser.getWindowHandle());
    await $('[data-testid="viewport"] canvas').waitForDisplayed();
    await nativeDialog(projectPath, 'Open', () => $('[aria-label="Открыть проект"]').click());
    await browser.waitUntil(async () => (await scene()).productId === 'mousepad-400x450');
    expect(await $('[aria-label="Размещение"]').getValue()).toBe('contain');
    expect(await $('[aria-label="Край"]').getValue()).toBe('stitched');
    expect(await $('[data-testid="source-info"]').getText()).toContain(imageName);
    expect((await scene()).sourceWidthPx).toBe(1800);
    await nativeDialog(exportPath, 'Save', () => $('button=Экспорт PNG').click());
    await waitForSavedFile(exportPath);
    const image = await readFile(exportPath);
    const png = PNG.sync.read(image);
    expect(png.width).toBeGreaterThan(400);
    expect(png.height).toBeGreaterThan(300);
    expect(imageEvidence(image).luminanceVariance).toBeGreaterThan(20);
    await browser.saveScreenshot(resolve(directory, 'native-restored-project.png'));
  });
});
