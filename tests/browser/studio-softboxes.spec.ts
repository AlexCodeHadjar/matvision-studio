import { test, expect, canvas, diagnostics, loadGoldenProject } from '../helpers/studio';
import { changedPixelFraction, imageEvidence, pixelDifference } from '../helpers/image-evidence';
import { luminance, samplePatch } from '../helpers/pixel-probes';

test('opt-in area lights change the cloth and restore the original Studio image', async ({
  studio: page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await loadGoldenProject(page, 'gray-50-srgb.png', {
    materialPreset: 'fine-weave',
  });
  const toggle = page.getByRole('checkbox', { name: 'Мягкий студийный свет' });
  const before = await canvas(page).screenshot();
  const frameBefore = (await diagnostics(page)).frameCount;
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(page.locator('.error')).toHaveCount(0);
  await expect
    .poll(async () => (await diagnostics(page)).frameCount)
    .toBeGreaterThan(frameBefore + 2);
  const enhanced = await canvas(page).screenshot();
  await info.attach('studio-before', { body: before, contentType: 'image/png' });
  await info.attach('studio-softboxes', { body: enhanced, contentType: 'image/png' });
  const changed = changedPixelFraction(before, enhanced);
  expect(changed).toBeGreaterThan(0.01);
  expect(imageEvidence(enhanced).luminanceVariance).toBeGreaterThan(2);
  const frameBeforeReset = (await diagnostics(page)).frameCount;
  await toggle.uncheck();
  await expect
    .poll(async () => (await diagnostics(page)).frameCount)
    .toBeGreaterThan(frameBeforeReset + 2);
  const restored = await canvas(page).screenshot();
  expect(pixelDifference(before, restored).meanAbsolute).toBeLessThan(3);
  await info.attach('studio-restored', { body: restored, contentType: 'image/png' });
  const cameraBefore = (await diagnostics(page)).cameraPosition;
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('Studio canvas has no bounds');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.56, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const cameraAfter = (await diagnostics(page)).cameraPosition;
      return Math.hypot(...cameraAfter.map((value, index) => value - cameraBefore[index]!));
    })
    .toBeGreaterThan(0.02);
});

test('softbox mode keeps black and white prints within the display range', async ({
  studio: page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const toggle = page.getByRole('checkbox', { name: 'Мягкий студийный свет' });
  await toggle.check();
  for (const fixture of ['black.png', 'white.png']) {
    await loadGoldenProject(page, fixture);
    const start = (await diagnostics(page)).frameCount;
    await expect.poll(async () => (await diagnostics(page)).frameCount).toBeGreaterThan(start + 2);
    const pixels = await canvas(page).screenshot();
    const patch = luminance(samplePatch(pixels, await diagnostics(page), 0.5, 0.5));
    expect(patch, `${fixture} should retain visible gradation`).toBeGreaterThan(1);
    expect(patch, `${fixture} should not clip to full white`).toBeLessThan(254);
    await info.attach(`softboxes-${fixture}`, { body: pixels, contentType: 'image/png' });
  }
});
