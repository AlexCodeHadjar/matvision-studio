import type {
  ProductDefinition,
  ProjectState,
  PrintSide,
  SidePrint,
  PrintSource,
  PrintLayout,
  ProductKind,
} from '../contracts';

export const PRODUCT_CATEGORIES: readonly [ProductKind, string][] = [
  ['mat', 'Коврик'],
  ['tshirt', 'Футболка'],
  ['mug', 'Кружка'],
  ['hoodie', 'Худи'],
  ['sweatshirt', 'Свитшот'],
  ['tote', 'Сумка-шоппер'],
  ['longsleeve', 'Лонгслив'],
  ['polo', 'Поло'],
  ['cap', 'Бейсболка'],
  ['apron', 'Фартук'],
];

function blank(
  kind: ProductKind,
  name: string,
  widthMm: number,
  heightMm: number,
  area: [number, number, number, number],
  description: string,
  sourceUrl: string,
  back?: [number, number, number, number],
): ProductDefinition {
  const rect = ([xMm, yMm, widthMm, heightMm]: typeof area) => ({ xMm, yMm, widthMm, heightMm });
  const h = heightMm / 1000;
  const referenceCut = ['hoodie', 'sweatshirt', 'longsleeve', 'polo'].includes(kind);
  const distance = referenceCut ? h * 2 : (Math.max(widthMm, heightMm) / 1000) * 2.15;
  return {
    id: `${kind}-white`,
    kind,
    displayName: name,
    widthMm,
    heightMm,
    thicknessMm: 2,
    cornerRadiusMm: 0,
    edgePreset: 'standard-cut',
    surfaceMaterialPreset: 'fine-weave',
    bleedMm: 0,
    printableArea: rect(area),
    backPrintableArea: back ? rect(back) : undefined,
    defaultCameraFraming: {
      position: kind === 'cap' ? [0.28, 0.25, 0.72] : [distance * 0.12, h * 0.66, distance],
      target: [0, h * 0.5, kind === 'cap' ? 0.035 : 0],
      fovDeg: 35,
    },
    description: `${description} Базовый шаблон визуализации; размер и допустимую зону DTF уточняйте у печатника.`,
    sourceUrl,
  };
}

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
  blank(
    'hoodie',
    'Худи · белый футер',
    1040,
    820,
    [370, 240, 300, 160],
    'Объёмный капюшон, шнуры, карман-кенгуру и рибана. Передний принт размещается выше кармана и ниже шнуров.',
    'https://stantex.ru/product/hudi-uniseks-futer-s-nachyosom-260-belyj/',
    [370, 255, 300, 340],
  ),
  blank(
    'sweatshirt',
    'Свитшот · белый футер',
    1000,
    720,
    [350, 150, 300, 380],
    'Свободный корпус, круглая горловина, манжеты и пояс. Передняя и задняя стороны печатаются отдельно.',
    'https://stantex.ru/product/svitshot-uniseks-futer-bez-nachyosa-350-belyj/',
    [350, 125, 300, 380],
  ),
  blank(
    'tote',
    'Сумка-шоппер · белый хлопок',
    400,
    750,
    [60, 390, 280, 280],
    'Открытая сумка с двумя плоскими ручками. Печать на обеих сторонах мешка с отступом от креплений ручек и швов.',
    'https://stantex.ru/product/sumka-shoper-200-belyj/',
    [60, 390, 280, 280],
  ),
  blank(
    'longsleeve',
    'Лонгслив · белое джерси',
    960,
    720,
    [330, 150, 300, 380],
    'Тонкий трикотаж, длинные рукава и простой подгиб. Принт на корпусе, вне горловины и рукавов.',
    'https://stantex.ru/product/longsliv-hlopok-elastan-180-belyj/',
    [330, 125, 300, 380],
  ),
  blank(
    'polo',
    'Поло · белое пике',
    800,
    720,
    [250, 260, 300, 300],
    'Отложной воротник и планка с пуговицами. Передняя зона начинается ниже планки; спина доступна отдельно.',
    'https://stantex.ru/product/rubashka-polo-uniseks-hlopok-100-185-belyj/',
    [250, 135, 300, 380],
  ),
  blank(
    'cap',
    'Бейсболка · белая пятиклинка',
    240,
    160,
    [75, 45, 90, 45],
    'Изогнутый козырёк и объёмная тулья. Принт только на передней панели, без козырька, верхней кнопки и швов; нужен пресс для головных уборов.',
    'https://stantex.ru/product/bejsbolka-5-klinev-hlopok-280-belyj-2/',
  ),
  blank(
    'apron',
    'Фартук · белый с карманом',
    700,
    1000,
    [240, 225, 220, 220],
    'Нагрудник, шейная петля, поясные завязки и карман. Печать на нагруднике, выше кармана и ниже верхнего края.',
    'https://komus-reklama.ru/product/fartuk-ducasse-belyy/',
  ),
  {
    id: 'tshirt-gildan-5000',
    kind: 'tshirt',
    displayName: 'Gildan 5000 · Classic Fit',
    description:
      'Хлопковый трикотаж 170–180 г/м². Классический крой. DTG / DTF. Зона 30 × 38 см — безопасный базовый шаблон; у поставщика и размера она может отличаться.',
    sourceUrl: 'https://www.printful.com/blog/gildan-5000-vs-bella-canvas-3001',
    widthMm: 800,
    heightMm: 720,
    thicknessMm: 2,
    cornerRadiusMm: 0,
    edgePreset: 'standard-cut',
    surfaceMaterialPreset: 'fine-weave',
    bleedMm: 0,
    printableArea: { xMm: 250, yMm: 145, widthMm: 300, heightMm: 380 },
    backPrintableArea: { xMm: 250, yMm: 120, widthMm: 300, heightMm: 380 },
    defaultCameraFraming: { position: [0.25, 0.54, 1.65], target: [0, 0.36, 0], fovDeg: 35 },
  },
  {
    id: 'tshirt-bella-3001',
    kind: 'tshirt',
    displayName: 'Bella + Canvas 3001 · Retail Fit',
    description:
      'Мягкий гребенной хлопок 142 г/м². Более приталенный крой. DTG / DTF. Базовая зона 30 × 38 см; точный шаблон зависит от размера и печатника.',
    sourceUrl:
      'https://www.printful.com/custom/brands/bella-canvas/unisex-staple-t-shirt-bella-canvas-3001',
    widthMm: 760,
    heightMm: 720,
    thicknessMm: 2,
    cornerRadiusMm: 0,
    edgePreset: 'standard-cut',
    surfaceMaterialPreset: 'smooth-cloth',
    bleedMm: 0,
    printableArea: { xMm: 230, yMm: 145, widthMm: 300, heightMm: 380 },
    backPrintableArea: { xMm: 230, yMm: 120, widthMm: 300, heightMm: 380 },
    defaultCameraFraming: { position: [0.25, 0.54, 1.65], target: [0, 0.36, 0], fovDeg: 35 },
  },
  {
    id: 'mug-11oz',
    kind: 'mug',
    displayName: 'Керамическая кружка · 11 oz / 330 мл',
    description:
      'Белая глянцевая керамика с покрытием для сублимации. Диаметр 80 мм, высота 95 мм. Безопасная базовая развёртка 200 × 85 мм; ручка, бортик и дно остаются без печати.',
    sourceUrl: 'https://printify.com/app/products/503/generic-brand/white-ceramic-mug-11oz',
    widthMm: Math.PI * 80,
    heightMm: 95,
    thicknessMm: 3,
    cornerRadiusMm: 0,
    mugDiameterMm: 80,
    edgePreset: 'standard-cut',
    surfaceMaterialPreset: 'smooth-cloth',
    bleedMm: 0,
    printableArea: { xMm: (Math.PI * 80 - 200) / 2, yMm: 5, widthMm: 200, heightMm: 85 },
    defaultCameraFraming: { position: [0.14, 0.13, 0.28], target: [0.012, 0.048, 0], fovDeg: 35 },
  },
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

