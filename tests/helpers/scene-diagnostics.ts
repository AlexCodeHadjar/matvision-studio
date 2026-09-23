/** Read-only data emitted from the actual scene, never a replacement renderer. */
export interface SceneDiagnostics {
  ready: boolean;
  renderer: string;
  productId: string;
  widthM: number;
  heightM: number;
  thicknessM: number;
  triangles: number;
  drawCalls: number;
  frameCount: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraPreset: string;
  fovDeg: number;
  exposure: number;
  previewWidthPx: number;
  previewHeightPx: number;
  sourceWidthPx: number;
  sourceHeightPx: number;
  rendererWidthPx: number;
  rendererHeightPx: number;
  contextLost: boolean;
  matRotationY: number;
  textures: number;
  outputColorSpace: string;
  toneMapping: string;
  environmentId: string;
}

export function parseDiagnostics(text: string | null): SceneDiagnostics {
  if (!text) throw new Error('Scene diagnostics are absent');
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ready' in value) ||
    !('cameraPosition' in value) ||
    !Array.isArray(value.cameraPosition) ||
    value.cameraPosition.length !== 3
  ) {
    throw new Error('Scene diagnostics do not match the documented contract');
  }
  return value as SceneDiagnostics;
}
