import { test, expect, diagnostics, selectProduct } from '../helpers/studio';

test('size menu shows proportional white rectangles and selects 3 mm mats', async ({
  studio: page,
}, info) => {
  test.setTimeout(240_000);
  // Size/layout checks do not need expensive Ultra AO on the software-rendered test GPU.
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Качество viewport', { exact: true }).selectOption('low');
  await page.getByLabel('Закрыть настройки', { exact: true }).click();
  const sizes: readonly [number, number][] = [
    [80, 30],
    [70, 30],
    [40, 30],
    [40, 40],
    [18, 22],
    [20, 24],
    [20, 25],
    [25, 25],
  ];
  await page.getByLabel('Размер коврика', { exact: true }).click();
  for (const [width, height] of sizes) {
    const row = page.locator(`[data-product-id="mat-${width * 10}x${height * 10}"]`);
    const shape = row.locator('.mat-size-shape');
    const dimensions = await shape.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        color: getComputedStyle(element).backgroundColor,
      };
    });
    expect(dimensions.width / dimensions.height).toBeCloseTo(width / height, 2);
    expect(dimensions.color).toBe('rgb(255, 255, 255)');
    await expect(row).toContainText(`${width} × ${height} см`);
  }
  await page.screenshot({ path: info.outputPath('size-menu.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.mat-size-picker')).not.toHaveAttribute('open');
  for (const [width, height] of sizes) {
    const id = `mat-${width * 10}x${height * 10}`;
    await selectProduct(page, id);
    await expect.poll(async () => (await diagnostics(page)).productId).toBe(id);
    const scene = await diagnostics(page);
    expect(scene.widthM).toBeCloseTo(width / 100, 5);
    expect(scene.heightM).toBeCloseTo(height / 100, 5);
    expect(scene.thicknessM).toBeCloseTo(0.003, 5);
  }
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  const saved = await downloadPromise;
  const savedPath = info.outputPath('25x25.matvision');
  await saved.saveAs(savedPath);
  await selectProduct(page, 'mat-800x300');
  await page.getByTestId('project-input').setInputFiles(savedPath);
  await expect.poll(async () => (await diagnostics(page)).productId).toBe('mat-250x250');
});

test('size menu closes on outside click and supports keyboard selection', async ({
  studio: page,
}) => {
  const summary = page.getByLabel('Размер коврика', { exact: true });
  await summary.click();
  await page.locator('.brand-mark').click();
  await expect(page.locator('.mat-size-picker')).not.toHaveAttribute('open');
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await diagnostics(page)).productId).toBe('mousepad-400x450');
  await expect(summary).toBeFocused();
});
