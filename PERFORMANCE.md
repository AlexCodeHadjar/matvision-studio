# Performance

## Version scope

Sections below the hard limits describe versions up to 0.1.3 and are kept as history.

Version **0.1.3** adds CPU deformation of reusable position/normal and yarn-instance buffers, with denser strips along the bend direction. It recomputes bounds when roll position changes. No sustained benchmark or updated performance acceptance was run; historical 0.1.0 numbers must not be applied to animation. The retained flat geometry/instance arrays add CPU storage, not new texture maps.

Version **0.1.2** adds a reusable set of three 512 × 512 surface maps (approximately 4 MiB with mipmaps) and adjusts shadow framing/filtering. The performance matrix was not rerun at the user's request; earlier measurements do not apply to this update.

All measured results below belong to **0.1.0**. Version **0.1.1** changes stitching geometry, rubber maps and lighting; its performance matrix was not rerun at the user's request. Close-up yarn uses shared instanced geometry and is hidden when the projected stitch size is at most 0.85 pixels. This implementation detail is not a measured performance guarantee.

**Delivery update, 2026-09-15:** the user stopped all remaining verification and requested
installation for immediate desktop use. The unfinished benchmark matrix and final reruns
are skipped at user request. Retained partial measurements must not be read as a completed
performance acceptance. The completed 4K Balanced foreground sample measured 61.85 FPS
and a 21.0 ms P95 frame interval on Intel UHD; the complete matrix was not approved.

MatVision renders the actual volumetric product with Three.js/WebGL2. The viewport uses a
bounded preview of the artwork; original image pixels and encoded bytes remain in the project
for DPI calculations and persistence. Original dimensions must never be inferred from GPU
preview dimensions.

## Hard limits (0.2.0)

Version **0.2.0** is realtime-only. Every limit is a constant in `src/scene/budget.ts`; the
renderer clamps to it and `src/scene/budget.test.ts` fails when a preset, a product or a code
path can exceed it. None of the numbers below is a measured frame rate: no hardware benchmark
was run for 0.2.0.

| Limit                      | Value                                            |
| -------------------------- | ------------------------------------------------ |
| Frame target               | 60 FPS (16.7 ms)                                 |
| Governor lowers resolution | average frame above 22 ms over 30 frames         |
| Governor raises resolution | average at or below 17.5 ms, after a cooldown    |
| Render scale floor         | 0.5                                              |
| Resting scene              | at most one refresh per 500 ms                   |
| Frame pixels               | 3,686,400 (2560 × 1440); detailed mode 2,073,600 |
| Pixel ratio                | 2                                                |
| Shadow map                 | 2048 × 2048                                      |
| Environment source         | 1024 × 512                                       |
| Print preview edge         | 4096 px                                          |
| Owned texture estimate     | 256 MiB                                          |
| Triangles per frame        | 2,000,000 (largest stitched mat: about 1.61 M)   |
| Draw calls per frame       | 64                                               |
| PNG snapshot               | 4096 px per edge and 8,294,400 px                |
| Largest JavaScript chunk   | 1,600,000 bytes (0.2.0 build: 1,488,815)         |

The governor measures intervals between consecutive animation frames. A display that refreshes
slower than about 45 Hz therefore reads as slow and settles at a lower render scale.
`getDiagnostics()` returns `renderScale`, `pixelRatio`, `idle` and `budgetViolations`; a
violation is also logged once as `PERFORMANCE budget-exceeded`.

The individual yarn loops of a stitched edge are the largest remaining cost: 336 triangles for
each of up to 4,160 instances. They are hidden when a stitch covers less than one pixel.

## Quality presets

| Preset             | Maximum preview edge | Maximum pixel ratio |  Shadow map | HDR source panorama |
| ------------------ | -------------------: | ------------------: | ----------: | ------------------: |
| Low                |              2048 px |                   1 |   512 × 512 |           256 × 128 |
| Balanced (default) |              4096 px |                 1.5 | 1024 × 1024 |           512 × 256 |
| High               |              4096 px |                   2 | 2048 × 2048 |          1024 × 512 |

The `ultra` preset was removed in 0.2.0; projects that use it open as `high`.

The effective preview edge is the lesser of the preset limit and `MAX_TEXTURE_SIZE`.
Small images are not enlarged. Aspect ratio is retained to the nearest preview pixel.
Anisotropy is capped at 8 or the GPU capability, whichever is lower. Color textures use sRGB
and mipmaps; normal/roughness maps use linear data. PMREM is generated from scene-linear HDR
radiance and replaced when lighting or quality changes.

