import type { CameraState, ProjectState } from '../contracts';
import { createMatVisionScene } from '../scene-core/MatVisionScene';
import { computePrintTransform } from '../print-layout/layout';

export interface CyclesScenePackage {
  schemaVersion: 1;
  product: {
    widthMm: number;
    heightMm: number;
    thicknessMm: number;
    cornerRadiusMm: number;
  };
  printableArea: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  printPath: null;
  printInverse: number[];
  materials: { fabricRoughness: number };
  environment: { intensity: number; floorColor: string };
  camera: { positionMm: number[]; targetMm: number[]; fovDeg: number };
  render: { widthPx: number; heightPx: number; samples: number; device: string };
}

/** Temporary Cycles package v1; never saved inside .matvision. */
export function createCyclesPackage(
  state: ProjectState,
  camera: CameraState,
  render: CyclesScenePackage['render'],
): CyclesScenePackage {
  const scene = createMatVisionScene({ ...state, camera });
  const sourceSize = state.source ?? { widthPx: 1800, heightPx: 800 };
  const printInverse = computePrintTransform(
    sourceSize,
    scene.print.printableArea,
    state.layout,
  ).inverse;
  return {
    schemaVersion: 1,
    product: {
      widthMm: scene.product.widthMm,
      heightMm: scene.product.heightMm,
      thicknessMm: scene.product.thicknessMm,
      cornerRadiusMm: scene.product.cornerRadiusMm,
    },
    printableArea: scene.print.printableArea,
    printPath: null,
    printInverse,
    materials: { fabricRoughness: Math.max(0.05, Math.min(1, state.roughness)) },
    environment: { intensity: scene.environment.intensity, floorColor: scene.floor.color },
    camera: {
      positionMm: scene.camera.positionMm,
      targetMm: scene.camera.targetMm,
      fovDeg: scene.camera.fovDeg,
    },
    render,
  };
}

export function cyclesPrototypeWarnings(state: ProjectState): string[] {
  const warnings = [];
  if (!state.source)
    warnings.push(
      'Встроенный демонстрационный принт Studio не переносится; загрузите своё изображение.',
    );
  if (state.edgePreset === 'stitched')
    warnings.push('Прошитые петли пока не передаются в Ultimate.');
  if (state.rollAmount > 0)
    warnings.push('Изгиб пока не передаётся: Ultimate покажет плоский коврик.');
  if (Object.values(state.materials).some((material) => Object.values(material.maps).some(Boolean)))
    warnings.push('Пользовательские карты материалов пока не передаются в Ultimate.');
  return warnings;
}
