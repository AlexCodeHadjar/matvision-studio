# Rendering review

Date: 2026-09-15. Reviewer: Rendering specialist. Scope: initial Three.js WebGL2 vertical slice. This review does not approve final fabric realism, the full color milestone, or a native release.

## Inspected evidence

The corrected browser screenshot at `tests/browser/__screenshots__/chromium-swiftshader/vertical-slice-deskmat-perspective.png` was opened and inspected directly. It shows readable print artwork across the complete mat, a thin dark side, rounded corners, a continuous upper surface, and a narrow floor-contact shadow. The previous black top-cap interference is absent. Fabric microstructure is not yet implemented, and this distant view cannot establish a realistic weave or stitched edge. This image predates the overhead-HDR correction below, so QA must capture and inspect its replacement.

The source review used the exact installed Three.js 0.186.0 implementation, especially `DataTexture.js`, `PMREMGenerator.js`, `LightShadow.js`, `WebGLRenderer.js`, and shader chunks. The official [Three.js documentation index](https://threejs.org/docs/) was consulted; detailed documentation page requests returned 404 on this host. Version-locked local source is the API evidence for the findings below.

## Findings and corrections

| Item                 | Finding                                                                                                                                                                                                                                                                                 | Disposition                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HDR orientation      | `DataTexture.flipY` is false. Three's `equirectUv` maps positive Y to v=1, but the initial softboxes occupied v=0.12–0.32. The intended ceiling lights therefore illuminated the lower hemisphere.                                                                                      | Corrected narrowly: the generator stores softboxes at v=0.68–0.88 and brighter base radiance toward positive Y. A CPU regression test integrates latitude-weighted hemisphere radiance and requires upper illumination to exceed lower illumination by 2×.                        |
| Context restoration  | CPU-backed fabric can upload again, but PMREM is a rendered GPU target whose pixel contents are lost with the context. Reusing its JavaScript texture object does not regenerate those pixels.                                                                                          | Corrected narrowly: context restore generates a fresh PMREM, assigns it to the scene, disposes the old target, and resumes rendering. Three retains shadow renderer settings itself during restoration. A later browser context-loss test must verify the actual recovered image. |
| Geometry integration | One body supplies sides/bottom; the print mesh supplies the only upper cap at exactly the requested thickness. Shared material objects survive product geometry replacement.                                                                                                            | Correct for this slice. No extra print elevation or overlapping rubber top should be introduced later. Body UVs are not continuous perimeter coordinates, so stitched side normals will need suitable geometry UVs or a separate procedural strategy.                             |
| Resource ownership   | Rebuild disposes replaced body/top geometries. Scene teardown disposes all current geometries, three materials, canvas texture, PMREM target, shadow map, controls/listeners, observer, animation loop, and renderer. Temporary HDR and PMREM generator are disposed after convolution. | Normal lifecycle is coherent. Image replacement, asynchronous decoding races, preset environment replacement, export targets, and constructor-failure cleanup still need coverage when those features exist.                                                                      |
| Current shadow API   | `PCFShadowMap` is current. r186's shader applies `LightShadow.radius`; radius 3 is valid. The removed `PCFSoftShadowMap` constant is absent. The 2.2 m shadow span gives about 1.07 mm per texel at 2048.                                                                               | Correct for initial contact shadow. Review low-angle, close-up and both thickness extremes before approving final shadows. Do not overstate distant screenshot evidence.                                                                                                          |
| Color workflow       | Canvas color texture is explicitly sRGB; linear HDR is explicitly Linear-sRGB; renderer outputs sRGB with one ACES tone mapping step at exposure 1. Normal/roughness maps do not yet exist.                                                                                             | Structurally correct. CPU tests only guard settings; gray and saturated color fixtures must validate rendered pixels in the color milestone. The slightly warm key color must be reconsidered for the neutral regression preset.                                                  |
| Diagnostics          | Texture memory currently counts only the fixed initial artwork, omitting PMREM and the shadow target. It cannot represent future imported texture dimensions.                                                                                                                           | Replace with allocation-based estimates in the performance implementation. Label estimates as estimates; WebGL does not expose exact per-process VRAM usage.                                                                                                                      |

## Narrow correction validation

- `node node_modules/vitest/vitest.mjs run src/scene/environment.test.ts src/color/ColorPipeline.test.ts`: 2 tests passed.
- TypeScript `tsc --noEmit`: passed.
- ESLint on the three modified scene/test files: passed.
- Prettier check on the same files: passed.

The native binary and browser baseline require rebuilding after these corrections. The Rendering specialist has frozen source edits pending that gate.

## Proposed full-material boundary after the vertical gate

Use the existing serializable `ProjectState`, `ProductDefinition`, `MaterialPreset`, and `CalibratedMaterialProfile` contracts. No new persisted shape is needed.

The proposed factory is `createFabricMaterial(product, state)` returning a controller with:

- `material: MeshStandardMaterial`, assigned to the sole upper cap.
- `update(product, state)`, applying preset normal strength, physical weave repeat, roughness and empirical profile parameters without rebuilding geometry.
- `setPrintTexture(texture: Texture)`, assigning the texture owned by the scene's import pipeline; the fabric controller must not dispose externally owned artwork.
- `dispose()`, releasing the controller's normal/roughness textures and material exactly once.

Three small deterministic tangent-space normal maps can express Smooth Cloth, Fine Weave, and Gaming Fabric. Repeats derive from physical product dimensions and millimetres per weave tile, independently of the print's layout. Color textures remain sRGB; normal/roughness data remain `NoColorSpace`. Normal maps change lighting normals only and must never displace print UVs. All top presets use metalness 0 and matte roughness. Use separate dark rubber material and its own weak procedural pattern for sides/bottom.

Print texture composition and import ownership remain in the root's texture integration. If shader hooks are required for clipping and empirical profile compensation, the modules must explicitly compose `onBeforeCompile` hooks and a stable shader cache key; assigning a second hook must not silently replace the first. Compensation belongs before lighting in linear working space, with the UI identifying it as empirical material compensation rather than ICC proofing.

Environment presets should share a factory driven by `EnvironmentPreset` and a quality-dependent resolution. A replacement must be created successfully before swapping and disposing the previous PMREM. Context restoration must regenerate the currently selected preset. Root scene integration owns lighting intensity, floor/background settings, references, quality, and export resources unless that ownership is explicitly reassigned.

## Required visual cases for later approval

Capture both products with gray patches, color patches, black and white artwork, an aspect grid, and a real image. Review perspective, top, low-angle, close-up and underside with fixed exposure and a neutral environment. Check cap continuity, silhouette, millimetre thickness, print orientation/ratio, contact shadows, matte response, subtle weave at close distance, stitched-edge detail, and clean minification. Compare all three cloth presets at matching camera and lighting. Browser SwiftShader baselines verify regressions; native hardware captures and measured timings establish the desktop and performance evidence.
