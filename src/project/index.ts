import type {
  CalibratedMaterialProfile,
  CameraState,
  PrintLayout,
  PrintSource,
  ProjectDocument,
  ProjectState,
  Vector3Tuple,
} from '../contracts';
import { getProduct } from '../products';
import { PLACEMENT_SURFACES } from '../contracts';

export const PROJECT_FORMAT = 'matvision-project' as const;
export const PROJECT_VERSION = 1 as const;
export const MAX_PROJECT_CHARACTERS = 256 * 1024 * 1024;

export function createDefaultLayout(): PrintLayout {
  return { mode: 'cover', scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 };
}

export function createDefaultMaterialProfile(): CalibratedMaterialProfile {
  return {
    id: 'neutral-cloth',
    name: 'Neutral Cloth (uncalibrated)',
    brightness: 1,
    saturation: 1,
    blackLevel: 0,
    surfaceTint: '#ffffff',
    contrast: 1,
    roughness: 0.88,
  };
}

export function createDefaultProject(productId = 'deskmat-900x400'): ProjectState {
  const product = getProduct(productId);
  return {
    productId,
    thicknessMm: product.thicknessMm,
    edgePreset: product.edgePreset,
    materialPreset: product.surfaceMaterialPreset,
    roughness: 0.88,
    environment: 'neutral-studio',
    placementSurface: 'studio',
    rollAmount: 0,
    layout: createDefaultLayout(),
    source: null,
    camera: {
      preset: 'perspective',
      position: [...product.defaultCameraFraming.position],
      target: [...product.defaultCameraFraming.target],
      fovDeg: product.defaultCameraFraming.fovDeg,
    },
    quality: 'balanced',
    turntable: false,
    referenceMode: false,
    materialProfile: createDefaultMaterialProfile(),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function string(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean.`);
  return value;
}

function option<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  const selected = choices.find((choice) => choice === value);
  if (selected === undefined) throw new RangeError(`Unsupported ${label}.`);
  return selected;
}

function tuple(value: unknown, label: string): Vector3Tuple {
  if (!Array.isArray(value) || value.length !== 3)
    throw new TypeError(`${label} requires three coordinates.`);
  return [
    number(value[0], label, -1000, 1000),
    number(value[1], label, -1000, 1000),
    number(value[2], label, -1000, 1000),
  ];
}

function layout(value: unknown): PrintLayout {
  const input = record(value, 'layout');
  return {
    mode: option(input.mode, ['cover', 'contain', 'stretch'], 'fit mode'),
    scale: number(input.scale, 'print scale', 0.05, 20),
    offsetX: number(input.offsetX, 'X offset', -5, 5),
    offsetY: number(input.offsetY, 'Y offset', -5, 5),
    rotationDeg: number(input.rotationDeg, 'rotation', -360000, 360000),
  };
}

function camera(value: unknown): CameraState {
  const input = record(value, 'camera');
  const position = tuple(input.position, 'camera position');
  const target = tuple(input.target, 'camera target');
  if (
    Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 0.0001
  ) {
    throw new RangeError('Camera position must differ from its target.');
  }
  return {
    preset: option(
      input.preset,
      ['top', 'perspective', 'low-angle', 'close-up', 'underside'],
      'camera preset',
    ),
    position,
    target,
    fovDeg: number(input.fovDeg, 'field of view', 10, 100),
  };
}

function source(value: unknown): PrintSource | null {
  if (value === null) return null;
  const input = record(value, 'source');
  const mimeType = option(
    input.mimeType,
    ['image/png', 'image/jpeg', 'image/webp'],
    'image format',
  );
  const dataUrl = string(input.dataUrl, 'embedded image', MAX_PROJECT_CHARACTERS);
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix))
    throw new TypeError('Embedded image MIME type does not match its header.');
  const payload = dataUrl.slice(prefix.length);
  if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new TypeError('Embedded image must contain valid base64 data.');
  }
  const widthPx = number(input.widthPx, 'source width', 1, 65535);
  const heightPx = number(input.heightPx, 'source height', 1, 65535);
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx))
    throw new TypeError('Source dimensions must be integer pixels.');
  return { name: string(input.name, 'image name'), mimeType, dataUrl, widthPx, heightPx };
}

function profile(value: unknown): CalibratedMaterialProfile {
  const input = record(value, 'material profile');
  const surfaceTint = string(input.surfaceTint, 'surface tint', 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(surfaceTint))
    throw new TypeError('Surface tint must be a six-digit hexadecimal colour.');
  return {
    id: string(input.id, 'profile id'),
    name: string(input.name, 'profile name'),
    brightness: number(input.brightness, 'brightness compensation', 0.25, 2),
    saturation: number(input.saturation, 'saturation compensation', 0, 2),
    blackLevel: number(input.blackLevel, 'black level', 0, 0.3),
    surfaceTint,
    contrast: number(input.contrast, 'contrast', 0.25, 2),
    roughness: number(input.roughness, 'profile roughness', 0.05, 1),
  };
}

/** Validate an untrusted file and return a fresh state containing only known fields. */
export function validateProjectState(value: unknown): ProjectState {
  const input = record(value, 'project state');
  const productId = string(input.productId, 'product id');
  getProduct(productId);
  return {
    productId,
    thicknessMm: number(input.thicknessMm, 'thickness', 0.5, 20),
    edgePreset: option(input.edgePreset, ['standard-cut', 'stitched'], 'edge preset'),
    materialPreset: option(
      input.materialPreset,
      ['smooth-cloth', 'fine-weave', 'gaming-fabric'],
      'material preset',
    ),
    roughness: number(input.roughness, 'roughness', 0.05, 1),
    environment: option(
      input.environment,
      ['neutral-studio', 'bright-studio', 'warm-room', 'desk-setup'],
      'environment',
    ),
    // Version 1 files written before 0.1.2 had only the neutral studio floor.
    placementSurface: option(
      input.placementSurface === undefined ? 'studio' : input.placementSurface,
      PLACEMENT_SURFACES,
      'placement surface',
    ),
    rollAmount: input.rollAmount === undefined ? 0 : number(input.rollAmount, 'roll amount', 0, 1),
    layout: layout(input.layout),
    source: source(input.source),
    camera: camera(input.camera),
    quality: option(input.quality, ['low', 'balanced', 'high', 'ultra'], 'quality'),
    turntable: boolean(input.turntable, 'turntable'),
    referenceMode: boolean(input.referenceMode, 'reference mode'),
    materialProfile: profile(input.materialProfile),
  };
}

/** Version 0 is the internal bootstrap format with optional settings; never guess future schemas. */
export function migrateProject(value: unknown): ProjectDocument {
  const input = record(value, 'project document');
  if (input.format !== PROJECT_FORMAT) throw new TypeError('This file is not a MatVision project.');
  if (input.version === PROJECT_VERSION) {
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      state: validateProjectState(input.state),
    };
  }
  if (input.version !== 0)
    throw new RangeError('Unsupported project version. Use a compatible MatVision Studio release.');
  const old = record(input.state, 'legacy project state');
  const defaults = createDefaultProject(
    old.productId === undefined ? undefined : string(old.productId, 'product id'),
  );
  const merged = {
    ...defaults,
    ...old,
    layout: {
      ...defaults.layout,
      ...(old.layout === undefined ? {} : record(old.layout, 'legacy layout')),
    },
    camera: {
      ...defaults.camera,
      ...(old.camera === undefined ? {} : record(old.camera, 'legacy camera')),
    },
    materialProfile: {
      ...defaults.materialProfile,
      ...(old.materialProfile === undefined ? {} : record(old.materialProfile, 'legacy profile')),
    },
  };
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, state: validateProjectState(merged) };
}

export function serializeProject(state: ProjectState): string {
  const document: ProjectDocument = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    state: validateProjectState(state),
  };
  const json = JSON.stringify(document, null, 2);
  if (json.length > MAX_PROJECT_CHARACTERS)
    throw new RangeError('Project exceeds the supported file size.');
  return json;
}

export function parseProject(json: string): ProjectState {
  if (json.length > MAX_PROJECT_CHARACTERS)
    throw new RangeError('Project exceeds the supported file size.');
  const document: unknown = JSON.parse(json);
  return migrateProject(document).state;
}
