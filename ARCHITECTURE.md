# MatVision Studio architecture

## Scope and current state

MatVision Studio is a Windows desktop application: Tauri 2 owns the native window and file integration; React/TypeScript owns application state and UI; Three.js owns a real-time WebGL2 scene. Version 0.1.7 includes portable PBR materials, N8AO/postprocessing, a transient renderer-independent Scene Core, experimental realtime area lights, a separate path-traced Photo backend, and an optional local Blender/Cycles Ultimate prototype. See [the renderer capability matrix](docs/RENDERERS_0.1.7.md) and WORK_STATUS for the verified scope. Contracts describe the required final behaviours; an unimplemented operation must report that limitation, never return a fabricated success.

## Module boundaries

| Module         | Owns                                                                    | Must not own                                   |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `app`          | Bootstrap, global error boundary, development logging                   | Mesh or shader construction                    |
| `ui`           | React controls, viewport host, user-facing feedback                     | Three.js render loop                           |
| `scene`        | Renderer, scene lifecycle, lighting, export render, diagnostics         | Native file dialogs or project parsing         |
| `products`     | Physical catalogue, mm → metre conversion, printable rectangles         | React, Three.js or native calls                |
| `geometry`     | Volume meshes, rounded corners, separate top/side/bottom regions        | Image decoding or global UI state              |
| `materials`    | Cloth, rubber, stitched surface, material resource disposal             | User file access                               |
| `textures`     | Original source acquisition/decoding, bounded GPU preview preparation   | Modifying original dimensions to match preview |
| `print-layout` | Pure cover/contain/stretch transforms, crop and effective DPI           | GPU or DOM assumptions                         |
| `camera`       | Perspective camera, bounded OrbitControls, smooth presets               | Project file I/O                               |
| `color`        | sRGB input, linear lighting, sRGB output, material compensation         | Claiming ICC proof without an actual transform |
| `project`      | Default state, validation, versioned serialization/migration            | DOM, renderer or native side effects           |
| `native`       | Typed Tauri calls for file read/write, dialogs and platform integration | Rendering                                      |
| `tests`        | Synthetic fixtures, interaction/native E2E, golden scenes               | Features                                       |

`src/contracts.ts` is the dependency-free integration boundary. Leaf modules import its types. React communicates with rendering through `SceneController`; Rust is never on the rendering hot path.

## Coordinates and dimensions

- Scene units are SI metres. Product catalogue values are millimetres, converted exactly once at the geometry/camera boundary.
- X is product width; Y is vertical; Z is product depth. A resting product spans Y = 0 to its configured thickness. The floor is at Y = 0 with a small renderer-side separation only where required to prevent depth fighting.
- Seen from above with the image upright, the image's top maps to negative Z and its right maps to positive X. UV `u` increases right and `v` increases toward image top. Top artwork must never be shared with side/bottom UVs.
- `printableArea` is an axis-aligned rectangle in millimetres measured from the product's top-left corner, clipped by the physical rounded perimeter. `bleedMm` is artwork allowance beyond trim and does not change mesh dimensions or the DPI calculation for the trimmed printable area.
- A layout offset of +1 moves artwork by one printable width/height. Positive Y offset moves toward image top (negative scene Z); positive rotation is counterclockwise viewed from above. Scale = 1 means the selected fit mode's baseline. Cover and contain preserve aspect ratio; stretch is explicitly independent X/Y scaling.

## Product catalogue

The initial registry defines `deskmat-900x400` (900 × 400 mm) and `mousepad-400x450` (400 × 450 mm). Both default to 3 mm thickness and 12 mm corner radius. Thickness remains state, passed into geometry; generators must not hardcode it. Catalogue lookup rejects unknown product IDs. New products require a catalogue entry and matching tests, not new renderer branches.

## State and render ownership

React owns a `ProjectState`. `SceneController.update(state)` applies synchronous scene settings; its implementation diffs relevant fields so an unrelated roughness change does not reset the camera or reconstruct all resources. `setPrintSource(source)` explicitly decodes and replaces artwork, returning actual preview resolution. The most recent request wins; decode failure keeps the last valid displayed image. The caller commits a new source to project state after success.

OrbitControls owns transient camera motion. Before project save, the caller snapshots `getCameraState()` into the serializable state. Preset selection is explicit through `setCameraPreset`; restored camera coordinates are applied when a project opens. `exportPng` renders the scene alone at the requested pixel dimensions and restores the interactive renderer's settings even on failure.

The renderer owns every geometry, material, texture, environment target, controls object and event listener it creates. Replacements and `dispose()` release them. Texture decode cancellation must also release decoded resources from stale requests. A single requestAnimationFrame loop serves a mounted viewport. Context loss is surfaced in diagnostics and a recovery flow rebuilds owned GPU resources from retained CPU state.

## Portable project files

`project/index.ts` exports `createDefaultProject`, `validateProjectState`, `serializeProject`, `parseProject` and `migrateProject`. A document has `{ format: "matvision-project", version: 2, state }`. Versions 0 and 1 migrate into v2; version 0 is the internal bootstrap schema with optional settings; migration supplies defaults and then validates. Unknown future versions are rejected with an actionable message.

Source images embed their original bytes as PNG/JPEG/WebP base64 data URLs with filename, MIME type and original pixel dimensions. This makes reopening independent of the original path. Preview resolution and GPU resources are runtime data and are never substituted for original dimensions. Parsing validates structure, enumerations, finite numeric ranges, known product IDs, source MIME/header, camera shape and colour profile values. File length is bounded to 256 MiB of JSON characters before parsing; decoding limits are a separate texture/native concern. Format validation is not proof that image bytes decode successfully.

The native layer performs actual reads/writes and file dialog operations. It must save atomically where possible and preserve the current project until open/decode succeeds. External telemetry is absent; structured development logs must omit embedded artwork and sensitive file paths.

## Colour and material boundary

Colour textures are sRGB; normal/roughness maps are non-colour data. Lighting calculations occur in linear space and renderer output is sRGB with one deliberate tone-mapping pass. Golden gray/colour-patch scenes guard against accidental double gamma or disabled colour management. Cloth microstructure modifies normals and roughness independently of artwork UVs.

`CalibratedMaterialProfile` stores a supplier/material identifier, brightness, saturation, black level, surface tint, contrast and roughness. The neutral default is explicitly uncalibrated. These parameters are empirical Studio Preview compensation, not Print Proof. Actual ICC printer/ink/fabric transformation belongs behind a future native colour-transform interface and is labelled Print Proof only after verified support.

## Validation and gates

Pure product/state/math tests run without GPU. Browser interactions test the UI and renderer; native WebDriver smoke tests run the built Tauri executable and verify the shell integration. Neither suite substitutes for the other. Deterministic screenshots pin product, camera, neutral environment, material, fixture, exposure, viewport and pixel ratio. Rendering gates also require visual inspection recorded in `docs/visual-review.md`. Unit compilation alone never earns PASS.

Before release, quality/memory checks exercise 4K and larger sources, repeated texture replacements, and clean resource teardown. A separately reviewed release checklist covers native save/open/export, installer install/uninstall, Unicode/space paths and clean-machine operation. Evidence must distinguish measured outcomes from unperformed checks.
