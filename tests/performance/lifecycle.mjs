/** Exercises the actual StudioScene; scene internals are not replaced or mocked. */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const baseURL = process.env.MATVISION_BENCH_URL ?? 'http://127.0.0.1:1420';
const bytes8K = await readFile('tests/fixtures/high-resolution-grid.png');
const bytesSmall = await readFile('tests/fixtures/landscape-grid.png');
const browser = await chromium.launch({ headless: false, channel: 'chromium' });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
let result;
try {
  await page.goto(`${baseURL}/tests/performance/scene-harness.html`);
  await page.waitForFunction(() => Boolean(window.matvisionPerformanceModules));
  await page.waitForLoadState('networkidle');
  result = await page.evaluate(
    async ({ large, small }) => {
      const { StudioScene, createDefaultProject } = window.matvisionPerformanceModules;
      const host = document.querySelector('#viewport');
      const errors = [];
      const tracked = new Map();
      const textureHandles = new Set();
      const snapshots = [];
      let state = createDefaultProject();
      const scene = new StudioScene(host, state, (message) => {
        if (message) errors.push(message);
      });
      const frames = (count = 3) =>
        new Promise((resolve) => {
          const next = () => (--count > 0 ? requestAnimationFrame(next) : resolve());
          requestAnimationFrame(next);
        });
      function track(resource, kind) {
        if (!resource || tracked.has(resource)) return;
        const item = { kind, disposed: false, name: resource.name };
        tracked.set(resource, item);
        resource.addEventListener('dispose', () => {
          item.disposed = true;
        });
      }
      function collect() {
        // Ownership audit intentionally observes the controller's target: Three frees its
        // attachment when RenderTarget.dispose fires, without Texture.dispose firing.
        track(scene.environment, 'environment render target');
        collectTextureHandle(scene.scene.environment);
        scene.scene.traverse((object) => {
          // Sprite.geometry is one Three-owned shared quad, not an application allocation.
          if (!object.isSprite) track(object.geometry, 'geometry');
          if (object.shadow?.map) {
            track(object.shadow.map, 'shadow render target');
            collectTextureHandle(object.shadow.map.texture);
            collectTextureHandle(object.shadow.map.depthTexture);
          }
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            if (!material) continue;
            track(material, 'material');
            for (const value of Object.values(material)) {
              if (value?.isTexture) {
                track(value, 'material texture');
                collectTextureHandle(value);
              }
            }
          }
        });
      }
      function collectTextureHandle(texture) {
        if (!texture) return;
        const handle = scene.renderer.properties.get(texture).__webglTexture;
        if (handle) textureHandles.add(handle);
      }
      function snapshot(label) {
        collect();
        const diagnostics = scene.getDiagnostics();
        snapshots.push({
          label,
          ...diagnostics,
          geometries: scene.renderer.info.memory.geometries,
          programs: scene.renderer.info.programs.length,
        });
      }
      function source(dataUrl, name, widthPx, heightPx) {
        return { name, mimeType: 'image/png', dataUrl, widthPx, heightPx };
      }
      const bigSource = source(large, '8k.png', 8192, 4096);
      const smallSource = source(small, 'landscape.png', 1800, 800);
      await frames();
      snapshot('initial');
      state = { ...state, edgePreset: 'stitched', referenceMode: true };
      scene.update(state);
      for (let index = 0; index < 12; index++) {
        const selected = index % 2 === 0 ? bigSource : smallSource;
        await scene.setPrintSource(selected);
        await frames();
        snapshot(`source-${index + 1}`);
      }
      const sourceCounts = snapshots
        .filter((item) => item.label.startsWith('source-'))
        .map((item) => item.textures);
      const sourceCountsBounded = new Set(sourceCounts).size === 1;
      for (let index = 0; index < 12; index++) {
        state = {
          ...state,
          productId: index % 2 === 0 ? 'mousepad-400x450' : 'deskmat-900x400',
          materialPreset: ['smooth-cloth', 'fine-weave', 'gaming-fabric'][index % 3],
          environment: ['neutral-studio', 'bright-studio', 'warm-room', 'desk-setup'][index % 4],
          quality: ['low', 'balanced', 'high'][index % 3],
        };
        scene.update(state);
        await frames();
        snapshot(`resources-${index + 1}`);
      }
      const resourceSnapshots = snapshots.filter((item) => item.label.startsWith('resources-'));
      const resourceCountsBounded = resourceSnapshots.every(
        (item, index) =>
          index < 6 ||
          (item.textures === resourceSnapshots[index - 6].textures &&
            item.geometries === resourceSnapshots[index - 6].geometries),
      );
      // PMREM atlas dimensions select shader variants; allow their first compilation,
      // then require the warmed second cycle to keep a constant program count.
      const programCountsBounded =
        new Set(resourceSnapshots.slice(6).map((item) => item.programs)).size === 1;
      const latestResults = await Promise.all([
        scene.setPrintSource(bigSource),
        scene.setPrintSource(smallSource),
      ]);
      await frames();
      snapshot('latest-request-wins');
      const latestRequestWins =
        latestResults[0] === null && scene.getDiagnostics().sourceWidthPx === 1800;
      const gl = scene.renderer.getContext();
      const extension = gl.getExtension('WEBGL_lose_context');
      let contextRestore = 'UNAVAILABLE';
      if (extension) {
        const lost = new Promise((resolve) =>
          scene.renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true }),
        );
        extension.loseContext();
        await lost;
        await new Promise((resolve) => setTimeout(resolve, 100));
        const restored = new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Context recovery exceeded 10 seconds')),
            10_000,
          );
          scene.renderer.domElement.addEventListener(
            'webglcontextrestored',
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
        extension.restoreContext();
        await restored;
        await frames(5);
        snapshot('context-restored');
        contextRestore =
          scene.getDiagnostics().contextLost === false &&
          scene.getDiagnostics().sourceWidthPx === 1800
            ? 'PASS'
            : 'FAIL';
      }
      // Traverse after context recovery so new PMREM and shadow resources are also audited.
      collect();
      const pendingAtDispose = scene.setPrintSource(bigSource);
      scene.dispose();
      const disposedPendingDecode = (await pendingAtDispose) === null;
      const survivingWebGLTextures = [...textureHandles].filter((handle) =>
        gl.isTexture(handle),
      ).length;
      const undisposed = [...tracked.values()].filter((item) => !item.disposed);
      const disposedMemory = { ...scene.renderer.info.memory };
      const expectedContextErrors = errors.filter((message) =>
        message.includes('Графический контекст потерян'),
      );
      const unexpectedErrors = errors.filter((message) => !expectedContextErrors.includes(message));
      return {
        snapshots,
        sourceCountsBounded,
        resourceCountsBounded,
        programCountsBounded,
        disposedPendingDecode,
        observedWebGLTextures: textureHandles.size,
        survivingWebGLTextures,
        latestRequestWins,
        contextRestore,
        trackedResources: tracked.size,
        undisposed,
        disposedMemory,
        canvasRemoved: !host.querySelector('canvas'),
        expectedContextErrors,
        unexpectedErrors,
        pass:
          sourceCountsBounded &&
          resourceCountsBounded &&
          programCountsBounded &&
          disposedPendingDecode &&
          survivingWebGLTextures === 0 &&
          latestRequestWins &&
          contextRestore === 'PASS' &&
          undisposed.length === 0 &&
          !host.querySelector('canvas') &&
          unexpectedErrors.length === 0,
      };
    },
    {
      large: `data:image/png;base64,${bytes8K.toString('base64')}`,
      small: `data:image/png;base64,${bytesSmall.toString('base64')}`,
    },
  );
  result.timestamp = new Date().toISOString();
  result.browser = browser.version();
  result.pageErrors = pageErrors;
  result.pass = result.pass && pageErrors.length === 0;
  await mkdir('docs/performance', { recursive: true });
  await writeFile('docs/performance/resource-lifecycle.json', JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      pass: result.pass,
      trackedResources: result.trackedResources,
      undisposed: result.undisposed,
      sourceCountsBounded: result.sourceCountsBounded,
      contextRestore: result.contextRestore,
      latestRequestWins: result.latestRequestWins,
      disposedMemory: result.disposedMemory,
    }),
  );
  if (!result.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
