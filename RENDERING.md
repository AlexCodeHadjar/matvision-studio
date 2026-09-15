# Rendering

## Coordinate system and geometry

Scene units are metres. X spans product width, Y is up, Z spans product height.
The floor is Y=0. Catalogue thickness is passed into geometry generation, never hardcoded
as a hidden geometry constant. Product scale is not changed to frame the camera.

The print uses its own top surface UVs. The rubber body does not inherit the user image.
Rounded corners, bevel and thickness are actual geometry. No photograph, CSS perspective,
shadow image or perspective-warped canvas represents the product.

## Lighting

The neutral studio environment is an original procedural floating-point equirectangular
HDR radiance map with three broad softboxes. It includes scene-linear radiance above 1.0.
PMREM prefilters it for material roughness. This avoids external asset downloads or
copyright-dependent environment assets in the installed product. A directional key adds
contact shadows; the matte floor is a real receiving mesh.

Three.js r186 removed PCFSoftShadowMap; the renderer uses supported PCFShadowMap.
No bloom, depth of field or cinematic postprocessing is applied.

## Resource ownership

StudioScene owns renderer, OrbitControls, resize observer, animation frame and GPU resources.
Disposal removes listeners, cancels frames, disposes geometry/material/texture/environment
and shadow render targets. User image resources will follow the same ownership rule.

## Verification

CPU geometry tests inspect physical extents and UV coordinates. Screenshot and interaction
tests inspect actual rendered pixels as well as read-only geometry/renderer diagnostics.
Golden screenshots must be visually reviewed before acceptance. See docs/visual-review.md.
