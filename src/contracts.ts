/** All physical catalogue dimensions are millimetres; rendering uses metres. */
export type EdgePreset = 'standard-cut' | 'stitched';
export type MaterialPreset = 'smooth-cloth' | 'fine-weave' | 'gaming-fabric';
export type EnvironmentPreset = 'neutral-studio' | 'bright-studio' | 'warm-room' | 'desk-setup';
export type PlacementSurface = 'studio' | 'white-desk' | 'graphite' | 'oak' | 'walnut' | 'concrete';
export const PLACEMENT_SURFACES: readonly PlacementSurface[] = [
  'studio',
  'white-desk',
  'graphite',
  'oak',
  'walnut',
  'concrete',
];
export type CameraPreset = 'top' | 'perspective' | 'low-angle' | 'close-up' | 'macro' | 'underside';
export type QualityPreset = 'low' | 'balanced' | 'high' | 'ultra';
export type MaterialTarget = 'fabric' | 'rubber';
export type MaterialMapKind = 'color' | 'normal' | 'roughness' | 'height';
export interface MaterialAssets {
  tileMm: number;
  normalY: 'opengl' | 'directx';
  maps: Partial<Record<MaterialMapKind, PrintSource>>;
}
export interface RealismSettings {
  mode: 'fast' | 'detailed';
  contactShadow: number;
  weaveScale: number;
  relief: number;
  sheen: number;
  rubberRelief: number;
}
export type FitMode = 'cover' | 'contain' | 'stretch';
export type Vector3Tuple = [number, number, number];
export type ShowcaseAnimation =
  | 'corner-lift'
  | 'soft-wave'
  | 'table-drop'
  | 'mat-flip'
  | 'dual-roll'
  | 'edge-flyby'
  | 'moving-light'
  | 'layer-reveal';

/** Rectangle measured from the product's top-left corner, before rounded-corner clipping. */
export interface PrintableArea {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface CameraFraming {
  /** Position and target are absolute SI metres in the product's default pose. */
  position: Vector3Tuple;
  target: Vector3Tuple;
  fovDeg: number;
}

export interface ProductDefinition {
  id: string;
  displayName: string;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  cornerRadiusMm: number;
  edgePreset: EdgePreset;
  surfaceMaterialPreset: MaterialPreset;
  defaultCameraFraming: CameraFraming;
  printableArea: PrintableArea;
  /** Artwork allowance beyond each trimmed product edge; never enlarges the physical mesh. */
  bleedMm: number;
}

export interface PrintLayout {
  mode: FitMode;
  /** Multiplier relative to the selected mode's aspect-correct base size. */
  scale: number;
  /** Fractions of printable width/height. Positive X goes right; positive Y goes up. */
  offsetX: number;
  offsetY: number;
  /** Counterclockwise, viewed from above the product. */
  rotationDeg: number;
}

/** Original encoded image. GPU preview dimensions must never replace these dimensions. */
export interface PrintSource {
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export interface PreviewResolution {
  widthPx: number;
  heightPx: number;
}

export interface CameraState extends CameraFraming {
  preset: CameraPreset;
}

/** Empirical supplier/material compensation. This is not an ICC print proof. */
export interface CalibratedMaterialProfile {
  id: string;
  name: string;
  brightness: number;
  saturation: number;
  blackLevel: number;
  surfaceTint: string;
  contrast: number;
  roughness: number;
}

export interface ProjectState {
  productId: string;
  thicknessMm: number;
  edgePreset: EdgePreset;
  materialPreset: MaterialPreset;
  roughness: number;
  environment: EnvironmentPreset;
  placementSurface: PlacementSurface;
  /** 0 = flat; 1 = fully rolled. Animation playback is transient UI state. */
  rollAmount: number;
  layout: PrintLayout;
  source: PrintSource | null;
  camera: CameraState;
  quality: QualityPreset;
  turntable: boolean;
  referenceMode: boolean;
  materialProfile: CalibratedMaterialProfile;
  realism: RealismSettings;
  materials: Record<MaterialTarget, MaterialAssets>;
}

export interface ProjectDocument {
  format: 'matvision-project';
  version: 2;
  state: ProjectState;
}

export interface ExportOptions {
  /** Pixel dimensions of the image excluding UI; a caller resolves preset names. */
  widthPx: number;
  heightPx: number;
}

export interface SceneDiagnostics {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  approximateTextureBytes: number;
  rendererWidthPx: number;
  rendererHeightPx: number;
  contextLost: boolean;
}

/** React owns project state; the renderer owns/disposes every WebGL resource. */
export interface SceneController {
  /** Apply synchronous scene parameters. Source decoding is explicit via setPrintSource. */
  update(state: ProjectState): void;
  /** Latest request wins; decode failure keeps the previously displayed source intact. */
  setPrintSource(source: PrintSource | null): Promise<PreviewResolution | null>;
  /** Invalidate in-flight imports before validating a newer file; preserve committed artwork. */
  cancelPendingPrint(): void;
  setCameraPreset(preset: CameraPreset): void;
  /** Play a transient material demonstration without changing the saved project state. */
  playShowcase(animation: ShowcaseAnimation): void;
  /** Stop a transient demonstration and restore the exact project pose. */
  stopShowcase(): void;
  getCameraState(): CameraState;
  exportPng(options: ExportOptions): Promise<Blob>;
  getDiagnostics(): SceneDiagnostics;
  dispose(): void;
}
