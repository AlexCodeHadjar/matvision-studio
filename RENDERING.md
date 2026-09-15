# Rendering

MatVision Studio renders a physical mat with Three.js 0.186.0 and WebGL2 inside the Tauri WebView. Product dimensions cross from millimetres to metres at the geometry boundary. React owns serializable state; `StudioScene` owns GPU resources and the render loop.

## Physical model

### Interactive rolling (0.1.3)

Top and bottom caps use longitudinal strips matching the bevel outline; straight perimeter segments in the bend direction have at most 1.5 mm spacing. X remains linear, avoiding unnecessary subdivision across the width. `MatRollDeformer` retains flat positions/normals and yarn instance transforms, then updates existing GPU buffers from those rest values. Returning to zero therefore does not accumulate geometric drift. Updated CPU geometry is also used for raycasting and shadow rendering.

The roll is an inward Archimedean spiral parameterized by neutral-surface arc length. Radial pitch includes thickness, overlock clearance and an air gap. The starting tangent is aligned with the remaining flat section; the outer radius increases with rolled length. Body and binding positions/normals follow the same mapping. Yarn instances follow the local tangent frame (individual submillimetre yarn cross-sections remain rigid). This is a controlled deformation, not a cloth or collision simulation.

Print UVs remain unchanged. Picking a curved print converts the hit UV back into flat physical coordinates for layout editing. Bounds are refreshed after deformation. The UI provides smooth playback, pause and manual scrubbing; project `rollAmount` defaults to zero for old files, while playback itself is transient.

The body mesh supplies rounded sides and the rubber underside. Its requested thickness is real geometry. A single upper cap at exactly the requested thickness closes the volume and carries the print material. Keep this cap separate from the rubber body; overlapping coplanar caps previously caused a rejected visual regression. A shallow bevel softens the edge without expanding the catalogue footprint.

The upper UV domain is the product's printable rectangle. Image top corresponds to negative scene Z. A custom printable area can give surface coordinates outside 0–1; the print layer clips that region to unprinted cloth. Artwork transforms are inverse transforms evaluated in the fragment shader, so scale, translation and rotation do not rebuild geometry or bake lighting into a texture. The normal map has its own texture transform and never changes image coordinates.

## Fabric

`createFabricMaterial(product, state)` in `src/materials/fabric.ts` returns:

| Member                     | Responsibility                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `material`                 | `MeshPhysicalMaterial` for the sole upper cap.                                                  |
| `update(product, state)`   | Physical texture repeat, preset settings and empirical profile uniforms.                        |
| `setPrintTexture(texture)` | Assign externally owned artwork, or null; update shader defines only when map presence changes. |
| `ownedTextureBytes`        | Estimated bytes for the two generated RGBA8 maps with mipmaps, excluding artwork.               |
| `dispose()`                | Idempotently dispose generated maps and material; never dispose imported artwork.               |

The texture pipeline's `applyPrintLayer` must be installed after the fabric factory. It wraps the existing shader callback and program cache key. The fabric profile hook transforms the sampled base color at `color_fragment`; the print hook replaces `map_fragment`. Each wrapper preserves the previous hook. Profile or layout changes update existing uniforms and do not require shader recompilation.

| Preset        | Base roughness | Normal scale | Tile size | Yarn pitch | Sheen |
| ------------- | -------------: | -----------: | --------: | ---------: | ----: |
| Smooth Cloth  |           0.84 |         0.13 |    2.4 mm |    0.30 mm |  0.12 |
| Fine Weave    |           0.88 |         0.27 |    4.0 mm |    0.50 mm |  0.18 |
| Gaming Fabric |           0.92 |         0.34 |    4.8 mm |    0.60 mm |  0.15 |

Each deterministic 128 × 128 tile models crossed yarns with alternating over/under crossings. Gaming Fabric adds a diagonal pattern. Finite height differences produce tangent-space unit normals. Roughness varies only slightly, from 244/255 to 1. Generated maps have `NoColorSpace`, repeat wrapping, linear filtering and mipmaps. Distant views average away the fine relief; close views reveal structure without displacing the print. Repeats derive from printable-area millimetres, including its offset inside the product.

All top presets have metalness, clearcoat and transmission equal to zero. A modest sheen and reduced dielectric specular intensity avoid a polished coating response. Roughness is `clamp(liveRoughness × profileRoughness/0.88 × presetRoughness/0.88, 0.05, 1)`, then multiplied by the subtle map. With neutral profile and Fine Weave, the live value is unchanged. These are starting material approximations, not measured BRDF data for a named supplier.

`createRubberMaterial(product)` returns a dark, rough, nonmetallic backing with interleaved short diagonal ribs. A deterministic 512 × 512 height tile produces separate albedo, roughness and normal maps. Repeat derives from a 16 mm physical tile; small variations in rib direction, size and surface grain break up the pattern.

