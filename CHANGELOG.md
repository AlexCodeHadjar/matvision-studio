# Changelog

## 0.1.5 — 2026-09-22

- Quality-first defaults: ultra/detailed, full-resolution N8AO Ultra, SMAA Ultra and up to 4x MSAA with pinned N8AO 2.0.1 and postprocessing 6.39.5. One linear/ACES/sRGB viewport/PNG pipeline. Static shadow caching preserves quality; moving poses refresh shadows.
- Added three-gpu-pathtracer 0.0.24 and three-mesh-bvh 0.9.5 photo mode: progressive 10-bounce MIS, baked custom print, expanded stitched loops, HDRI/studio lighting, cancellation and PNG. Local CC0 Poly Haven 2K cloth maps and studio HDRI ship with attribution. Photo settings are session-only.
- Added portable color, normal, roughness and height maps for fabric and backing, physical tile size and OpenGL/DirectX normal convention. Original print stays separate. Imports are bounded to 8 MiB/16 Mp per map and 2048 px GPU previews. Height adds shading detail, not geometric displacement.
- Added independent fabric weave/relief/sheen and rubber relief controls, a macro camera, deterministic yarn variation and seam LOD hysteresis.
- Project schema v2 reads v0/v1 and embeds all maps. Opening a project decodes artwork and materials before committing either. Corrupt maps preserve the previous scene. Previous app versions do not read v2.
- Targeted validation includes color parity, material round-trip/failure rollback, eight animation poses, resource lifetime, 4K PNG and UI import/save/reopen/remove/export. No full regression, clean-Windows certification or RTX benchmark. See REALISM.md and release evidence.


## 0.1.4 — 2026-09-22

- Added eight transient material demonstrations: corner lift, soft travelling wave, table placement, full flip, two-sided roll, stitched-edge camera flyby, moving studio light and fabric/backing layer reveal.
- Added a compact two-column animation launcher with active-state feedback and a shared pause action. Starting another animation safely restores the previous camera, light, layer offsets and saved roll position first.
- Showcase playback remains transient and does not alter `.matvision` project data. Product/environment rebuilds, component disposal and manual stopping restore the exact project pose.
- Refined the two-dimensional mat mesh, arc-based corner bend, loop orientation, progressive table contact, collision-free flip, separated opposing rolls and closed backing during layer reveal. Camera orbit remains available during material demonstrations; the edge tour controls the camera temporarily.
- Validation: TypeScript, targeted ESLint, 12 geometry/deformation tests, native Windows build and eight rendered WebGL2 scenario captures in installed Edge. Verified restoration of geometry, camera, rotation, light and layer visibility for every scenario. Full regression, performance benchmarks and clean-Windows checks were intentionally skipped.

## 0.1.3 — 2026-09-15

- Added interactive “Скрутить”, “Раскрыть”, “Пауза” controls and a 0–100% roll-position slider. A full transition takes 3.5 seconds with smooth acceleration/deceleration. Camera orbit remains available.
- Replaced fan caps with longitudinal strips and subdivided binding edges for continuous bending. An arc-length spiral accounts for mat thickness and seam clearance; print UVs stay attached to the surface, backing and seam bend together, and real shadows follow the geometry.
- Roll position is saved in projects; older projects open flat. Playback stops for file operations and product changes. Print dragging uses the undeformed UV position, including on a paused curl.
- TypeScript/Vite compilation and informal browser appearance/button checks completed. Full regression and benchmark suites remain skipped at the user's request. No video-export feature was added.

## 0.1.2 — 2026-09-15

- Added “Поверхность под ковриком” in the material/light panel: neutral studio, white desk, matte graphite, light oak, dark walnut and light concrete.
- Placement surfaces use reusable color, normal and roughness maps at a fixed physical scale, and appear in PNG exports. The selection is saved in the project; older version 1 projects default to the studio surface.
- Tightened the real directional shadow map around the product and tuned bias and filtering for a small, soft contact shadow. The shadow follows the mat during rotation and thickness changes; the floor still hides when viewing the underside.
- Production frontend type checking/build completed. Full regression and performance suites remain skipped at the user's request.

## 0.1.1 — 2026-09-15

- Rebuilt the stitched edge as a padded wrap with dense, instanced overlock loops and an interlocking needle chain. Close views reveal yarn geometry; distant views use the binding normal pattern.
- Added dark rubber backing with short interleaved diagonal ribs, separate albedo/roughness/normal maps, and physical texture repeat.
- Softened studio lighting and reduced cloth specular response to retain print saturation. A fill light reveals the backing when viewed from below.
- Moved the close-up camera target to the product corner so the edge and fabric are visible together.

Production TypeScript/Vite and Windows release builds completed. Remaining automated regression, performance and clean-machine checks were skipped at the user's explicit request. Appearance captures are recorded in `docs/appearance-0.1.1/`; they are not a formal release acceptance.
