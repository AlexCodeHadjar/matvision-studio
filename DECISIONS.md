# Realism decisions

- D01: Keep Three.js/WebGL2 for release A. Optional fast/detail modes; no new AI API.
- D02: User confirmed a universal realistic mat, with neutral soft light (2026-09-22).
- D03: User confirmed embedded portable material maps and project schema v2 (2026-09-22). Original print is separate. Eight maps maximum, 8 MiB / 16 Mp each, GPU previews bounded to 2048 px. Older v0/v1 projects migrate; old apps reject v2.
- D04: A dependency is accepted only after rendering the current custom print shader and deformed geometry correctly.
- D05: Existing 0.1.4 source/installers remain available for rollback. Do not alter previous deliverables.
- D06 (revised by user): Prioritise image quality, defer FPS tuning. Detailed/ultra defaults, full-resolution N8AO Ultra, SMAA Ultra and supported 4x MSAA. Same linear/ACES/sRGB pipeline for PNG. Static shadow caching does not reduce quality.
- D07 (revised): Bundle local CC0 Poly Haven fabric maps and a studio HDRI alongside procedural materials. Height maps affect shading, not geometry. Add three-gpu-pathtracer photo rendering with every stitched loop expanded and custom print baked. Measured cloth physics and SSGI remain later milestones.
- D08: No external AI calls, asset uploads or telemetry. Pin dependency versions and preserve upstream licenses. N8AO package metadata says ISC while its distributed LICENSE is CC0; ship the actual notice unchanged and disclose this discrepancy.