In 0.1.1, `createStitchedGeometry` produces a padded binding that wraps the top, side and bottom plus shared yarn geometry, instance transforms and subtle instance colors. Overlock loops follow the rounded perimeter at approximately 0.62 mm pitch; a smaller interlocking chain joins their inner ends. `createStitchedMaterial` owns separate binding and thread materials/maps. Projected stitch size controls detail visibility: instanced yarn is shown above 0.85 screen pixels per stitch, while the continuous binding and its normal pattern remain visible at a distance. Replaced instance buffers, geometries and owned maps are disposed.

## HDR studio lighting

### Placement surfaces (0.1.2)

`createPlacementSurfaceMaterial` owns one reusable set of 512 × 512 albedo, normal and roughness maps. Neutral studio follows the environment floor color; white desk, graphite, oak, walnut and concrete have independent surface colors and roughness. Procedural wood grain and concrete detail repeat at a 0.6 m physical scale. Changing the selection updates the existing textures, and disposal releases all three maps and the material. Their memory is included in scene diagnostics. The `placementSurface` project field is saved and validated; missing values in older projects become `studio`.

The receiver remains a real horizontal plane. The directional shadow camera encloses the product's diagonal plus a margin so the mat can rotate without clipping its shadow. Reduced bias preserves contact for thin products; PCF radius is derived from a 2 mm world-space filter footprint and the selected shadow resolution. Shadow intensity is 0.85. The shadow uses the actual body and binding geometry and is included in normal exports; no baked shadow image is added.

`createStudioEnvironment(renderer, preset = 'neutral-studio', resolution = 512)` generates an original float panorama with radiance greater than 1 and convolves it with `PMREMGenerator`. The input is explicitly Linear-sRGB with `EquirectangularReflectionMapping`. Three's data-texture convention places positive Y at v=1; all broad light panels are above v=0.5. The temporary float input and generator are disposed in `finally`. The scene owns the returned render target.

| Preset         | Intended appearance                                                                   |
| -------------- | ------------------------------------------------------------------------------------- |
| Neutral Studio | Equal RGB radiance, white key light, subdued light gray ground; regression reference. |
| Bright Studio  | Broader, brighter white panels and a lighter floor.                                   |
| Warm Room      | Warm scene-linear illumination and a warm key/floor.                                  |
| Desk Setup     | Slightly cool overhead light, darker neutral floor, restrained room contrast.         |

`getEnvironmentSettings(preset)` returns display name, background/floor colors, key color/intensity/position, environment intensity and exposure for root scene integration. The factory accepts power-of-two panorama widths from 128 through 2048. The PMREM result is a CubeUV atlas; its GPU allocation differs from the source panorama dimensions. Quality switching must dispose the previous target after successfully creating its replacement.

Version 0.1.1 reduces key and environment intensity, exposure and cloth specular/sheen response. Neutral Studio uses key intensity 1.6, environment intensity 0.48 and exposure 0.86. A lower fill light is enabled only when the actual camera is below the mat, revealing the rubber relief. The close-up camera targets a product corner to show fabric and stitching together.

The studio uses a real receiving floor plane and a directional shadow map. `PCFShadowMap` is the supported r186 path; `PCFSoftShadowMap` was removed. The light's radius softens PCF sampling in this version. Small metre-scale shadow bias settings should be judged with both thin and thick products and a low-angle reference view. Do not substitute a painted shadow.

### Floor/background seam

A `Scene.background` Color becomes the renderer clear color and bypasses tone mapping. Fog is blended before tone mapping. Thus identical CSS strings for background and fog can still produce a visible horizon. Root scene integration should use a background surface passing through the same tone mapping as fog, or explicitly transform the linear fog color through the active tone mapper for the clear background. The floor must extend past the visible view, and fog should reach its final color before the camera's far clipping plane. This is an integration requirement, not a property supplied by the environment factory.

## Resource lifetime and recovery

- Dispose replaced product geometries when switching product or thickness.
- Material controllers dispose their generated maps on preset replacement and final teardown. Artwork belongs to the texture pipeline and must be disposed there after replacement succeeds.
- HDR source data can be regenerated deterministically. PMREM pixels are render-target data and must be regenerated after WebGL context restoration; reallocating an empty target is insufficient.
- Fabric and rubber retain their small CPU arrays, allowing Three to upload again after context restoration.
- Root scene integration owns shadow targets, renderer, controls, animation loop, observers, and export render targets.
- Memory estimates describe known texture allocations and mipmap overhead. They are not driver-reported VRAM measurements.

## Verification status

The historical material/environment CPU results belong to 0.1.0. For 0.1.1, production TypeScript/Vite and Windows builds completed, and actual scene renders were inspected during appearance work. Automated suites, golden comparisons and performance measurements were not rerun, following the user's instruction to skip remaining checks. See `docs/visual-review.md` for scope and captures; no formal release PASS is claimed for this revision.

## Primary API references

- [Pinned Three.js MeshPhysicalMaterial source](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshPhysicalMaterial.js)
- [Pinned Three.js MeshStandardMaterial source](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshStandardMaterial.js)
- [Pinned PMREM generator](https://github.com/mrdoob/three.js/blob/r186/src/extras/PMREMGenerator.js)
- [Pinned shadow implementation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js)
