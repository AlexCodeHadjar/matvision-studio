import {
  test,
  expect,
  camera,
  canvas,
  diagnostics,
  dropFixture,
  fixturePath,
  encodedFixture,
  importFixture,
  setSlider,
} from '../helpers/studio';
import { changedPixelFraction } from '../helpers/image-evidence';
import { redCircleBounds } from '../helpers/pixel-probes';

test.describe('Checkpoint B @B', () => {
  test('a late decoded import cannot replace committed pixels after a newer corrupt file', async ({
    studio: page,
  }) => {
    await importFixture(page, 'uv-circle.png');
    await camera(page, 'Сверху');
    const before = await canvas(page).screenshot();
    // Hold the real GPU-preview decode, after metadata/validation succeeded.
    // This controls scheduling only: the original decoder and real pixels remain in use.
    const gate = await page.evaluateHandle(() => {
      const original = window.createImageBitmap;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const state = {
        started: false,
        release,
        restore: () => {
          window.createImageBitmap = original;
        },
      };
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        const bitmap = await original(...args);
        const options = args[1] as ImageBitmapOptions | undefined;
        if (!state.started && (options?.resizeWidth ?? 0) > 64) {
          state.started = true;
          await pending;
        }
        return bitmap;
      }) as typeof createImageBitmap;
      return state;
    });
    try {
      await page.getByTestId('image-input').setInputFiles(fixturePath('square-rgb.png'));
      await expect.poll(() => gate.evaluate((state) => state.started)).toBe(true);
      await page.getByTestId('image-input').setInputFiles({
        name: 'later-corrupt.png',
        mimeType: 'image/png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      });
      await expect(page.getByRole('alert')).toBeVisible();
      const frame = (await diagnostics(page)).frameCount;
      await gate.evaluate((state) => state.release());
      await expect
        .poll(async () => (await diagnostics(page)).frameCount)
        .toBeGreaterThan(frame + 3);
      await expect(page.getByTestId('source-info')).toContainText('uv-circle.png');
      expect((await diagnostics(page)).sourceWidthPx).toBe(1800);
      await page.getByRole('button', { name: 'Закрыть сообщение', exact: true }).click();
      expect(changedPixelFraction(before, await canvas(page).screenshot())).toBeLessThan(0.005);
    } finally {
      await gate.evaluate((state) => {
        state.release();
        state.restore();
      });
      await gate.dispose();
    }
  });
  test('a real PNG drop applies original pixels and keeps them across products', async ({
    studio: page,
  }) => {
    await dropFixture(page, 'landscape-grid.png');
    await expect(page.getByTestId('source-info')).toContainText('landscape-grid.png');
    await expect(page.getByTestId('source-info')).toContainText('1800 × 800');
    await expect(page.getByRole('combobox', { name: 'Размещение', exact: true })).toHaveValue(
      'cover',
    );
    await expect(page.getByTestId('print-quality')).toContainText('51 DPI');
    for (const id of ['mousepad-400x450', 'deskmat-900x400']) {
      await page.getByRole('combobox', { name: 'Продукт', exact: true }).selectOption(id);
      await expect.poll(async () => (await diagnostics(page)).productId).toBe(id);
      await expect(page.getByTestId('source-info')).toContainText('landscape-grid.png');
      expect((await diagnostics(page)).sourceWidthPx).toBe(1800);
    }
  });

  for (const mimeType of ['image/jpeg', 'image/webp'] as const) {
    test(`actual ${mimeType} pixels decode through file input`, async ({ studio: page }) => {
      const name = mimeType === 'image/jpeg' ? 'original-grid.jpg' : 'original-grid.webp';
      await page
        .getByTestId('image-input')
        .setInputFiles({ name, mimeType, buffer: await encodedFixture(page, mimeType) });
      await expect(page.getByTestId('source-info')).toContainText(name);
      await expect(page.getByTestId('source-info')).toContainText('1800 × 800');
      expect((await diagnostics(page)).sourceHeightPx).toBe(800);
    });
  }

  test('unsupported and corrupt files report errors and preserve the last valid print', async ({
    studio: page,
  }) => {
    await importFixture(page, 'uv-circle.png');
    await page.getByTestId('image-input').setInputFiles({
      name: 'unsafe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg><script>throw new Error("executed")</script></svg>'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('source-info')).toContainText('uv-circle.png');
    await page.getByTestId('image-input').setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('source-info')).toContainText('uv-circle.png');
    expect((await diagnostics(page)).sourceWidthPx).toBe(1800);
  });

  test('Cover and Contain preserve an actual circle; only explicit Stretch distorts it', async ({
    studio: page,
  }, info) => {
    await importFixture(page, 'uv-circle.png');
    for (const id of ['deskmat-900x400', 'mousepad-400x450']) {
      await page.getByRole('combobox', { name: 'Продукт', exact: true }).selectOption(id);
      await camera(page, 'Сверху');
      for (const mode of ['cover', 'contain']) {
        await page.getByRole('combobox', { name: 'Размещение', exact: true }).selectOption(mode);
        const pixels = await canvas(page).screenshot({
          path: info.outputPath(`${id}-${mode}.png`),
        });
        const circle = redCircleBounds(pixels);
        expect(circle.ratio).toBeGreaterThan(0.93);
        expect(circle.ratio).toBeLessThan(1.07);
        await info.attach(`${id}-${mode}`, { body: pixels, contentType: 'image/png' });
      }
    }
    await page.getByRole('combobox', { name: 'Размещение', exact: true }).selectOption('stretch');
    await expect(
      page.getByText('Stretch изменяет пропорции рисунка.', { exact: true }),
    ).toBeVisible();
    const stretched = redCircleBounds(await canvas(page).screenshot());
    expect(stretched.ratio).toBeGreaterThan(0.34);
    expect(stretched.ratio).toBeLessThan(0.46);
  });

  test('landscape square portrait panorama and very tall original images all decode', async ({
    studio: page,
  }) => {
    for (const fixture of [
      'landscape-grid.png',
      'square-rgb.png',
      'portrait-grid.png',
      'panorama-grid.png',
      'very-tall-grid.png',
      'transparent.png',
    ]) {
      await importFixture(page, fixture);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect((await diagnostics(page)).previewWidthPx).toBeGreaterThan(0);
    }
  });

  test('print controls change pixels and reset restores the original layout', async ({
    studio: page,
  }) => {
    await importFixture(page, 'uv-circle.png');
    await camera(page, 'Сверху');
    const before = await canvas(page).screenshot();
    await setSlider(page, 'Масштаб', 1.5);
    await setSlider(page, 'Сдвиг X', 0.15);
    await setSlider(page, 'Сдвиг Y', -0.1);
    await setSlider(page, 'Поворот', 37);
    expect(changedPixelFraction(before, await canvas(page).screenshot())).toBeGreaterThan(0.01);
    await expect(page.getByTestId('print-quality')).toContainText('34 DPI');
    await page.getByRole('button', { name: '↺ Сбросить принт', exact: true }).click();
    for (const [label, value] of [
      ['Масштаб', '1'],
      ['Сдвиг X', '0'],
      ['Сдвиг Y', '0'],
      ['Поворот', '0'],
    ])
      await expect(page.getByRole('slider', { name: label!, exact: true })).toHaveValue(value!);
    expect(changedPixelFraction(before, await canvas(page).screenshot())).toBeLessThan(0.005);
  });

  test('Edit Print drag moves artwork and Ctrl-wheel scales it without moving the camera', async ({
    studio: page,
  }) => {
    await importFixture(page, 'uv-circle.png');
    await camera(page, 'Сверху');
    await page.getByRole('button', { name: '↔ Двигать принт на коврике', exact: true }).click();
    const before = (await diagnostics(page)).cameraPosition;
    const bounds = await canvas(page).boundingBox();
    if (!bounds) throw new Error('No canvas');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(page.getByRole('slider', { name: 'Сдвиг X', exact: true })).not.toHaveValue('0');
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -150);
    await page.keyboard.up('Control');
    await expect(page.getByRole('slider', { name: 'Масштаб', exact: true })).not.toHaveValue('1');
    expect((await diagnostics(page)).cameraPosition).toEqual(before);
  });

  test('DPI uses original pixels while bounded GPU resolution changes independently', async ({
    studio: page,
  }) => {
    await importFixture(page, 'high-resolution-grid.png');
    await expect(page.getByTestId('source-info')).toContainText('8192 × 4096');
    await expect(page.getByTestId('source-info')).toContainText('4096 × 2048');
    await expect(page.getByTestId('print-quality')).toContainText('Good');
    await expect(page.getByTestId('print-quality')).toContainText('231 DPI');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Качество viewport', exact: true })
      .selectOption('low');
    await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
    await expect.poll(async () => (await diagnostics(page)).previewWidthPx).toBe(2048);
    await expect(page.getByTestId('print-quality')).toContainText('231 DPI');
    await importFixture(page, 'small-low-resolution.png');
    await expect(page.getByTestId('print-quality')).toContainText('Very Low');
    await expect(page.getByTestId('print-quality')).toContainText('1 DPI');
  });
});