export function productKind(product: ProductDefinition) {
  return product.kind ?? 'mat';
}
export function isTextile(product: ProductDefinition) {
  return productKind(product) !== 'mat' && productKind(product) !== 'mug';
}
export function activePrintArea(state: ProjectState) {
  const product = getProduct(state.productId);
  return state.printSide === 'back' && product.backPrintableArea
    ? product.backPrintableArea
    : product.printableArea;
}
export function sidePrint(state: ProjectState, side: PrintSide): SidePrint {
  if ((state.printSide ?? 'front') === side) return { source: state.source, layout: state.layout };
  return (
    state.sidePrints?.[side] ?? {
      source: null,
      layout: { mode: 'contain', scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 },
    }
  );
}

/** Centre horizontally; align artwork's actual top below the collar, including wide images. */
export function initialPrintLayout(
  productId: string,
  source: PrintSource | null,
  side: PrintSide = 'front',
): PrintLayout {
  const product = getProduct(productId),
    kind = productKind(product);
  const result: PrintLayout = {
    mode: kind === 'mat' ? 'cover' : 'contain',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDeg: 0,
  };
  if (isTextile(product) && kind !== 'cap' && kind !== 'tote' && source) {
    const area =
      side === 'back' && product.backPrintableArea
        ? product.backPrintableArea
        : product.printableArea;
    const mmPerPx = Math.min(area.widthMm / source.widthPx, area.heightMm / source.heightPx);
    result.offsetY = (area.heightMm - source.heightPx * mmPerPx) / (2 * area.heightMm);
  }
  return result;
}

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
