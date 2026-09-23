import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCyclesPng } from './png';

describe('Cycles PNG save payload', () => {
  it('decodes the complete binary image without a network request', () => {
    const original = readFileSync('tests/fixtures/landscape-grid.png');
    const decoded = decodeCyclesPng(`data:image/png;base64,${original.toString('base64')}`);
    expect(Buffer.from(decoded)).toEqual(original);
  });

  it('rejects missing or invalid PNG data', () => {
    expect(() => decodeCyclesPng('data:text/plain;base64,QQ==')).toThrow('PNG');
    expect(() => decodeCyclesPng('data:image/png;base64,QQ==')).toThrow('PNG');
  });
});
