import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PrintSource } from '../contracts';
import { log, logError } from '../app/log';

/** Native APIs intentionally have no browser filesystem fallback. */
export { isTauri };

function requireNative(): void {
  if (!isTauri()) throw new Error('This operation requires the MatVision Studio desktop app.');
}

async function nativeCall<T>(command: string, arguments_: Record<string, unknown>): Promise<T> {
  requireNative();
  log('NATIVE', command, { status: 'started' });
  try {
    const result = await invoke<T>(command, arguments_);
    log('NATIVE', command, { status: result === null ? 'cancelled' : 'completed' });
    return result;
  } catch (error: unknown) {
    logError('NATIVE', command, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** An omitted path opens the native picker; cancellation returns null. */
export function openNativeImage(path?: string): Promise<PrintSource | null> {
  return nativeCall('open_image', { path: path ?? null });
}

/** Native validates UTF-8/JSON/file limits; project schema validation follows in project/. */
export function openNativeProject(path?: string): Promise<string | null> {
  return nativeCall('open_project', { path: path ?? null });
}

/** Returns the actual saved path; same-directory atomic replacement supports Windows. */
export function saveNativeProject(contents: string, path?: string): Promise<string | null> {
  return nativeCall('save_project', { contents, path: path ?? null });
}

/** Binary IPC avoids inflating PNG pixels into a JSON array of numbers. */
export async function saveNativePng(bytes: Uint8Array, path?: string): Promise<string | null> {
  requireNative();
  log('NATIVE', 'save_png', { status: 'started', byteLength: bytes.byteLength });
  let encodedPath = '';
  if (path !== undefined) {
    const utf8 = new TextEncoder().encode(path);
    encodedPath = btoa(Array.from(utf8, (byte) => String.fromCharCode(byte)).join(''));
  }
  try {
    const result = await invoke<string | null>('save_png', bytes, {
      headers: { 'x-matvision-path': encodedPath },
    });
    log('NATIVE', 'save_png', { status: result === null ? 'cancelled' : 'completed' });
    return result;
  } catch (error: unknown) {
    logError('NATIVE', 'save_png', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
