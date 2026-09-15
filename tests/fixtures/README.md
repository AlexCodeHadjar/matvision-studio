# Original synthetic fixtures

Run `pnpm test:fixtures` to regenerate all PNGs byte-for-byte using only Node built-ins. `manifest.json` records dimensions and encoded size. These images were created for this repository and may be used under the repository license.

The grid uses square cells plus a red left/right border and blue top/bottom border, exposing aspect distortion, mirroring, UV flips and cropping. Fixtures include exact 900:400 aspect, square, portrait, panorama and very tall images. The 8192 × 4096 image exercises texture downsampling; the 32 × 16 image exercises low DPI warnings.

`gray-50-srgb.png` is encoded sRGB 128 (approximately 0.216 linear), not 0.5 linear. The patch chart includes both 128 and 188, allowing a double gamma transform to be spotted. Black, white and transparent RGBA fixtures exercise cloth response and alpha compositing. All PNGs explicitly carry an sRGB chunk.

JPEG/WebP import fixtures can be encoded from these original pixels by the browser test fixture helper once the import milestone is reached. No real user images are checked into the repository.

`uv-circle.png` adds a red circular disk to a teal grid. Browser tests measure its rendered bounding box independently: Cover and Contain preserve a circle on either physical product; only explicit Stretch may distort it. JPEG/WebP variants are now actually encoded by the browser helper and imported through the same file input as user artwork.
