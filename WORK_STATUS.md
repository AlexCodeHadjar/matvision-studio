# MatVision Studio 0.1.6

Windows x64 build and installer completed on 2026-09-23. Version 0.1.6 adds a transient Scene Core and an experimental five-softbox realtime lighting option, off by default. No weak-PC/FPS presets were added. `.matvision` remains v2; the separate Photo path tracer is unchanged.

Native Windows/WebView2 smoke: runtime reports 0.1.6; 0.1.5 and 0.1.6 Studio frames with the option off match pixel-for-pixel at the same camera and 1420 × 911 viewport. Enabling the rig changed 35.45% of pixels, disabling it restored the exact baseline. With the option enabled, Photo completed 128 passes and returned to Studio without JavaScript errors. The 0.1.6 NSIS installer exited successfully and the installed executable reports version 0.1.6. Details: `docs/release/native-quality-0.1.6.json`. This is targeted validation, not a clean-Windows or full-GPU certification.

## Previous release: 0.1.5

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


## GitHub publication · 2026-09-23

Complete 0.1.5 source snapshot prepared for AlexCodeHadjar/matvision-studio with illustrated README, user/developer guides, roadmap and sourced comparison. Local publication checks: typecheck, lint, frontend build and 156 CPU tests passed. Exhaustive geometry test timeout raised to 30s without changing assertions. Application runtime code unchanged from the tested 0.1.5 binary. Personal Windows paths in historical reports anonymized. Automatic CI checks frontend/CPU; historical browser/native workflows remain manually selectable and are not claimed as newly passed.
