import { expect, test } from '@playwright/test';
import { changedPixelFraction, imageEvidence } from '../helpers/image-evidence';
import { parseDiagnostics } from '../helpers/scene-diagnostics';
import { settleCamera } from '../helpers/studio';

test('real WebGL2 studio shows a volumetric desk mat and responds to orbit', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  const viewport = page.getByTestId('viewport');
  const canvas = viewport.locator('canvas');
  const diagnosticOutput = page.getByTestId('scene-diagnostics');
  await expect(canvas).toBeVisible();
  await expect(diagnosticOutput).toContainText(/"ready"\s*:\s*true/);
  const scene = parseDiagnostics(await diagnosticOutput.textContent());
  expect(scene.renderer).toBe('WebGL2');
  expect(scene.productId).toBe('deskmat-900x400');
  expect(scene.widthM).toBeCloseTo(0.9, 5);
  expect(scene.heightM).toBeCloseTo(0.4, 5);
  expect(scene.thicknessM).toBeCloseTo(0.003, 5);
  expect(scene.triangles).toBeGreaterThan(12);
  expect(scene.drawCalls).toBeGreaterThanOrEqual(2);
  expect(scene.frameCount).toBeGreaterThan(0);
  expect(scene.outputColorSpace).toBe('srgb');
  expect(scene.environmentId).toBe('neutral-studio');
  await expect(canvas).toHaveScreenshot('vertical-slice-deskmat-perspective.png', {
    animations: 'disabled',
  });
  const before = await canvas.screenshot();
  await testInfo.attach('actual-viewport-before-orbit', { body: before, contentType: 'image/png' });
  const evidence = imageEvidence(before);
  await testInfo.attach('scene-and-pixel-evidence', {
    body: JSON.stringify({ scene, pixels: evidence }, null, 2),
    contentType: 'application/json',
  });
  expect(evidence.width).toBeGreaterThan(400);
  expect(evidence.height).toBeGreaterThan(300);
  expect(evidence.uniqueColors).toBeGreaterThan(64);
  expect(evidence.luminanceVariance).toBeGreaterThan(4);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Rendered canvas has no bounds');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.67, box.y + box.height * 0.58, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const current = parseDiagnostics(await diagnosticOutput.textContent());
      return Math.hypot(
        ...current.cameraPosition.map((value, i) => value - (scene.cameraPosition[i] ?? 0)),
      );
    })
    .toBeGreaterThan(0.02);
  const after = await canvas.screenshot();
  await testInfo.attach('actual-viewport-after-orbit', { body: after, contentType: 'image/png' });
  expect(changedPixelFraction(before, after)).toBeGreaterThan(0.01);
  expect(pageErrors).toEqual([]);
});

test('both catalogue sizes render and the low angle exposes the physical edge', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const canvas = page.getByTestId('viewport').locator('canvas');
  const output = page.getByTestId('scene-diagnostics');
  await expect(output).toContainText(/"ready"\s*:\s*true/);
  await page.getByRole('button', { name: 'Низкий угол', exact: true }).click();
  await settleCamera(page);
  await expect
    .poll(async () => parseDiagnostics(await output.textContent()).cameraPreset)
    .toBe('low-angle');
  expect(parseDiagnostics(await output.textContent()).cameraPosition[1]).toBeGreaterThan(0.003);
  await expect(canvas).toHaveScreenshot('deskmat-low-angle.png', { animations: 'disabled' });
  await testInfo.attach('deskmat-low-angle', {
    body: await canvas.screenshot(),
    contentType: 'image/png',
  });

  await page
    .getByRole('combobox', { name: 'Продукт', exact: true })
    .selectOption('mousepad-400x450');
  await expect
    .poll(async () => parseDiagnostics(await output.textContent()).productId)
    .toBe('mousepad-400x450');
  await settleCamera(page);
  expect(parseDiagnostics(await output.textContent()).cameraPreset).toBe('perspective');
  const mousepad = parseDiagnostics(await output.textContent());
  expect(mousepad.widthM).toBeCloseTo(0.4, 5);
  expect(mousepad.heightM).toBeCloseTo(0.45, 5);
  expect(mousepad.thicknessM).toBeCloseTo(0.003, 5);
  expect(mousepad.triangles).toBeGreaterThan(12);
  await expect(canvas).toHaveScreenshot('mousepad-perspective.png', { animations: 'disabled' });
  const mousepadPixels = await canvas.screenshot();
  expect(imageEvidence(mousepadPixels).luminanceVariance).toBeGreaterThan(4);
  await testInfo.attach('mousepad-perspective', { body: mousepadPixels, contentType: 'image/png' });

  await page
    .getByRole('combobox', { name: 'Продукт', exact: true })
    .selectOption('deskmat-900x400');
  await expect
    .poll(async () => parseDiagnostics(await output.textContent()).productId)
    .toBe('deskmat-900x400');
  const restored = parseDiagnostics(await output.textContent());
  expect(restored.widthM).toBeCloseTo(0.9, 5);
  expect(restored.heightM).toBeCloseTo(0.4, 5);
});
