# Testing MatVision Studio

## Layers and gates

| Suite               | What it proves                                                                                 | Command                       |
| ------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| TypeScript and lint | Contract/type and static correctness                                                           | `pnpm typecheck`, `pnpm lint` |
| Vitest CPU          | Product units, printable area, layout math and project validation as modules land              | `pnpm test`                   |
| Browser WebGL       | Real Three.js WebGL2 scene, image evidence, input and deterministic screenshots                | `pnpm test:browser`           |
| Native WebdriverIO  | Built Tauri binary, actual Windows WebView2, rendering and native workflows as milestones land | `pnpm test:native`            |

The first vertical gate includes the volume desk mat, neutral light, camera orbit and actual rendered pixels. It is not a declaration that the entire product roadmap is complete. Each subsequent gate extends the tests alongside implementation. No skipped or mocked tests count as acceptance.

## Setup and first run

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:fixtures
pnpm typecheck
pnpm lint
pnpm test
pnpm test:browser
pnpm tauri build --no-bundle
pnpm test:native
```

Rust, the MSVC C++ build toolchain and Windows SDK are required for native builds. WebView2 must be installed. The native service installs `tauri-driver` through Cargo if absent and downloads a matching Microsoft Edge WebDriver. Native test networking therefore needs to permit those official downloads on the first run. Subsequent runs can use the cached drivers.

Native tests default to `src-tauri/target/release/matvision-studio.exe`. Set `MATVISION_BINARY` to an absolute built binary path to test another build; `TAURI_DRIVER_PATH` selects a preinstalled driver. A missing binary is a hard failure. There is no dev-server fallback.

## Deterministic visual regression

Playwright fixes Chromium, viewport 1440 × 1000, device scale 1, locale, timezone and software WebGL renderer. Scene defaults fix product, neutral environment, camera and exposure; turntable is off. Locator screenshots capture composited pixels inside the canvas bounds, including any overlapping viewport labels. Only the changing development FPS overlay is hidden by screenshot CSS. Raw PNG export is a separate tested path and contains no UI. Pixel variance rejects empty frames. The orbit test also requires a changed camera position and changed rendered pixels.

Baselines live in `tests/browser/__screenshots__/chromium-swiftshader/`. Create or intentionally update them with:

```powershell
pnpm test:browser --update-snapshots=all
```

Always inspect the generated PNGs and record findings in `docs/visual-review.md`, then run the ordinary suite to prove stable comparison. Baseline generation alone is not a PASS. The comparison allows 1.5% changed pixels with per-pixel threshold 0.12; major shape, UV, camera and color changes must be reviewed instead of increasing tolerance. There are ten required feature scenes plus three startup/geometry baselines.

Use the explicit `all` update mode for an intentional complete capture change: the default changed-only mode retains an old image when a small overlay difference is already below the comparison tolerance. This is relevant when removing the development FPS label.

## Feature regressions

- `import-layout.spec.ts` (`@B`): actual PNG/JPEG/WebP import and drop, corrupt/unsupported input, both physical products, Cover/Contain/Stretch circle measurements, layout controls and gestures, original-source DPI versus bounded GPU preview, and a delayed real decode followed by a corrupt second import.
- `rendering-visual.spec.ts` (`@C @D`): ten golden scenes, independently projected color-patch samples and sRGB/ACES gray oracle, three cloth/four environment presets, every camera, turntable, physical ruler, actual WebGL context loss/restore, and interrupted underside transition.
- `persistence-export.spec.ts` (`@E`): actual browser project download, page close/reopen and project-file restoration, Screen/3840 px PNG exports, invalid-project preservation, modal focus and keyboard shortcuts.
- `tests/native/project-workflow.e2e.ts`: production EXE import/save/relaunch/restore/export with real Windows file dialogs, Cyrillic names and spaces, saved embedded source, and exported PNG pixels. The helper locates only the application's actual dialog/control HWNDs, checks process ownership, and uses standard Win32 control messages on hosts whose UI Automation provider omits Value/Invoke patterns. Native Rust save completion is awaited before reading the file.

The delayed-import regression controls only browser decode scheduling; it still uses real decoding and pixels. No production state-mutating test hooks or replacement renderers are used. Deterministic SwiftShader tests do not establish native GPU performance; the performance suite runs separately in an exclusive foreground slot.

Native screenshots use the host WebView2/GPU and are evidence, not compared to Chromium software baselines. Successful and failed browser traces/screenshots are under `test-results/`; native screenshots and diagnostics are under `test-results/native/`.

## Diagnostics contract

`[data-testid=viewport] canvas` is the actual canvas. A hidden read-only `scene-diagnostics` output reports JSON derived from the live renderer: readiness after a frame, backend, current product, mesh bounds in metres, triangle/draw counts, frame count, camera position, output color space, tone mapping and environment. Tests combine those observations with actual screenshots and input. Diagnostics neither create a substitute scene nor mutate application state.

## Native automation choice

The [official Tauri WebDriver guide](https://v2.tauri.app/develop/tests/webdriver/) recommends `@wdio/tauri-service`. This project uses its [external provider](https://webdriver.io/docs/wdio-tauri-service/) to drive the production executable via `tauri-driver` and Microsoft Edge WebDriver. The external provider avoids shipping a test plugin in the application; all tested rendering uses the actual Tauri window. A browser smoke run never substitutes for native E2E.

## Current evidence

Checkpoint A passed on 2026-09-15, followed by image/layout functional approval and manual review of all ten feature scenes. The release production EXE passed the complete native dialog workflow, including application relaunch and raw PNG export. See [the visual review](docs/visual-review.md) for exact results, binary hash, final comparison status, and retained evidence. Root release checks record CPU/native unit tests and local installer validation separately.

The native suite explicitly selects the main WebDriver window to avoid optional plugin autofocus probes. It invokes the real read-only Rust `runtime_info` command. Because WebView2 may return the full window for an element screenshot, native image evidence is cropped from a full-window capture using the live canvas rectangle and screenshot/CSS pixel ratio. The surrounding UI cannot satisfy the canvas pixel assertions.

## GitHub publication checkpoint · 2026-09-23

The initial GitHub publication is based on 0.1.5 with documentation, images and publication hygiene updates. Automatic CI runs types, lint, CPU tests and frontend build. Historical browser baselines and native WebDriver runs remain opt-in via `workflow_dispatch` / `full_gpu_checks`: they have not been reaccepted for every 0.1.5 visual change. Skipped GPU jobs do not mean GPU acceptance.

The exhaustive geometry topology test now has a local 30-second limit: the first publication run took over the default 5 seconds while checking every face at three thicknesses. Its assertions were not removed or relaxed. This is a test-runner timeout adjustment, not a change in rendering quality or an FPS target.

Installed Windows 0.1.5 photo evidence remains separate in `docs/release/native-quality-0.1.5.json`. It covers 1920 px / 128 samples on RTX 3050 Laptop; higher photo settings and other GPUs are not implied by CI success.

## 0.1.6 native checkpoint · 2026-09-23

`docs/release/native-quality-0.1.6.json` records the built Windows x64 release, installer, matched WebView2 baseline against 0.1.5, softbox toggle/restoration and a completed 128-pass Photo run with the toggle enabled. The Photo test confirms compatibility with the unchanged path tracer; it does not claim the new realtime lights are present in Photo. The screenshot dimensions in that smoke report describe the browser capture, not a saved full-resolution Photo PNG. This checkpoint does not certify all GPUs, photo export dimensions or a clean Windows machine.
