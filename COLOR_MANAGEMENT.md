# Colour management

`src/color/ColorPipeline.ts` configures the pipeline in one place.

1. Colour/albedo textures are tagged sRGB.
2. Three.js decodes colour inputs to its linear working space for PBR lighting.
3. HDR environment radiance is linear-sRGB floating-point data; it is not gamma-decoded.
4. ACES filmic tone mapping uses explicit exposure 1 for the neutral reference scene.
5. Output conversion to sRGB happens once in the renderer.

Normal/roughness data must stay in NoColorSpace. Do not add manual gamma correction to
material shaders or convert the output again. CPU tests guard colour-texture tagging,
renderer output colour space and tone mapping configuration. Test fixtures include gray,
black, white, RGB and colour patches. Visual verification evidence belongs in the review log.

## Studio Preview and print proof

Studio Preview represents the material under selected lighting. It is not an ICC soft proof.
The architecture defines empirical supplier/material compensation separately, with brightness,
saturation, contrast, black level, surface tint and roughness. A profile must retain its identity
when a project is saved. The default neutral profile is explicitly uncalibrated.

A future native ICC transform must use measured printer/ink/fabric profiles and a known
rendering intent. Do not label a saturation reduction or material tint as Print Proof.
Monitor calibration and viewing illumination also affect comparison with a physical print.
