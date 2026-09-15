import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import {
  test,
  expect,
  camera,
  canvas,
  diagnostics,
  importFixture,
  ready,
  setSlider,
  settleCamera,
} from '../helpers/studio';
import { changedPixelFraction, imageEvidence } from '../helpers/image-evidence';

test.describe('Persistence and export @E', () => {
  test('save close reopen restores the embedded original and scene choices', async ({
    studio: page,
  }, info) => {
    await importFixture(page, 'portrait-grid.png');
    await page
      .getByRole('combobox', { name: 'Продукт', exact: true })
      .selectOption('mousepad-400x450');
    await page.getByRole('combobox', { name: 'Размещение', exact: true }).selectOption('contain');
    await page
      .getByRole('combobox', { name: 'Материал', exact: true })
      .selectOption('gaming-fabric');
    await page.getByRole('combobox', { name: 'Край', exact: true }).selectOption('stitched');
    await page.getByRole('combobox', { name: 'Освещение', exact: true }).selectOption('warm-room');
    await setSlider(page, 'Поворот', 12);
    await setSlider(page, 'Сдвиг X', 0.1);
    await camera(page, 'Сверху');
    await expect(page.getByTestId('source-info')).toContainText('portrait-grid.png');
    const before = await canvas(page).screenshot();
    const downloadPromise = page.waitForEvent('download');
    // Global save remains usable when a range has focus.
    await page.getByRole('slider', { name: 'Масштаб', exact: true }).focus();
    await page.keyboard.press('Control+s');
    const download = await downloadPromise;
    const savedPath = info.outputPath('Проект с пробелами.matvision');
    await download.saveAs(savedPath);
    const contents = await readFile(savedPath, 'utf8');
    const document = JSON.parse(contents) as {
      format: string;
      version: number;
      state: {
        source: { dataUrl: string; widthPx: number; heightPx: number };
        productId: string;
        layout: { rotationDeg: number };
      };
    };
    expect(document.format).toBe('matvision-project');
    expect(document.version).toBe(1);
    expect(document.state.source.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(document.state.source.widthPx).toBe(600);
    expect(document.state.source.heightPx).toBe(1200);
    expect(document.state.productId).toBe('mousepad-400x450');
    expect(document.state.layout.rotationDeg).toBe(12);
    const context = page.context();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/');
    await ready(reopened);
    await reopened.addStyleTag({ content: '.debug-overlay { visibility: hidden !important; }' });
    await reopened.getByTestId('project-input').setInputFiles(savedPath);
    await expect(reopened.getByTestId('source-info')).toContainText('portrait-grid.png');
    await settleCamera(reopened);
    for (const [label, value] of [
      ['Продукт', 'mousepad-400x450'],
      ['Размещение', 'contain'],
      ['Материал', 'gaming-fabric'],
      ['Край', 'stitched'],
      ['Освещение', 'warm-room'],
    ] as const)
      await expect(reopened.getByRole('combobox', { name: label, exact: true })).toHaveValue(value);
    await expect(reopened.getByRole('slider', { name: 'Поворот', exact: true })).toHaveValue('12');
    expect(changedPixelFraction(before, await canvas(reopened).screenshot())).toBeLessThan(0.02);
    await info.attach('saved-project', {
      body: Buffer.from(contents),
      contentType: 'application/json',
    });
  });

  test('screen and 3840px PNG exports have real image pixels and restore viewport dimensions', async ({
    studio: page,
  }, info) => {
    test.setTimeout(150_000);
    await importFixture(page, 'uv-circle.png');
    await camera(page, 'Сверху');
    const initial = await diagnostics(page);
    for (const preset of ['screen', 'high']) {
      await page
        .getByRole('combobox', { name: 'Разрешение PNG', exact: true })
        .selectOption(preset);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click();
      const download = await pending;
      const path = info.outputPath(`export-${preset}.png`);
      await download.saveAs(path);
      const bytes = await readFile(path);
      const image = PNG.sync.read(bytes);
      if (preset === 'screen') {
        expect(image.width).toBe(initial.rendererWidthPx);
        expect(image.height).toBe(initial.rendererHeightPx);
      } else expect(Math.max(image.width, image.height)).toBe(3840);
      expect(imageEvidence(bytes).luminanceVariance).toBeGreaterThan(50);
      // An exported top margin is studio background, with no viewport-label text.
      let darkest = 255;
      for (let y = 8; y < 50; y++)
        for (let x = 15; x < 270; x++)
          darkest = Math.min(darkest, image.data[(y * image.width + x) * 4] ?? 0);
      expect(darkest).toBeGreaterThan(100);
      await expect
        .poll(async () => (await diagnostics(page)).rendererWidthPx)
        .toBe(initial.rendererWidthPx);
      await expect
        .poll(async () => (await diagnostics(page)).rendererHeightPx)
        .toBe(initial.rendererHeightPx);
      await info.attach(`actual-export-${preset}`, { body: bytes, contentType: 'image/png' });
    }
  });

  test('invalid project errors preserve the current artwork', async ({ studio: page }) => {
    await importFixture(page, 'landscape-grid.png');
    await page.getByTestId('project-input').setInputFiles({
      name: 'invalid.matvision',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"matvision-project","version":999}'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('source-info')).toContainText('landscape-grid.png');
  });

  test('settings trap focus, Escape restores it, and H toggles the UI from a range', async ({
    studio: page,
  }) => {
    const trigger = page.getByRole('button', { name: 'Настройки', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.getByRole('slider', { name: 'Масштаб', exact: true }).focus();
    await page.keyboard.press('h');
    await expect(
      page.getByRole('button', { name: 'Показать интерфейс', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('h');
    await expect(trigger).toBeVisible();
    await page.keyboard.press('F1');
    await expect(page.getByRole('dialog')).toContainText('DPI');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
