# Geometry review — first vertical slice

Reviewed 2026-09-15 by the Product Geometry agent. Scope: the two catalogue products, configurable physical thickness, rounded volume, cap UVs, normals and underside. The full rendering checkpoint is owned by QA and includes native smoke evidence.

## Findings and corrections

- Replaced quadratic corner curves with true circular arcs. The 12 mm catalogue radius now describes the actual curved outline.
- Replaced the flat-shaded extrusion with a compact indexed ring mesh. Analytic unit normals join the side wall to a 0.25 mm maximum rounded bevel without visible facet shading. The bevel stays within catalogue dimensions and is additionally limited by thickness and radius.
- Removed the duplicate rubber top cap. QA's initial perspective screenshot showed severe black staircase bands because the fabric plane was only 2 micrometres above the rubber cap. The body now contains the underside and wall; the separate fabric cap closes the top at the exact configured thickness. Shared perimeter positions close the volume without overlap or an epsilon gap.
- Removed duplicate arc endpoints before triangulation. This prevents degenerate sliver faces at curve/line joins.
- Top UVs follow physical coordinates: right = +X; image top = -Z. A custom printable rectangle is represented relative to its millimetre bounds. Values outside that rectangle extend beyond 0–1 for the later print shader to clip. Side/underside vertices remain a separate geometry/material and never receive the user print.

## Automated evidence

`node_modules/.bin/vitest.cmd run src/geometry/mat.test.ts` — **8 tests PASS** (2026-09-15 12:01 local execution).

Tests cover:

- Both 900 × 400 mm and 400 × 450 mm products at 2, 3 and 5 mm thickness, exact SI bounds and resting Y = 0.
- Closed body + print-cap union: every welded edge belongs to exactly two oppositely directed triangle edges; no zero-area faces; positive signed volume within 1% of the analytic rounded extrusion.
- Fewer than 700 triangles per complete mat, without flat-surface subdivision.
- All print-cap UVs match physical X/Z coordinates and orientation; separate cap normals face up.
- True circular corner radius, unit normals and smoothly varying bevel normals.
- Regression guard forbidding a second body cap at the print elevation.
- Custom printable-area mapping, zero-radius product topology, rejected invalid geometry/thickness.

Geometry ESLint and repository TypeScript typecheck passed after the implementation change. Root/QA rerun the combined required gate checks.

## Visual evidence

QA independently inspected the regenerated `vertical-slice-deskmat-perspective.png` and reported: duplicate-cap depth blocker fixed; full grid visible; rounded edges and 3 mm dark rim coherent; first-slice visual geometry approved. The screenshot baseline and complete visual report are owned by QA in `docs/visual-review.md`.

## Scope boundaries

This review does not certify final PBR realism or stitched-edge close-ups. Those belong to later gated milestones. Standard geometry currently supports the separate rubber body and cloth top. The physically tiny bevel uses two angular segments; extra subdivision is unnecessary for this gate.
