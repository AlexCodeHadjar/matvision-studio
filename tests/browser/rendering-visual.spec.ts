import {
  test,
  expect,
  camera,
  canvas,
  diagnostics,
  importFixture,
  loadGoldenProject,
  settleCamera,
} from '../helpers/studio';
import type { ProjectState } from '../../src/contracts';
import { changedPixelFraction, imageEvidence, pixelDifference } from '../helpers/image-evidence';
import { luminance, predictLitGray, samplePatch } from '../helpers/pixel-probes';

const goldens: Array<{
  name: string;
  fixture: string;
  view?: string;
  patch?: Partial<ProjectState>;
}> = [
  { name: 'deskmat-top', fixture: 'landscape-grid.png', view: 'Сверху' },
  { name: 'deskmat-perspective', fixture: 'landscape-grid.png', view: 'Перспектива' },
  { name: 'deskmat-low-angle', fixture: 'landscape-grid.png', view: 'Низкий угол' },
  {
    name: 'mousepad-top',
    fixture: 'landscape-grid.png',
    view: 'Сверху',
    patch: { productId: 'mousepad-400x450' },
  },
  {
    name: 'mousepad-perspective',
    fixture: 'landscape-grid.png',
    view: 'Перспектива',
    patch: { productId: 'mousepad-400x450' },
  },
  {
    name: 'stitched-edge-closeup',
    fixture: 'gray-50-srgb.png',
    patch: {
      edgePreset: 'stitched',
      camera: {
        preset: 'close-up',
        position: [0.08, 0.055, 0.265],
        target: [0, 0.0015, 0.18],
        fovDeg: 35,
      },
    },
  },
  {
    name: 'fabric-closeup',
    fixture: 'gray-50-srgb.png',
    patch: {
      materialPreset: 'fine-weave',
      camera: {
        preset: 'close-up',
        position: [0.04, 0.065, 0.095],
        target: [0, 0.0015, 0],
        fovDeg: 35,
      },
    },
  },
  { name: 'dark-print', fixture: 'black.png', view: 'Перспектива' },
  { name: 'white-print', fixture: 'white.png', view: 'Перспектива' },
  {
    name: 'color-patches',
    fixture: 'color-patches.png',
    view: 'Сверху',
    patch: {
      materialPreset: 'smooth-cloth',
      layout: { mode: 'stretch', scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 },
    },
  },
];
test.describe('PBR and color golden scenes @C @D', () => {
  for (const golden of goldens) {
    test(golden.name, async ({ studio: page }, info) => {
      await loadGoldenProject(page, golden.fixture, golden.patch);
      if (golden.view) await camera(page, golden.view);
      await expect(canvas(page)).toHaveScreenshot(`golden-${golden.name}.png`, {
        animations: 'disabled',
      });
      const pixels = await canvas(page).screenshot();
      expect(imageEvidence(pixels).luminanceVariance).toBeGreaterThan(2);
      await info.attach('rendered-scene', { body: pixels, contentType: 'image/png' });
      if (golden.name === 'color-patches') {
        const scene = await diagnostics(page);
        expect(scene.outputColorSpace).toBe('srgb');
        expect(scene.toneMapping).toBe('ACESFilmic');
        const patches = Array.from({ length: 18 }, (_, index) =>
          samplePatch(
            pixels,
            scene,
            ((index % 6) + 0.5) / 6,
            1 - (Math.floor(index / 6) + 0.5) / 3,
          ),
        );
        const grays = patches.slice(0, 6).map(luminance);
        for (let i = 1; i < grays.length; i++) expect(grays[i]! - grays[i - 1]!).toBeGreaterThan(4);
        for (const [patchIndex, channel] of [
          [6, 0],
          [7, 1],
          [8, 2],
        ] as const) {
          const patch = patches[patchIndex]!;
          expect(patch[channel]).toBeGreaterThan(100);
          for (let other = 0; other < 3; other++)
            if (other !== channel) expect(patch[channel]).toBeGreaterThan(patch[other]! * 1.25);
        }
        const prediction128 = predictLitGray(128, grays[0]!, grays[5]!);
        const prediction188 = predictLitGray(188, grays[0]!, grays[5]!);
        await info.attach('independent-color-oracle', {
          body: JSON.stringify({ patches, grays, prediction128, prediction188 }, null, 2),
          contentType: 'application/json',
        });
        expect(
          Math.abs(grays[3]! - prediction128),
          '128 sRGB must enter linear lighting exactly once',
        ).toBeLessThan(18);
        expect(
          Math.abs(grays[4]! - prediction188),
          '188 sRGB gray must follow the same transfer',
        ).toBeLessThan(18);
      }
    });
  }

  test('every cloth and environment preset changes the real surface', async ({
    studio: page,
  }, info) => {
    await loadGoldenProject(page, 'gray-50-srgb.png', {
      camera: {
        preset: 'close-up',
        position: [0.04, 0.08, 0.1],
        target: [0, 0.0015, 0],
        fovDeg: 35,
      },
    });
    let previous = await canvas(page).screenshot();
    for (const material of ['smooth-cloth', 'gaming-fabric', 'fine-weave']) {
      await page.getByRole('combobox', { name: 'Материал', exact: true }).selectOption(material);
      const current = await canvas(page).screenshot();
      const difference = pixelDifference(previous, current);
      console.log('Material pixel difference', material, difference);
      await info.attach(material, { body: current, contentType: 'image/png' });
      // Cloth normal changes are deliberately subtle. Camera's >8-level threshold
      // would discard valid microtexture differences; quantify all actual RGB deltas.
      expect(difference.meanAbsolute).toBeGreaterThan(0.03);
      previous = current;
    }
    for (const environment of ['bright-studio', 'warm-room', 'desk-setup', 'neutral-studio']) {
      await page
        .getByRole('combobox', { name: 'Освещение', exact: true })
        .selectOption(environment);
      await expect.poll(async () => (await diagnostics(page)).environmentId).toBe(environment);
      const current = await canvas(page).screenshot();
      expect(changedPixelFraction(previous, current)).toBeGreaterThan(0.01);
      previous = current;
    }
  });

  test('all cameras, turntable and scale references remain functional', async ({
    studio: page,
  }) => {
    for (const [label, id] of [
      ['Сверху', 'top'],
      ['Перспектива', 'perspective'],
      ['Низкий угол', 'low-angle'],
      ['Крупный план', 'close-up'],
      ['Снизу', 'underside'],
    ] as const) {
      await camera(page, label);
      const scene = await diagnostics(page);
      expect(scene.cameraPreset).toBe(id);
      if (id === 'underside') expect(scene.cameraPosition[1]).toBeLessThan(0);
      else expect(scene.cameraPosition[1]).toBeGreaterThan(scene.thicknessM);
    }
    await camera(page, 'Перспектива');
    const beforeReference = await canvas(page).screenshot();
    await page.getByRole('checkbox', { name: 'Линейка · реальный масштаб', exact: true }).check();
    expect(changedPixelFraction(beforeReference, await canvas(page).screenshot())).toBeGreaterThan(
      0.001,
    );
    await page.getByRole('checkbox', { name: 'Turntable · вращать коврик', exact: true }).check();
    const initial = (await diagnostics(page)).matRotationY;
    await expect
      .poll(async () => Math.abs((await diagnostics(page)).matRotationY - initial))
      .toBeGreaterThan(0.03);
    await page.getByRole('checkbox', { name: 'Turntable · вращать коврик', exact: true }).uncheck();
    await settleCamera(page);
    const stopped = (await diagnostics(page)).matRotationY;
    await expect
      .poll(async () => Math.abs((await diagnostics(page)).matRotationY - stopped))
      .toBeLessThan(0.005);
  });

  test('actual WebGL context loss restores the imported image and lighting', async ({
    studio: page,
  }) => {
    await importFixture(page, 'uv-circle.png');
    await camera(page, 'Сверху');
    const before = await canvas(page).screenshot();
    const extension = await canvas(page).evaluateHandle((node) => {
      const gl = (node as HTMLCanvasElement).getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('WEBGL_lose_context is required by this regression');
      extension.loseContext();
      return extension;
    });
    await expect.poll(async () => (await diagnostics(page)).contextLost).toBe(true);
    await extension.evaluate((value) => value.restoreContext());
    await extension.dispose();
    await expect
      .poll(async () => (await diagnostics(page)).contextLost, { timeout: 30_000 })
      .toBe(false);
    await expect(page.getByTestId('source-info')).toContainText('uv-circle.png');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(changedPixelFraction(before, await canvas(page).screenshot())).toBeLessThan(0.03);
  });

  test('interrupting an underside camera transition keeps the visible underside unobscured', async ({
    studio: page,
  }) => {
    await camera(page, 'Снизу');
    const bounds = await canvas(page).boundingBox();
    if (!bounds) throw new Error('No canvas');
    await page.getByRole('button', { name: 'Перспектива', exact: true }).click();
    // A user starts orbit immediately, while the camera is still below the mat.
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2, {
      steps: 2,
    });
    await page.mouse.up();
    await settleCamera(page);
    const scene = await diagnostics(page);
    expect(scene.cameraPosition[1]).toBeLessThan(0);
    const pixels = await canvas(page).screenshot();
    // An erroneously visible opaque floor fills the view and occludes the rubber.
    // The real underside must retain the mat's large dark silhouette.
    const evidence = imageEvidence(pixels);
    expect(evidence.luminanceVariance).toBeGreaterThan(100);
  });
});
