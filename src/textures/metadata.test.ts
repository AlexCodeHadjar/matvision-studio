import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectImageBytes, validateImageDimensions } from './metadata';

function exif(orientation: number, little = true) {
  const bytes = Buffer.alloc(32);
  bytes.write('Exif\0\0');
  bytes.write(little ? 'II' : 'MM', 6);
  const view = new DataView(bytes.buffer, bytes.byteOffset + 6, 26);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little);
  view.setUint16(12, 3, little);
  view.setUint32(14, 1, little);
  view.setUint16(18, orientation, little);
  return bytes;
}
function jpeg(orientation = 1, little = true, xmp = false) {
  const segment = (marker: number, payload: Buffer) => {
    const header = Buffer.alloc(4);
    header[0] = 0xff;
    header[1] = marker;
    header.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([header, payload]);
  };
  const frame = Buffer.alloc(9);
  frame[0] = 8;
  frame.writeUInt16BE(600, 1);
  frame.writeUInt16BE(1200, 3);
  frame[5] = 1;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe1, exif(orientation, little)),
    ...(xmp ? [segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0'))] : []),
    segment(0xc0, frame),
    Buffer.from([0xff, 0xd9]),
  ]);
}
function webp(kind: string, width: number, height: number) {
  const payload = Buffer.alloc(kind === 'VP8L' ? 6 : 10);
  if (kind === 'VP8X') {
    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);
  }
  if (kind === 'VP8L') {
    payload[0] = 0x2f;
    payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  }
  if (kind === 'VP8 ') {
    payload.set([0x9d, 1, 0x2a], 3);
    payload.writeUInt16LE(width, 6);
    payload.writeUInt16LE(height, 8);
  }
  const header = Buffer.alloc(20);
  header.write('RIFF');
  header.writeUInt32LE(12 + payload.length, 4);
  header.write('WEBP', 8);
  header.write(kind, 12);
  header.writeUInt32LE(payload.length, 16);
  return Buffer.concat([header, payload]);
}

describe('local image metadata and import limits', () => {
  it.each([
    'landscape-grid',
    'portrait-grid',
    'panorama-grid',
    'very-tall-grid',
    'transparent',
    'high-resolution-grid',
    'small-low-resolution',
  ])('reads original %s fixture dimensions', (name) => {
    const bytes = readFileSync(`tests/fixtures/${name}.png`);
    const result = inspectImageBytes(bytes, 'image/png');
    expect(result.widthPx).toBe(bytes.readUInt32BE(16));
    expect(result.heightPx).toBe(bytes.readUInt32BE(20));
    expect(result.mimeType).toBe('image/png');
    expect(result.orientation).toBe(1);
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'reports displayed dimensions for JPEG EXIF orientation %i',
    (orientation) => {
      const result = inspectImageBytes(jpeg(orientation), 'image/jpeg');
      expect(result).toEqual({
        mimeType: 'image/jpeg',
        widthPx: orientation >= 5 ? 600 : 1200,
        heightPx: orientation >= 5 ? 1200 : 600,
        orientation,
      });
    },
  );
  it('handles big-endian EXIF and ignores later XMP metadata', () => {
    expect(inspectImageBytes(jpeg(6, false, true)).widthPx).toBe(600);
  });
  it.each(['VP8X', 'VP8L', 'VP8 '])('reads WebP %s dimensions', (kind) => {
    expect(inspectImageBytes(webp(kind, 1200, 600), 'image/webp')).toEqual({
      mimeType: 'image/webp',
      widthPx: 1200,
      heightPx: 600,
      orientation: 1,
    });
  });
  it('accepts an empty or generic MIME only when magic identifies supported content', () => {
    expect(inspectImageBytes(jpeg(), 'application/octet-stream').mimeType).toBe('image/jpeg');
    expect(inspectImageBytes(jpeg(), 'image/jpg').mimeType).toBe('image/jpeg');
  });
  it('rejects spoofed MIME and unsupported content', () => {
    expect(() => inspectImageBytes(jpeg(), 'image/png')).toThrow('Тип файла');
    expect(() => inspectImageBytes(Buffer.from('<svg/>'), 'image/png')).toThrow('Неподдерживаемый');
    expect(() => inspectImageBytes(Buffer.alloc(0))).toThrow('пуст');
  });
  it('rejects truncated JPEG segments, PNG chunks and WebP containers', () => {
    expect(() => inspectImageBytes(jpeg().subarray(0, 18))).toThrow('повреждено');
    expect(() =>
      inspectImageBytes(readFileSync('tests/fixtures/white.png').subarray(0, 30)),
    ).toThrow('повреждено');
    expect(() => inspectImageBytes(webp('VP8X', 1200, 600).subarray(0, 27))).toThrow('повреждено');
  });
  it.each([
    [0, 100],
    [-1, 100],
    [1.5, 100],
    [NaN, 100],
    [Infinity, 100],
    [65536, 1],
    [16001, 10000],
  ])('rejects unsafe dimensions %i×%i before decoder allocation', (w, h) =>
    expect(() => validateImageDimensions(w, h)).toThrow(),
  );
  it('allows over-4K original dimensions within CPU decode budget', () => {
    expect(() => validateImageDimensions(16000, 10000)).not.toThrow();
    expect(() => validateImageDimensions(65535, 1)).not.toThrow();
  });
});
