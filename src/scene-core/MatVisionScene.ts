import type {
  CameraPreset,
  CameraState,
  EdgePreset,
  EnvironmentPreset,
  MaterialMapKind,
  MaterialPreset,
  PlacementSurface,
  PrintLayout,
  ProjectState,
  Vector3Tuple,
} from '../contracts';
import { getProduct } from '../products';
import { getEnvironmentSettings } from './lighting';

/** The scene is a transient projection of ProjectState, never a second project format. */
export interface MatVisionScene {
  schemaVersion: 1;
  product: {
    id: string;
    widthMm: number;
    heightMm: number;
    thicknessMm: number;
    cornerRadiusMm: number;
    edge: EdgePreset;
    rollAmount: number;
  };
  print: {
    layout: PrintLayout;
    source: AssetReference | null;
    printableArea: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  };
  materials: {
    fabric: MaterialSpec & { preset: MaterialPreset; sheen: number; relief: number };
    rubber: MaterialSpec & { relief: number };
  };
  lights: LightSpec[];
  environment: {
    preset: EnvironmentPreset;
    backgroundColor: string;
    intensity: number;
    exposure: number;
  };
  floor: { surface: PlacementSurface; color: string };
  camera: {
    preset: CameraPreset;
    positionMm: Vector3Tuple;
    targetMm: Vector3Tuple;
    fovDeg: number;
  };
}

export interface AssetReference {
  name: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
}
export interface MaterialSpec {
  tileMm: number;
  normalY: 'opengl' | 'directx';
  maps: Partial<Record<MaterialMapKind, AssetReference>>;
}
export interface LightSpec {
  role: 'key-shadow';
  color: string;
  /** Existing Three.js preset intensity; not a cross-renderer physical unit. */
  intensity: number;
  positionMm: Vector3Tuple;
}

export const mmToMetres = (millimetres: number) => millimetres / 1000;
export const metresToMm = (metres: number) => metres * 1000;
const toMm = (position: Vector3Tuple): Vector3Tuple => position.map(metresToMm) as Vector3Tuple;
export const toMetres = (positionMm: Vector3Tuple): Vector3Tuple =>
  positionMm.map(mmToMetres) as Vector3Tuple;

function asset(source: ProjectState['source']): AssetReference | null {
  return source
    ? {
        name: source.name,
        mimeType: source.mimeType,
        widthPx: source.widthPx,
        heightPx: source.heightPx,
      }
    : null;
}
function material(value: ProjectState['materials']['fabric']): MaterialSpec {
  const maps: MaterialSpec['maps'] = {};
  for (const kind of ['color', 'normal', 'roughness', 'height'] as const) {
    const entry = asset(value.maps[kind] ?? null);
    if (entry) maps[kind] = entry;
  }
  return { tileMm: value.tileMm, normalY: value.normalY, maps };
}

/** No Three.js objects or embedded image bytes enter this representation. */
export function createMatVisionScene(state: ProjectState): MatVisionScene {
  const product = getProduct(state.productId);
  const environment = getEnvironmentSettings(state.environment);
  return {
    schemaVersion: 1,
    product: {
      id: product.id,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      thicknessMm: state.thicknessMm,
      cornerRadiusMm: product.cornerRadiusMm,
      edge: state.edgePreset,
      rollAmount: state.rollAmount,
    },
    print: {
      layout: { ...state.layout },
      source: asset(state.source),
      printableArea: { ...product.printableArea },
    },
    materials: {
      fabric: {
        ...material(state.materials.fabric),
        preset: state.materialPreset,
        sheen: state.realism.sheen,
        relief: state.realism.relief,
      },
      rubber: { ...material(state.materials.rubber), relief: state.realism.rubberRelief },
    },
    lights: [
      {
        role: 'key-shadow',
        color: environment.keyColor,
        intensity: environment.keyIntensity,
        positionMm: toMm(environment.keyPosition),
      },
    ],
    environment: {
      preset: state.environment,
      backgroundColor: environment.backgroundColor,
      intensity: environment.environmentIntensity,
      exposure: environment.exposure,
    },
    floor: { surface: state.placementSurface, color: environment.floorColor },
    camera: {
      preset: state.camera.preset,
      positionMm: toMm(state.camera.position),
      targetMm: toMm(state.camera.target),
      fovDeg: state.camera.fovDeg,
    },
  };
}

export function cameraFromScene(scene: MatVisionScene): CameraState {
  return {
    preset: scene.camera.preset,
    position: toMetres(scene.camera.positionMm),
    target: toMetres(scene.camera.targetMm),
    fovDeg: scene.camera.fovDeg,
  };
}
