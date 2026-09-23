import type { EnvironmentPreset, Vector3Tuple } from '../contracts';

export interface EnvironmentSettings {
  displayName: string;
  backgroundColor: string;
  floorColor: string;
  keyColor: string;
  keyIntensity: number;
  keyPosition: Vector3Tuple;
  environmentIntensity: number;
  exposure: number;
}

export const ENVIRONMENT_SETTINGS: Readonly<Record<EnvironmentPreset, EnvironmentSettings>> = {
  'neutral-studio': {
    displayName: 'Neutral Studio',
    backgroundColor: '#afb4b0',
    floorColor: '#d3d7d1',
    keyColor: '#ffffff',
    keyIntensity: 1.6,
    keyPosition: [-0.95, 1.25, 0.65],
    environmentIntensity: 0.48,
    exposure: 0.86,
  },
  'bright-studio': {
    displayName: 'Bright Studio',
    backgroundColor: '#d0d2d1',
    floorColor: '#d4d5d3',
    keyColor: '#ffffff',
    keyIntensity: 1.9,
    keyPosition: [-0.7, 2.1, 0.7],
    environmentIntensity: 0.55,
    exposure: 0.92,
  },
  'warm-room': {
    displayName: 'Warm Room',
    backgroundColor: '#b9aaa0',
    floorColor: '#ad9e8e',
    keyColor: '#ffe3c4',
    keyIntensity: 1.35,
    keyPosition: [-0.9, 1.4, 0.5],
    environmentIntensity: 0.45,
    exposure: 0.88,
  },
  'desk-setup': {
    displayName: 'Desk Setup',
    backgroundColor: '#777e83',
    floorColor: '#797d7d',
    keyColor: '#f0f5ff',
    keyIntensity: 1.45,
    keyPosition: [0.7, 1.4, 0.9],
    environmentIntensity: 0.44,
    exposure: 0.9,
  },
};

export function getEnvironmentSettings(preset: EnvironmentPreset): EnvironmentSettings {
  return ENVIRONMENT_SETTINGS[preset];
}
