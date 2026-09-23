import { PNG } from 'pngjs';
import type { SceneDiagnostics } from './scene-diagnostics';
type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Independent camera projection of a physical top-surface point, not app UV code. */
export function projectPrintPoint(
  scene: SceneDiagnostics,
  u: number,
  v: number,
  width: number,
  height: number,
) {
  const forward = unit(sub(scene.cameraTarget, scene.cameraPosition));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const point: Vec = [(u - 0.5) * scene.widthM, scene.thicknessM, (0.5 - v) * scene.heightM];
  const delta = sub(point, scene.cameraPosition);
  const depth = dot(delta, forward),
    tangent = Math.tan((scene.fovDeg * Math.PI) / 360);
  return {
    x: width * (0.5 + dot(delta, right) / ((2 * depth * tangent * width) / height)),
    y: height * (0.5 - dot(delta, up) / (2 * depth * tangent)),
  };
}

export function samplePatch(bytes: Buffer, scene: SceneDiagnostics, u: number, v: number): Vec {
  const png = PNG.sync.read(bytes);
  const center = projectPrintPoint(scene, u, v, png.width, png.height);
  const result: Vec = [0, 0, 0];
  let count = 0;
  for (let y = Math.round(center.y) - 3; y <= Math.round(center.y) + 3; y++) {
    for (let x = Math.round(center.x) - 3; x <= Math.round(center.x) + 3; x++) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height)
        throw new Error('Projected patch is outside the viewport');
      for (let channel = 0; channel < 3; channel++)
        result[channel] =
          (result[channel] ?? 0) + (png.data[(y * png.width + x) * 4 + channel] ?? 0);
      count++;
    }
  }
  return [result[0] / count, result[1] / count, result[2] / count];
}

export function redCircleBounds(bytes: Buffer) {
  const png = PNG.sync.read(bytes);
  let xMin = png.width,
    yMin = png.height,
    xMax = -1,
    yMax = -1,
    count = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i] ?? 0,
        g = png.data[i + 1] ?? 0,
        b = png.data[i + 2] ?? 0;
      if (r > 80 && r > g * 1.6 && r > b * 1.6) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
        count++;
      }
    }
  if (count < 100) throw new Error('The original red circle is absent from the rendered mat');
  return {
    width: xMax - xMin + 1,
    height: yMax - yMin + 1,
    ratio: (xMax - xMin + 1) / (yMax - yMin + 1),
    count,
  };
}
export const luminance = (color: Vec) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
const fromSrgb = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toSrgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
const acesFit = (value: number) =>
  Math.max(
    0,
    Math.min(
      1,
      (value * (value + 0.0245786) - 0.000090537) /
        (value * (0.983729 * value + 0.432951) + 0.238081),
    ),
  );
function inverseAces(value: number) {
  let low = 0,
    high = 100;
  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;
    if (acesFit(middle) < value) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
/** Infer achromatic illumination from black/white, then predict an sRGB gray.
 * This detects extra/missing sRGB conversion without asserting unlit RGB equals lit RGB.
 */
export function predictLitGray(encodedGray: number, observedBlack: number, observedWhite: number) {
  const black = inverseAces(fromSrgb(observedBlack / 255));
  const white = inverseAces(fromSrgb(observedWhite / 255));
  return 255 * toSrgb(acesFit(black + (white - black) * fromSrgb(encodedGray / 255)));
}
