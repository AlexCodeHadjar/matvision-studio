# Performance evidence

Status: **resource lifecycle PASS**. Final foreground hardware measurements are pending an
idle host after native compilation. No startup sample or software-rendered FPS is presented
as performance acceptance.

## Environment

The environment audit identifies Windows 11 build 26200 x64, Intel Core i5-12450H, Intel UHD
Graphics and an NVIDIA GeForce RTX 3050 Laptop GPU. The benchmark records the **active** WebGL
adapter independently; the presence of a discrete GPU does not prove the renderer uses it.

## Corrections from review

The initial texture estimate omitted cached default artwork after importing a print and omitted
ruler labels retained while hidden. The integrated helper includes both. It sums actual mip
dimensions instead of assuming a fixed 4/3 factor for all aspect ratios. Three's render target
disposal releases texture attachments internally, and its Sprite geometry is a shared engine
quad; the lifecycle harness observes the resource owner and does not misclassify these as leaks.

Three CPU-only tests pass for square/NPOT/thin texture mips, retained sample/label storage and
invalid input handling. The performance harnesses pass TypeScript and ESLint checks.

## Resource lifecycle — PASS

Measured 2026-09-15 in the actual frozen `StudioScene`, using full pinned Chromium. This test
ran while native compilation was active; its frame rate is intentionally not used as evidence.

| Check                                                  | Observed result                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 12 alternating 8192 × 4096 / 1800 × 800 source imports | 17 GPU texture objects after every swap                                             |
| 12 product/material/HDR/quality changes                | 16/17 textures, following the different ruler label counts; 7 geometries throughout |
| Shader program variants                                | Warmed to 16 and stayed at 16 throughout the second cycle                           |
| Overlapping imports                                    | Latest request retained; superseded result discarded                                |
| Context loss/recovery                                  | Recovered rendering and retained source dimensions                                  |
| Dispose while decode pending                           | Late result discarded; canvas removed                                               |
| Application resource disposal events                   | All 302 observed owned resources disposed                                           |
| Actual WebGL texture handles                           | 169 handles observed; **0 remained valid** after disposal                           |
| Unexpected scene/browser errors                        | 0                                                                                   |

The Three allocation counters after disposal still read one geometry and one texture; these
counters are not GPU driver allocations. The shared Sprite quad is engine-owned, all observed
application textures fail `gl.isTexture` after shutdown, and all owned render targets have
emitted disposal events. The audit does not claim exact driver VRAM usage.

Raw evidence: [resource-lifecycle.json](resource-lifecycle.json).
