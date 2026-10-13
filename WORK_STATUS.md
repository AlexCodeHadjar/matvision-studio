# In progress 0.3.0 — reference clothing revision

- User explicitly rejected hoodie/sweatshirt/longsleeve as unlike the supplied DTF photos. Previous 0.3.0 binaries and generic clothing captures are provisional; do not present them as the finished release or update desktop shortcuts yet.
- Mug reference acceptance is complete at 9.0/10 (docs/release/mug-acceptance-0.3.0.md). All seven categories, print areas, independent sides, async bundled model loading, source/project state and PNG functionality are implemented.
- New profiles in catalog.ts now trace the three supplied PNGs using work/clothing-reference/measurements.json landmarks/paths. Individual proportions, lower cuffs, neckline/hood/pocket construction and shallower cloth volume replace the generic inflated pattern. node scripts/bake-catalog.mjs prepares runtime assets.
- Reference cut3 silhouette IoU: hoodie 97.2%, sweatshirt 93.9%, longsleeve 92.7%; contour matching is not visual realism acceptance. Cut5 independent review remains below the requested threshold: 7.7/8.0/8.1. See docs/release/clothing-review-wip-0.3.0.md. Reference measurements are retained in docs/release/clothing-reference-measurements-0.3.0.json; local work captures are excluded from Git.
- Fold fields are authored locally in referenceFoldData.ts/referenceFolds.ts. Front photo cues are no longer transferred to the back; construction details are smoothly masked. Bake sourceHash includes both helper files. Reference photos are not runtime dependencies or albedo sprites.
- Cut6/7 adds separate back drape, physically scaled rib knit, closed cuff edging and sewn neck seams. The hoodie hood topology is being rebuilt as a bag with a front opening after previous bowl-like iterations were rejected. Do not ship provisional binaries before fresh independent acceptance.
- Next: finish hood and clothing review, then final Windows build/resource check and desktop installation. T-shirt asset hashes remain unchanged; accessories and mug are unchanged.
- Source photos: C:/Users/alast/OneDrive/Рабочий стол/DTF — белые заготовки. Files 01_Худи_белый.png, 02_Свитшот_белый.png, 04_Лонгслив_белый.png. The shorter DTF path mentioned by the user did not exist; these are the provided references.

# Current installed release 0.2.2

- Fixed the 28-second UI freeze on shirt selection using build-time garment preparation, asynchronous local loading and a bounded two-model cache. Rendered shirt geometry reduced to 335–353k triangles without changing seams or print placement.
- Native Windows 0.2.2 measured first shirt selection at 1.33 s and return at 0.89 s, with maximum UI long task 508 ms. Targeted loading/retry/race and front/back print checks passed. See docs/release/switch-performance-0.2.2.md.
- Source: outputs/MatVisionStudio. Portable release: outputs/MatVisionStudio-0.2.2. Earlier binaries retained.
- Independent post-optimization review of all 24 shirt captures passed: Gildan 9.1/10, Bella 9.0/10. See docs/release/realism-acceptance-0.2.2.md. Both desktop shortcuts now target the 0.2.2 portable EXE; existing user windows were preserved.

# Earlier realism release 0.2.1

- Hollow shirt geometry, open neck/sleeves/hem, folded collar, inner cotton, independent front/back prints, offline CC0 cotton scan; smooth hollow ceramic mug.
- Independent `/root/realism_reviewer` acceptance R10: Gildan 9.1, Bella 9.0; mug R6 9.0 retained. Detailed report: docs/release/realism-acceptance-0.2.1.md.
- TypeScript/Tauri build, native Windows 0.2.1 switching/local textures and 12-sample front/interior physical photo passed. Full regression and clean-Windows installation skipped.
- Source remains in outputs/MatVisionStudio; portable release outputs/MatVisionStudio-0.2.1. Earlier binaries retained.

# Earlier realism release 0.1.5

User priority: quality first. Weak-PC presets/FPS work deferred. Universal mat and embedded PBR maps/schema v2 approved.

- Implemented: portable fabric/backing PBR, Poly Haven local textures/HDRI, N8AO Ultra, SMAA Ultra, detailed/ultra defaults, macro camera, seam variation, physical photo rendering with all sewn loops.
- Actual integrations: n8ao 2.0.1, postprocessing 6.39.5, three-gpu-pathtracer 0.0.24, three-mesh-bvh 0.9.5, Three 0.186.0. Licenses bundled.
- Passed: 63 targeted unit tests; realtime material/color/export/8-animation checks; UI map save and photo cancellation; browser physical photo.
- Native release PASS 2026-09-22: 0.1.5 on Windows x64 / RTX 3050 Laptop, HDR Poly Haven, stitched mat, 1920x1215 / 128 samples, native PNG save, portable project roundtrip, return to studio, cancel/reopen, macro. No JS/shader errors; local assets only. Evidence: docs/release/native-quality-0.1.5.json.
- Native automation first retry hit a CDP click timeout after PNG export; app had returned to studio. Full repeat passed. No app change was needed.
- Photo hardware: tested Intel UHD/D3D11 corrupts shading and is rejected with an explanation. Windows requests high-performance GPU. RTX passes; other GPUs and native 2560/3840 photos not certified. 4K realtime PNG tested separately.
- Current release binary/installer built. Installed 0.1.5, desktop shortcut updated, normal visible launch confirmed. Installed native photo passed again at 1920x1232/128 samples with shipped GPU selection. Evidence: docs/release/desktop-installation-0.1.5.json.
- Later milestones: fibers, cloth physics evaluation, experimental SSGI. No new physics or denoiser yet; noise at 128 samples is expected. No clean-Windows/full regression or performance acceptance claim.
- Preserve existing 0.1.4 deliverables and prior working-tree changes.

