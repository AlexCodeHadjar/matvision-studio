import { test, expect, diagnostics, selectProduct, camera } from '../helpers/studio';

test('dimension rulers match sizes and follow the mat rotation', async ({ studio: page }, info) => {
  test.setTimeout(240000);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByLabel('Качество viewport', { exact: true }).selectOption('low');
  await page.getByLabel('Закрыть настройки', { exact: true }).click();
  await selectProduct(page, 'mat-800x300');
  await page.getByRole('checkbox', { name: 'Линейки · размеры коврика', exact: true }).check();
  await camera(page, 'Сверху');
  const raw = async () =>
    JSON.parse((await page.getByTestId('scene-diagnostics').textContent()) ?? '{}');
  await expect.poll(async () => (await raw()).rulers?.visible).toBe(true);
  expect((await raw()).rulers).toMatchObject({ widthMm: 800, heightMm: 300, units: 'cm' });
  await page.screenshot({ path: info.outputPath('rulers-80x30.png') });
  await selectProduct(page, 'mat-180x220');
  await camera(page, 'Сверху');
  await expect.poll(async () => (await raw()).rulers?.widthMm).toBe(180);
  expect((await raw()).rulers).toMatchObject({ heightMm: 220, visible: true });
  await page.screenshot({ path: info.outputPath('rulers-18x22.png') });
  await page.getByRole('checkbox', { name: 'Turntable · вращать коврик', exact: true }).check();
  await expect.poll(async () => (await diagnostics(page)).matRotationY).toBeGreaterThan(0.05);
  const rotated = await raw();
  expect(rotated.rulers.rotationY).toBeCloseTo(rotated.matRotationY, 4);
  await page.getByRole('checkbox', { name: 'Turntable · вращать коврик', exact: true }).uncheck();
});
