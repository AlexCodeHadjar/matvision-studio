# Visual review

## 2026-09-15 — 0.1.3 interactive roll

The root engineer inspected real StudioScene captures at 0%, 30%, 65% and 100% roll, showing the attached print, backing outside the coil, rounded seam and changing cast shadow. An informal browser interaction used the actual “Скрутить” button (slider reached 100%), then “Раскрыть” and “Пауза” (an intermediate position remained visible). Representative captures: [partial roll](appearance-0.1.3/roll-0.65.png), [full roll](appearance-0.1.3/roll-1.png), and [controls](appearance-0.1.3/roll-controls.png).

This is development appearance evidence, not a formal golden comparison or a performance result. Complete automated suites remain skipped at the user's request.

## 2026-09-15 — 0.1.2 placement surfaces and shadow

Actual StudioScene exports were generated for the six surface choices during appearance work. The root engineer inspected neutral studio, oak and graphite renders: the surface color/wood grain is visible, the mat retains its print colors, and a narrow soft shadow appears at the contact edge. Representative captures: [oak](appearance-0.1.2/surface-oak.png) and [neutral studio](appearance-0.1.2/surface-studio.png).

These are informal appearance captures. TypeScript/Vite compilation completed; automated regression, benchmark and golden comparison suites were not run, following the user's continuing instruction to skip checks.

## 2026-09-15 — 0.1.1 appearance revision

The root engineer inspected actual StudioScene exports using hardware D3D11 Chromium during the requested appearance changes: [overlock close-up](appearance-0.1.1/overlock-close.png), [rubber close-up](appearance-0.1.1/rubber-close.png), [underside](appearance-0.1.1/rubber-overview.png), and [studio perspective](appearance-0.1.1/studio.png). The edge now wraps around the body with dense raised yarn and a smaller interlocking chain. The dark backing shows interleaved diagonal relief. Reduced studio and cloth reflection intensity preserves deeper print colors.

These are informal appearance captures of the procedural materials, not physical scans or a formal golden comparison. Production frontend/native builds completed. Full QA, automated suites and benchmarks were skipped at the user's explicit request; earlier PASS entries describe earlier revisions only.

## 2026-09-15 — First vertical slice, initial capture: FAIL

Environment: Playwright 1.63.0 / Chromium 153.0.8010.12, SwiftShader WebGL2, viewport 1440 × 1000, DPR 1. Default Desk Mat 900 × 400 × 3 mm, perspective camera and neutral studio. The screenshot was inspected directly by QA.

Evidence: [`vertical-slice-rejected-depth-conflict.png`](../tests/visual-evidence/vertical-slice-rejected-depth-conflict.png).

| Item                    | Finding                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical silhouette     | Rounded desk mat shape is present in perspective.                                                                                                    |
| Top surface             | **BLOCKER:** most of the print is black/occluded; horizontal staircase bands expose a depth conflict between surfaces.                               |
| Thickness and edges     | Not approved while the top surface is obscured.                                                                                                      |
| Contact shadow          | Present at the floor contact; detailed assessment deferred until geometry is corrected.                                                              |
| Fabric / matte response | Not approved; the surface defect prevents a meaningful review.                                                                                       |
| Runtime                 | Three.js warned that PCFSoftShadowMap was removed and fell back to PCFShadowMap. Root replaced the obsolete constant.                                |
| Automated test          | Initial capture generated a candidate baseline, but the full browser run timed out during the active development session. This is not a passing run. |

Required correction: eliminate overlapping top surfaces, then regenerate and inspect the candidate baseline and run ordinary regression. The rejected screenshot is retained as evidence; it is not an approved baseline. Product Geometry is correcting the mesh and tests.

## Gate rule

Browser rendering evidence alone does not establish a native desktop PASS. The first vertical slice also requires the built Tauri application to pass its native WebdriverIO smoke test. SwiftShader timings are deterministic software-renderer test timings and must not be reported as native GPU performance.

## 2026-09-15 — Corrected first vertical slice / Checkpoint A: PASS

QA directly inspected all three final browser baselines and the actual native window/canvas capture. The duplicate top cap was removed, round corner normals corrected, HDR softboxes moved to the upper hemisphere, PMREM restoration added, and the removed Three.js shadow constant replaced. Final baselines were generated only after those source changes were frozen, then verified by an ordinary comparison run.

