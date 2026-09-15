import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { createDefaultProject } from '../../src/project';
import type { ProjectState } from '../../src/contracts';
import { parseDiagnostics } from './scene-diagnostics';

export const test = base.extend<{ studio: Page }>({
  studio: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /THREE.*Shader|VALIDATE_STATUS|shader error/i.test(message.text())
      )
        errors.push(message.text());
    });
    await page.goto('/');
    await ready(page);
    // Keep actual renderer pixels, but remove changing development-only FPS text.
    await page.addStyleTag({ content: '.debug-overlay { visibility: hidden !important; }' });
    await use(page);
    expect(errors, 'Uncaught app/shader errors').toEqual([]);
  },
});
export { expect };
export const fixturePath = (name: string) => resolve('tests/fixtures', name);
export const canvas = (page: Page) => page.getByTestId('viewport').locator('canvas');
export const diagnostics = async (page: Page) =>
  parseDiagnostics(await page.getByTestId('scene-diagnostics').textContent());
export async function ready(page: Page) {
  await expect(page.getByTestId('scene-diagnostics')).toContainText(/"ready"\s*:\s*true/);
  await expect(canvas(page)).toBeVisible();
}
export async function settleCamera(page: Page) {
  let last = '';
  let stable = 0;
  await expect
    .poll(
      async () => {
        const state = await diagnostics(page);
        const position = JSON.stringify(
          [...state.cameraPosition, ...state.cameraTarget].map((value) =>
            Math.round(value * 100_000),
          ),
        );
        stable = position === last ? stable + 1 : 0;
        last = position;
        return stable;
      },
      { intervals: [300], timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(3);
}
export async function camera(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await settleCamera(page);
}
export async function importFixture(page: Page, name: string) {
  await page.getByTestId('image-input').setInputFiles(fixturePath(name));
  await expect(page.getByTestId('source-info')).toContainText(name);
  await expect(page.getByRole('status').filter({ hasText: 'Подготовка изображения' })).toHaveCount(
    0,
  );
}
export async function dropFixture(page: Page, name: string, mimeType = 'image/png') {
  const bytes = Array.from(await readFile(fixturePath(name)));
  const transfer = await page.evaluateHandle(
    ({ name, bytes, mimeType }) => {
      const value = new DataTransfer();
      value.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
      return value;
    },
    { name, bytes, mimeType },
  );
  await canvas(page).dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}
export async function encodedFixture(page: Page, mimeType: 'image/jpeg' | 'image/webp') {
  const base64 = (await readFile(fixturePath('landscape-grid.png'))).toString('base64');
  const encoded = await page.evaluate(
    async ({ base64, mimeType }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const target = document.createElement('canvas');
      target.width = image.naturalWidth;
      target.height = image.naturalHeight;
      const context = target.getContext('2d');
      if (!context) throw new Error('Fixture encoder unavailable');
      context.drawImage(image, 0, 0);
      return target.toDataURL(mimeType, 0.94).split(',')[1]!;
    },
    { base64, mimeType },
  );
  return Buffer.from(encoded, 'base64');
}
export async function setSlider(page: Page, label: string, value: number) {
  const slider = page.getByRole('slider', { name: label, exact: true });
  const step = Number(await slider.getAttribute('step')) || 1;
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const current = Number(await slider.inputValue());
  const choices = [
    { value: current, key: null },
    { value: min, key: 'Home' },
    { value: max, key: 'End' },
  ].sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value));
  const start = choices[0]!;
  await slider.focus();
  if (start.key) await slider.press(start.key);
  const count = Math.round(Math.abs(value - start.value) / step);
  for (let i = 0; i < count; i++)
    await slider.press(value > start.value ? 'ArrowRight' : 'ArrowLeft');
  await expect(slider).toHaveValue(String(value));
}
export async function loadGoldenProject(
  page: Page,
  fixture: string,
  patch: Partial<ProjectState> = {},
) {
  const bytes = await readFile(fixturePath(fixture));
  const widthPx = bytes.readUInt32BE(16),
    heightPx = bytes.readUInt32BE(20);
  const state = {
    ...createDefaultProject(patch.productId),
    ...patch,
    source: {
      name: fixture,
      mimeType: 'image/png',
      widthPx,
      heightPx,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    },
  };
  await page.getByTestId('project-input').setInputFiles({
    name: 'reference-scene.matvision',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'matvision-project', version: 1, state })),
  });
  await expect(page.getByTestId('source-info')).toContainText(fixture);
  await expect(page.locator('.statusbar')).toContainText('Проект восстановлен');
  await settleCamera(page);
}
