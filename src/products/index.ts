import type { ProductDefinition } from '../contracts';

export function mmToMetres(mm: number): number {
  if (!Number.isFinite(mm)) throw new RangeError('Millimetres must be finite.');
  return mm / 1000;
}

export function aspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Width and height must be positive, finite values.');
  }
  return width / height;
}

export const PRODUCTS: readonly ProductDefinition[] = [
  {
    id: 'deskmat-900x400',
    displayName: 'Desk Mat',
    widthMm: 900,
    heightMm: 400,
    thicknessMm: 3,
    cornerRadiusMm: 12,
    edgePreset: 'standard-cut',
    surfaceMaterialPreset: 'fine-weave',
    defaultCameraFraming: { position: [0.7, 0.85, 0.85], target: [0, 0.0015, 0], fovDeg: 35 },
    printableArea: { xMm: 0, yMm: 0, widthMm: 900, heightMm: 400 },
    bleedMm: 3,
  },
  {
    id: 'mousepad-400x450',
    displayName: 'Mouse Pad',
    widthMm: 400,
    heightMm: 450,
    thicknessMm: 3,
    cornerRadiusMm: 12,
    edgePreset: 'standard-cut',
    surfaceMaterialPreset: 'fine-weave',
    defaultCameraFraming: { position: [0.5, 0.65, 0.65], target: [0, 0.0015, 0], fovDeg: 35 },
    printableArea: { xMm: 0, yMm: 0, widthMm: 400, heightMm: 450 },
    bleedMm: 3,
  },
];

export function getProduct(id: string): ProductDefinition {
  const product = PRODUCTS.find((entry) => entry.id === id);
  if (!product) throw new RangeError(`Unknown product: ${id}`);
  return product;
}

export function validateProduct(product: ProductDefinition): void {
  aspectRatio(product.widthMm, product.heightMm);
  if (!product.id || !product.displayName)
    throw new RangeError('Product id and name are required.');
  if (!Number.isFinite(product.thicknessMm) || product.thicknessMm <= 0) {
    throw new RangeError('Product thickness must be positive.');
  }
  const maxRadius = Math.min(product.widthMm, product.heightMm) / 2;
  if (
    !Number.isFinite(product.cornerRadiusMm) ||
    product.cornerRadiusMm < 0 ||
    product.cornerRadiusMm > maxRadius
  ) {
    throw new RangeError('Corner radius must fit the product.');
  }
  if (!Number.isFinite(product.bleedMm) || product.bleedMm < 0) {
    throw new RangeError('Bleed must be a nonnegative finite number.');
  }
  const area = product.printableArea;
  aspectRatio(area.widthMm, area.heightMm);
  if (
    !Number.isFinite(area.xMm) ||
    !Number.isFinite(area.yMm) ||
    area.xMm < 0 ||
    area.yMm < 0 ||
    area.xMm + area.widthMm > product.widthMm ||
    area.yMm + area.heightMm > product.heightMm
  ) {
    throw new RangeError('Printable area must lie inside the product.');
  }
}
