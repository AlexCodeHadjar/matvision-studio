import type { PrintSource } from '../contracts';

export const IMAGE_LIMITS = Object.freeze({
  encodedBytes: 64 * 1024 * 1024,
  maxEdge: 65_535,
  maxPixels: 160_000_000,
});
export interface ImageMetadata {
  mimeType: PrintSource['mimeType'];
  widthPx: number;
  heightPx: number;
  orientation: number;
}
const corrupt = () => new Error('Изображение повреждено или содержит некорректные размеры.');
const ascii = (bytes: Uint8Array, offset: number, count: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + count));

/** TIFF orientation in EXIF. Both JPEG-prefixed and bare TIFF containers are supported. */
function exifOrientation(bytes: Uint8Array): number {
  const offset = ascii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0;
  if (bytes.length < offset + 8) return 1;
  const marker = ascii(bytes, offset, 2);
  if (marker !== 'II' && marker !== 'MM') return 1;
  const little = marker === 'II';
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
  if (view.getUint16(2, little) !== 42) return 1;
  const ifd = view.getUint32(4, little);
  if (ifd > view.byteLength - 2) return 1;
  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry > view.byteLength - 12) return 1;
    if (
      view.getUint16(entry, little) === 0x0112 &&
      view.getUint16(entry + 2, little) === 3 &&
      view.getUint32(entry + 4, little) === 1
    ) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function validateImageDimensions(width: number, height: number): void {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) throw corrupt();
  if (
    width > IMAGE_LIMITS.maxEdge ||
    height > IMAGE_LIMITS.maxEdge ||
    width * height > IMAGE_LIMITS.maxPixels
  )
    throw new Error(
      'Слишком большое изображение: максимум 160 мегапикселей и 65 535 пикселей по стороне.',
    );
}

/** Reads only container metadata; the browser decoder must subsequently validate pixel data. */
export function inspectImageBytes(bytes: Uint8Array, declaredMime = ''): ImageMetadata {
  if (!bytes.length) throw new Error('Файл изображения пуст.');
  if (bytes.length > IMAGE_LIMITS.encodedBytes)
    throw new Error('Файл слишком большой: максимум 64 МиБ.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let mimeType: ImageMetadata['mimeType'];
  let width = 0;
  let height = 0;
  let orientation = 1;
  if (
    bytes.length >= 24 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[0] === 0x89 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  ) {
    mimeType = 'image/png';
    if (ascii(bytes, 12, 4) !== 'IHDR' || view.getUint32(8) !== 13) throw corrupt();
    width = view.getUint32(16);
    height = view.getUint32(20);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw corrupt();
      if (ascii(bytes, offset + 4, 4) === 'eXIf')
        orientation = exifOrientation(bytes.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = 'image/jpeg';
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 0xff) throw corrupt();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw corrupt();
      const length = view.getUint16(offset);
      if (length < 2 || length > bytes.length - offset) throw corrupt();
      if (marker === 0xe1 && ascii(bytes, offset + 2, 6) === 'Exif\0\0')
        orientation = exifOrientation(bytes.subarray(offset + 2, offset + length));
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) throw corrupt();
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
      }
      offset += length;
    }
  } else if (bytes.length >= 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    mimeType = 'image/webp';
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length) throw corrupt();
    for (let offset = 12; offset + 8 <= end;) {
      const kind = ascii(bytes, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (size > end - start) throw corrupt();
      if (kind === 'VP8X' && size >= 10) {
        width = 1 + bytes[start + 4]! + (bytes[start + 5]! << 8) + (bytes[start + 6]! << 16);
        height = 1 + bytes[start + 7]! + (bytes[start + 8]! << 8) + (bytes[start + 9]! << 16);
      } else if (kind === 'VP8 ' && size >= 10 && !width) {
        if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a)
          throw corrupt();
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (kind === 'VP8L' && size >= 5 && !width) {
        if (bytes[start] !== 0x2f) throw corrupt();
        const packed = view.getUint32(start + 1, true);
        width = (packed & 0x3fff) + 1;
        height = ((packed >>> 14) & 0x3fff) + 1;
      } else if (kind === 'EXIF')
        orientation = exifOrientation(bytes.subarray(start, start + size));
      offset = start + size + (size % 2);
    }
  } else throw new Error('Неподдерживаемый формат. Выберите PNG, JPEG или WebP.');
  const mime = declaredMime.toLowerCase().split(';')[0]!.trim();
  const normalizedMime = mime === 'image/jpg' ? 'image/jpeg' : mime;
  if (
    normalizedMime &&
    normalizedMime !== 'application/octet-stream' &&
    normalizedMime !== mimeType
  )
    throw new Error(
      'Тип файла не совпадает с его содержимым. Выберите корректный PNG, JPEG или WebP.',
    );
  validateImageDimensions(width, height);
  if (orientation >= 5) [width, height] = [height, width];
  return { mimeType, widthPx: width, heightPx: height, orientation };
}