| Evidence                                                                                                             | Result                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Desk Mat perspective](../tests/browser/__screenshots__/chromium-swiftshader/vertical-slice-deskmat-perspective.png) | Entire top is visible, the physical proportions are wide and shallow, round corners are coherent, and the edge meets the floor without the earlier depth bands. |
| [Desk Mat low angle](../tests/browser/__screenshots__/chromium-swiftshader/deskmat-low-angle.png)                    | A thin dark side wall is visible continuously along the front edge. This proves visible thickness in addition to CPU bounds/winding tests.                      |
| [Mouse Pad perspective](../tests/browser/__screenshots__/chromium-swiftshader/mousepad-perspective.png)              | Correct 400 × 450 mm physical silhouette. Switching back restores the 900 × 400 mm geometry.                                                                    |
| [Built native window](../tests/visual-evidence/checkpoint-a-native-window.png)                                       | Actual Tauri/WebView2 app, readable controls, lit 3D mat and usable viewport.                                                                                   |
| [Native canvas pixels](../tests/visual-evidence/checkpoint-a-native-viewport.png)                                    | Cropped using the live canvas bounds; pixel variation and orbit change assertions apply to the canvas itself.                                                   |
| [Native diagnostic evidence](../tests/visual-evidence/checkpoint-a-native-evidence.json)                             | Bounds 0.9 × 0.4 × 0.003 m, WebGL2, sRGB/ACES, neutral environment, 1,250 triangles and 5 draw calls.                                                           |

Automated verification:

- TypeScript and ESLint passed; 18 Vitest tests in 5 files passed.
- Browser: 2 tests passed with all 3 final baselines compared normally (about 1.1 minutes total). Real input changed both the camera and rendered pixels. Two-product switching and low-angle camera assertions passed.
- Native: 1 test passed in 5.5 seconds (16 seconds total), using `@wdio/tauri-service` external provider, official `tauri-driver` 2.0.6 and WebView2 153.0.4234.32. The suite executed the registered Rust `runtime_info` command, checked rendered geometry, dragged the actual native viewport and checked changed canvas pixels. The app process exited after session cleanup.
- Tested debug EXE SHA256: `728EDAF3FEFD3CFD291B3FE505058181BCDDA39B7423E96AB83A02A7D6170E5A`. This is an embedded frontend Tauri build, not a browser dev server.

The native snapshot recorded about 75.5 FPS / 13.2 ms, but it is a short default-texture sample, not the later required sustained 4K/high-resolution performance benchmark. No performance acceptance is inferred from SwiftShader timings.

Scope of approval: physical product dimensions, volume, orbit, neutral lighting and native startup. Low-angle framing currently crops the ends and shows a floor/background horizon; improve these in the camera/lighting milestones. The procedural demo currently stretches when switching to Mouse Pad; the Texture Pipeline checkpoint must replace this with aspect-preserving layout before image import is accepted. Cloth close-up realism, printing color accuracy, persistence and export are outside this initial gate and are not approved by this review.

Harness notes: explicit standard WebDriver window selection avoids optional test-plugin autofocus probes in service 1.4.0. WebView2 returns whole-window element screenshots on this host, so the test crops the actual live canvas rectangle before assessing pixels. Running browser tests in the restricted agent sandbox left the test Vite server alive; rerunning in the normal Windows execution environment completed cleanup successfully.

## 2026-09-15 — Image import and layout / Checkpoint B: PASS

QA manually reviewed the imported square-cell grid in [Desk Mat top view](../tests/browser/__screenshots__/chromium-swiftshader/golden-deskmat-top.png) and [Mouse Pad top view](../tests/browser/__screenshots__/chromium-swiftshader/golden-mousepad-top.png). Grid lines stay straight and perpendicular; the mouse pad crops the landscape image horizontally without compressing the cells. Both product silhouettes have the specified physical proportions. The initial demonstration stretch limitation is superseded by the aspect-preserving print pipeline.

Nine focused browser tests passed for PNG drag/drop, real JPEG/WebP decoding, corrupt/unsupported files, all aspect-ratio fixtures, image controls, edit gestures, product preservation, and original/GPU resolution. Independent red-circle pixel bounds remain within 0.93–1.07 in Cover and Contain for both products. Explicit Stretch on Mouse Pad produces the expected approximately 0.395 width/height ratio. Original 8192 × 4096 pixels retain 231 DPI while GPU preview changes from 4096 × 2048 to 2048 × 1024; 32 × 16 pixels show Very Low / 1 DPI.

