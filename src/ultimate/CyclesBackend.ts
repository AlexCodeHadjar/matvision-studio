import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CyclesScenePackage } from './package';

export interface CyclesCapabilities {
  available: boolean;
  reason: string | null;
  version: string | null;
  executable: string | null;
  devices: { backend: string; name: string }[];
}

export interface CyclesStatus {
  stage: 'idle' | 'preparing' | 'rendering' | 'done' | 'error';
  progress: number;
  detail: string;
  elapsedMs: number;
  pngDataUrl: string | null;
}

/** Optional local process backend; no Blender is loaded by Studio or Photo. */
export class CyclesBackend {
  readonly id = 'cycles-prototype';
  private executable: string | null = null;

  async getCapabilities(path?: string): Promise<CyclesCapabilities> {
    if (!isTauri())
      return {
        available: false,
        reason: 'Ultimate работает только в Windows-приложении.',
        version: null,
        executable: null,
        devices: [],
      };
    const result = await invoke<CyclesCapabilities>('cycles_probe', { path: path ?? null });
    this.executable = result.available ? result.executable : null;
    return result;
  }

  async chooseExecutable(): Promise<string | null> {
    if (!isTauri()) return null;
    return invoke<string | null>('choose_cycles_executable');
  }

  async render(scenePackage: CyclesScenePackage, sourceDataUrl: string | null): Promise<void> {
    if (!this.executable) throw new Error('Выберите доступный Blender/Cycles.');
    await invoke('cycles_start', {
      request: { blenderPath: this.executable, package: scenePackage, sourceDataUrl },
    });
  }

  poll(): Promise<CyclesStatus> {
    return invoke<CyclesStatus>('cycles_poll');
  }

  async cancel(): Promise<void> {
    if (isTauri()) await invoke('cycles_cancel');
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }
}
