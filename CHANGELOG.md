# Changelog

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
