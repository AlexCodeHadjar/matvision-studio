# Color management

MatVision Studio provides **Studio Preview**: a physically shaded approximation of artwork on cloth under chosen illumination. It does not provide ICC Print Proof in this version.

## One linear working pipeline

1. Decode the imported PNG/JPEG/WebP through the image pipeline, preserving original encoded source and source pixel dimensions separately from the GPU preview.
2. Mark artwork color textures as `SRGBColorSpace`. WebGL/Three decode sRGB sample values into linear RGB once.
3. Apply the optional empirical material profile to sampled linear base color, before PBR lighting.
4. Evaluate PBR lighting in Three's Linear-sRGB working space. Generated HDR radiance is explicitly `LinearSRGBColorSpace`; its values above 1 represent radiance, not encoded display pixels.
5. Apply ACES Filmic tone mapping with an explicitly selected exposure.
6. Encode the final display result to sRGB through `renderer.outputColorSpace = SRGBColorSpace`.

Normal and roughness maps are non-color data and retain `NoColorSpace`. Do not gamma-correct these maps. Do not pre-apply a display gamma curve to artwork, add a second manual sRGB decode to shader sampling, or add an output shader conversion after the renderer already encodes sRGB.

The built-in image decoder's handling of embedded image profiles is distinct from printer proofing. The scene receives an sRGB preview texture; this is not a conversion through a printer/ink/fabric ICC profile. Wide-gamut/HDR source artwork is outside the declared ordinary PNG/JPEG/WebP sRGB preview workflow until that decode path is specifically verified.

## Material profile

The default profile is named `Neutral Cloth (uncalibrated)`. Its brightness, saturation and contrast are 1, black level is 0, surface tint is white, and roughness is 0.88. The neutral color settings are identity transforms.

`src/materials/profile.ts` applies the following empirical operations in linear RGB:

- Compute luminance with Linear-sRGB coefficients 0.2126, 0.7152 and 0.0722.
- Mix that luminance with the source according to saturation.
- Adjust contrast around 18% linear gray.
- Multiply brightness and the surface tint, with the tint converted from its CSS sRGB representation into linear RGB by `Color`.
- Clamp base-color reflectance to 0–1, then lift the black endpoint by the requested black level.

The profile's roughness scales the live material control relative to neutral roughness 0.88. Presets also contribute a relative roughness factor. These controls are useful for a supplier's measured visual compensation, but the included neutral profile has no supplier measurements and must retain its uncalibrated label. Store the profile name and parameters with the project.

Texture placement is independent from these controls. The print layer calculates inverse placement UVs and clips both the printable rectangle and artwork bounds. Transparent source pixels represent unprinted fabric, preserving the opaque physical surface. Profile compensation follows that sampled cloth/print base color before illumination.

## What a preview can establish

The studio shows product dimensions, crop, perspective, fabric response, shadows and the chosen illumination's effect on perceived color. Neutral Studio provides equal RGB environment radiance and a white key for regression testing. Warm Room and Desk Setup intentionally change illumination color. Bright Studio changes illumination magnitude and floor appearance.

An sRGB patch rendered as lit cloth will generally differ from its original flat pixel value because lighting, reflectance and tone mapping alter appearance. A valid gamma test must use known expected pipeline behavior rather than requiring every rendered patch to equal its source byte. The CPU tests guard color-space settings, identity compensation, zero-saturation neutrality and black-level behavior. Actual gray/color-patch scenes must still be visually and numerically reviewed for double conversion, obvious neutrality errors and clipping.

ACES is the initial explicit tone-mapping choice. It must be evaluated with black, white, gray and saturated fixtures in the integrated renderer before the color checkpoint is approved. Preserve chosen exposure across the reference comparisons. Do not hide color errors with bloom, cinematic depth of field or contrast effects.

## Future measured print proof

A future ICC path should be an explicit native color-transform service using a supplied printer/ink/substrate profile, rendering intent and any required proof conditions. It should produce a distinct proof texture while preserving the original image. Profile availability and transform capability must be explicit; empirical brightness/saturation controls must never be presented as ICC conversion.

Even a measured workflow also depends on the printer, ink, fabric, viewing illumination and monitor calibration. This version reports the chosen studio/profile parameters and does not promise an exact print match.

## Primary source references

- [Pinned sRGB texture sampling path](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/map_fragment.glsl.js)
- [Pinned ACES implementation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js)
- [Pinned Three color management implementation](https://github.com/mrdoob/three.js/blob/r186/src/math/ColorManagement.js)
