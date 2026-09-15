import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';
import type { PreviewResolution, PrintSource, QualityPreset } from '../contracts';
import { computePreviewResolution } from '../print-layout/layout';
import { IMAGE_LIMITS, inspectImageBytes } from './metadata';

function decodeError(): Error {
  return new Error(
    'Не удалось прочитать изображение. Файл повреждён или его кодировка не поддерживается. Предыдущий принт сохранён.',
  );
}

async function decodeBitmap(blob: Blob, dimensions: PreviewResolution): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
      resizeWidth: dimensions.widthPx,
      resizeHeight: dimensions.heightPx,
      resizeQuality: 'high',
    });
  } catch {
    throw decodeError();
  }
}

function fileDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать выбранный файл.'));
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(decodeError());
    reader.readAsDataURL(file);
  });
}

/** Reads an original file locally. Checks magic, declared MIME, dimensions and actual pixel decode.
 * EXIF orientation is included in original widthPx/heightPx. Caller installs only a successful result.
 */
export async function importImageFile(file: File): Promise<PrintSource> {
  if (file.size > IMAGE_LIMITS.encodedBytes)
    throw new Error('Файл слишком большой: максимум 64 МиБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = inspectImageBytes(bytes, file.type);
  const blob = new Blob([bytes], { type: metadata.mimeType });
  const validation = await decodeBitmap(blob, computePreviewResolution(metadata, 64, 'low'));
  validation.close();
  return {
    name: file.name,
    mimeType: metadata.mimeType,
    dataUrl: await fileDataUrl(blob),
    widthPx: metadata.widthPx,
    heightPx: metadata.heightPx,
  };
}

function sourceBytes(source: PrintSource): Uint8Array<ArrayBuffer> {
  const prefix = `data:${source.mimeType};base64,`;
  const maxEncoded = Math.ceil(IMAGE_LIMITS.encodedBytes / 3) * 4;
  if (!source.dataUrl.startsWith(prefix) || source.dataUrl.length - prefix.length > maxEncoded)
    throw new Error('Некорректные данные изображения в проекте или файл превышает 64 МиБ.');
  try {
    const binary = atob(source.dataUrl.slice(prefix.length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw decodeError();
  }
}

export interface DecodedPrint extends PreviewResolution {
  texture: CanvasTexture;
  /** Idempotent: destroys GPU texture and releases the bounded CPU preview canvas. */
  dispose(): void;
}

/** Original bytes are NEVER uploaded to WebGL. The returned canvas is bounded by quality AND GPU limits.
 * Caller owns the result. Decode first, then swap and dispose the old result; failures keep old artwork.
 */
export async function decodeSource(
  source: PrintSource,
  maxTextureSize: number,
  quality: QualityPreset,
): Promise<DecodedPrint> {
  const bytes = sourceBytes(source);
  const metadata = inspectImageBytes(bytes, source.mimeType);
  if (metadata.widthPx !== source.widthPx || metadata.heightPx !== source.heightPx)
    throw new Error('Размеры оригинала в проекте не совпадают с изображением.');
  const dimensions = computePreviewResolution(metadata, maxTextureSize, quality);
  const bitmap = await decodeBitmap(new Blob([bytes], { type: metadata.mimeType }), dimensions);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.widthPx;
  canvas.height = dimensions.heightPx;
  try {
    const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
    if (!context) throw new Error('Не удалось подготовить изображение для видеокарты.');
    // CanvasTexture has conventional flipY; a raw ImageBitmap texture would ignore it.
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.name = 'user-print-preview';
  let disposed = false;
  return {
    ...dimensions,
    texture,
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      canvas.width = canvas.height = 1;
    },
  };
}