Import is limited to 64 MiB encoded and 160 million original pixels. `createImageBitmap`
requests a resized decode. Decoders may still allocate temporary full-image working buffers;
the preview cap is a GPU upload bound, not a promise about total process RAM. Encoded project
artwork is base64, so its text representation also costs memory. No external telemetry is used.

## Ownership and replacement

- A successfully decoded preview replaces the old one; failures preserve the previous print.
- Request generations prevent an older asynchronous decode from replacing a newer request.
  Superseded results and results arriving after scene disposal are disposed immediately.
- Changing quality while a decode is pending retries that decode using current quality.
- Preview disposal releases the Three texture and shrinks its CPU canvas to 1 × 1; temporary
  `ImageBitmap` objects are closed immediately after drawing.
- Product/edge/thickness changes dispose old geometry. Material changes dispose replaced maps.
  Environment/quality changes dispose replaced PMREM and shadow render targets.
- Scene shutdown removes event listeners, stops RAF, disconnects ResizeObserver, disposes controls,
  geometry, materials, owned textures and render targets, and removes the canvas.
- WebGL context recovery reconstructs PMREM and uploads retained texture content again.

## Diagnostics and measurement limits

The development performance overlay reports FPS, average frame interval, draw calls, triangles,
texture count, approximate texture storage, and renderer buffer resolution. Test diagnostics
also expose source/preview dimensions, geometry/program counts and context state.

`approximateTextureBytes` is an **owned texture storage estimate**, not GPU VRAM or process
memory. It includes the cached default artwork after a user image loads, current preview,
fabric/rubber/stitch maps, ruler label textures, the RGBA16F PMREM atlas and RGBA8 shadow color
target. Mip dimensions are summed explicitly so very thin panoramas are counted correctly.
Owned but not yet uploaded textures can make this estimate larger than currently resident
texture storage. Driver alignment, depth/stencil buffers, multisampling, canvas/compositor
buffers, shader programs, geometry, and driver caches are excluded.

`renderer.info.memory` is a Three allocation counter, not a driver memory query. It may retain
internal shared resources/counter values after renderer disposal. Resource acceptance therefore
uses stable counts across equivalent live scenes plus observed disposal of application-owned
resources. A render target owns its attachment textures: the target's disposal event is the
correct observation point, rather than requiring each attachment to emit `Texture.dispose`.

## Reproducing the checks

From the repository root, start the dev server in one terminal:

```powershell
pnpm dev
```

Then run the harnesses with the pinned Playwright browser available:

```powershell
node tests/performance/lifecycle.mjs
node tests/performance/benchmark.mjs
```

The final desktop measurement uses the built release executable and the same native WebdriverIO
service as native E2E. After building the release, run:

```powershell
node node_modules/@wdio/cli/bin/wdio.js run tests/performance/wdio.performance.conf.ts
```

`MATVISION_BINARY` can select the executable and `TAURI_DRIVER_PATH` can select an existing
tauri-driver, as in the main native test suite. Keep other native tests and CPU-intensive builds
stopped during the benchmark. The native report records the tested executable's SHA-256,
WebView2 user agent, active hardware adapter, frame percentiles and twelve upload samples.

Set `PLAYWRIGHT_BROWSERS_PATH` when the pinned Chromium cache is outside its default location.
`MATVISION_BENCH_URL` can select a dedicated Vite server. Benchmark duration defaults to
30 seconds per sample; `MATVISION_BENCH_MS` supports 10000–60000 for exploratory runs. Final
acceptance uses 30-second or longer samples. Each sample has a separate five-second warmup.

The benchmark uses full, visible Chromium with hardware rendering and refuses a software
renderer. Keep the page focused and visible, connect the laptop to power, and stop competing
builds/tests. It records the actual active WebGL adapter, browser, host CPU/RAM, display buffer,
RAF interval percentiles and renderer frame progress. Browser frame intervals measure observed
frame pacing, not an isolated GPU timer. JavaScript heap figures do not include native decoder,
canvas or GPU storage. SwiftShader screenshot tests establish deterministic correctness only;
their FPS is not hardware performance evidence.

The hardware harness exercises a 4096 × 2048 PNG, an 8192 × 4096 PNG across all quality presets,
turntable, and twelve alternating uploads. The lifecycle harness uses the real scene controller
and exercises twelve source replacements, twelve product/material/environment/quality changes,
overlapping imports, context loss/recovery, and disposal while a decode is pending.

## Recorded evidence

See [measurement report](docs/performance/report.md),
hardware samples (the historical raw hardware-benchmark.json is not included in this snapshot), and
[resource lifecycle evidence](docs/performance/resource-lifecycle.json).
