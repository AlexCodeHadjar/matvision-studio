import type { ProductDefinition, Vector3Tuple } from '../contracts';

export interface RulerLabel {
  axis: 'width' | 'height';
  valueMm: number;
  primary: boolean;
  endpoint: boolean;
  text: string;
  position: Vector3Tuple;
}

export function rulerGap(product: ProductDefinition): number {
  return Math.max(0.012, Math.min(0.028, Math.min(product.widthMm, product.heightMm) * 0.000075));
}

/** Rulers share the mat's local origin, SI units and exact edge endpoints. */
export function createRulerLayout(product: ProductDefinition) {
  const width = product.widthMm / 1000;
  const height = product.heightMm / 1000;
  const gap = rulerGap(product);
  const y = 0.001;
  const positions: number[] = [];
  const labels: RulerLabel[] = [];
  const segment = (a: Vector3Tuple, b: Vector3Tuple) => positions.push(...a, ...b);
  for (const axis of ['width', 'height'] as const) {
    const lengthMm = axis === 'width' ? product.widthMm : product.heightMm;
    const point = (mm: number, outward = 0): Vector3Tuple =>
      axis === 'width'
        ? [-width / 2 + mm / 1000, y, height / 2 + gap + outward]
        : [-width / 2 - gap - outward, y, -height / 2 + mm / 1000];
    segment(point(0), point(lengthMm));
    // Extension lines visibly align both ends with the full physical bounding rectangle.
    for (const mm of [0, lengthMm]) segment(point(mm, -gap), point(mm, gap * 0.45));
    const ticks = new Set<number>([0, lengthMm]);
    for (let mm = 0; mm < lengthMm; mm += 10) ticks.add(mm);
    for (const mm of ticks) segment(point(mm), point(mm, gap * (mm % 50 === 0 ? 0.42 : 0.2)));
    const labelStep = lengthMm >= 300 ? 100 : 50;
    const values = [0];
    for (let mm = labelStep; mm < lengthMm - labelStep / 2; mm += labelStep) values.push(mm);
    values.push(lengthMm);
    for (const mm of values)
      labels.push({
        axis,
        valueMm: mm,
        primary: false,
        endpoint: mm === 0 || mm === lengthMm,
        text: String(mm / 10),
        position: point(mm, gap * 1.05),
      });
    labels.push({
      axis,
      valueMm: lengthMm,
      primary: true,
      endpoint: false,
      text: `${lengthMm / 10} см`,
      position: point(lengthMm / 2, gap * (axis === 'width' ? 3 : 3.8)),
    });
  }
  return { positions, labels, widthMm: product.widthMm, heightMm: product.heightMm };
}

/** Symmetric camera allowance also covers the labels, whichever way the mat is viewed. */
export function rulerFrameProduct(product: ProductDefinition): ProductDefinition {
  const paddingMm = rulerGap(product) * 6000;
  return {
    ...product,
    widthMm: product.widthMm + paddingMm * 2,
    heightMm: product.heightMm + paddingMm * 2,
  };
}