A release audit then found a stale import transaction: a late GPU decode could replace the artwork after a newer invalid file failed. The renderer now invalidates pending decodes before validation starts. The added regression delays the real browser decoder after validation, imports the corrupt second file, releases the first decode, and checks the committed filename, source dimensions, and rendered pixels all remain unchanged. This regression passed. The expected error toast is dismissed through its real close button before comparing canvas pixels.

## 2026-09-15 — Material and color manual review

QA opened and inspected all ten requested rendered scenes: both Desk Mat and Mouse Pad top/perspective, Desk Mat low angle, sewn edge close-up, fabric close-up, dark print, white print, and color patches. These are original fixtures imported through the production project/image paths and rendered by real WebGL2.

- The full mat fits all standard product views. Low angle exposes a continuous thin rubber side wall. A faint floor/background horizon remains at this angle; it does not obscure the product.
- The sewn edge shows repeated thread relief following the border. The fabric close-up has restrained fine weave; the surface stays matte and has no glass-like specular highlight.
- Dark artwork retains surface shading; white artwork stays distinguishable from the background and side wall. Color patches have correct orientation, monotonic gray values, and distinct primary colors.
- The color oracle independently projects physical patch centers through the observed camera and checks primary channels plus the sRGB→linear→ACES→sRGB gray response. It does not assume illuminated gray must equal its source byte value.
- All three cloth presets produce actual RGB pixel changes. Fine weave changes can be less than 8 byte levels, so microtexture uses mean absolute RGB difference rather than the camera-motion threshold. Four environment presets change actual surface pixels.

Candidate generation and functional checks passed for all ten scenes, all cameras, scale references, turntable, and actual WebGL loss/restoration. Final deterministic comparison and the interrupted-camera regression are recorded below once complete. Changing development FPS text is hidden only during test screenshots; no renderer state or shader is substituted.

### Final candidates and camera audit

The final candidate run passed all 16 rendering/startup tests in 5.9 minutes. It includes the additional camera regression: start below the mat, request perspective, then interrupt with a real orbit drag. The camera remains below and the dark rubber silhouette is still visible; an opaque floor cannot cover it. All ten feature scenes and three intentional updated startup baselines were generated without the changing FPS text. Ordinary comparison is the remaining screenshot gate.

## 2026-09-15 — Persistence/export functional and native workflow: PASS

Browser checks passed project download → page close → new page → project upload, preserving embedded original pixels, product, layout, material, edge, environment, rotation, and camera image. Screen and high-resolution PNG outputs have real nonempty image pixels, the expected dimensions (high longest side 3840), no UI text, and restore the viewport size afterward. Invalid projects keep the previous artwork. Settings/help focus trapping, Escape focus restoration, and save/H shortcuts from a focused range passed.

The final **production** EXE passed the complete native workflow in 16.5 seconds (24 seconds including driver startup). The test used the actual Windows Open/Save dialogs, a Cyrillic image filename, a Cyrillic project path with spaces, and a Cyrillic PNG path. It changed to Mouse Pad / Contain / Stitched, saved the embedded source, closed the process, launched the EXE again, restored through Open Project, and exported PNG through the native save dialog. QA opened the resulting native window and raw PNG: source filename/dimensions/DPI and Contain margins are visible in the app; the exported image contains only the lit mat and background.

- Production EXE SHA256: `C3DCE74D662948854602E2A57BC8CCE3AF6F6A4E9A84E190859F59EE0089DBA9`.
- [Restored native window](../tests/visual-evidence/final-native-restored-window.png).
- [Actual native PNG export](../tests/visual-evidence/final-native-export.png).
- [Saved original-containing project](../tests/visual-evidence/final-native-project.matvision).

Test-harness corrections were required for the host's UI Automation tree: common dialogs are nested under the MatVision window and their classic controls report Custom rather than normal UIA Value/Invoke patterns. The helper now discovers their real HWNDs by observed class/automation ID, validates process ownership, and sends standard control messages. No filesystem command substitutes for the application's import, save or export. The test explicitly waits for the asynchronous Rust save to create the file. All QA app/driver processes were closed before the independent GPU performance run.
