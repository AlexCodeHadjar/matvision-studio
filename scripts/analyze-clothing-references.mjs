import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

// The alpha mask gives the photographic outline. Seam/pocket/neck points below
// are visually annotated on the source PNGs, not inferred from invented sizing.
const sourceDirectory = process.argv[2] || 'C:/Users/alast/OneDrive/Рабочий стол/DTF — белые заготовки';
const outputDirectory = path.resolve('work/clothing-reference');
const references = [
  {
    id: 'hoodie-white', file: '01_Худи_белый.png', centerAxisPx: 500,
    physicalBodyHeightM: 0.70, bodyTopPx: 145, bodyBottomPx: 851,
    landmarks: { neckLeft: [386,150], neckRight: [614,150], shoulderRight: [748,188], armpitRight: [708,488], bodyHemRight: [690,849], bodyHemLeft: [313,851], cuffInnerRight: [758,970], cuffOuterRight: [834,970], cuffTopInnerRight: [751,895], cuffTopOuterRight: [849,895], bodyRibTopRight: [698,784], bodyRibBottomRight: [690,849], hoodTop: [500,38], hoodLeft: [341,107], hoodRight: [657,104], hoodFrontBottom: [506,172], pocketTopLeft: [365,515], pocketTopRight: [642,515], pocketBottomLeft: [311,780], pocketBottomRight: [701,780], stringLeftTop: [449,143], stringLeftBottom: [453,281], stringRightTop: [554,143], stringRightBottom: [540,280] },
    paths: {
      bodyHemToCuffInnerRight: [[690,849],[692,824],[699,785],[703,740],[705,690],[706,630],[708,560],[707,504],[709,487],[711,502],[718,541],[724,579],[729,630],[734,698],[738,770],[744,832],[751,895],[758,970]],
      cuffOuterToNeckRight: [[834,970],[842,937],[849,900],[860,860],[864,805],[866,744],[864,689],[861,626],[857,560],[851,492],[843,439],[834,389],[823,338],[814,300],[800,261],[783,223],[766,199],[748,188],[705,167],[664,149],[614,150]],
      bodyRibTop: [[306,784],[360,788],[500,787],[650,788],[698,784]],
      bodyRibBottom: [[313,851],[360,850],[500,850],[650,850],[690,849]],
      hoodOuter: [[341,107],[350,71],[375,48],[425,39],[500,38],[574,41],[628,52],[650,75],[657,104],[658,132]],
      hoodOpening: [[357,78],[390,66],[450,63],[510,63],[568,68],[614,78],[633,91],[605,117],[556,138],[504,155],[450,141],[397,122],[364,99],[357,78]],
      pocketOutline: [[365,515],[435,516],[540,516],[642,515],[651,565],[669,624],[686,692],[701,780],[626,786],[499,784],[372,785],[311,780],[329,699],[345,630],[357,565],[365,515]],
    },
  },
  {
    id: 'sweatshirt-white', file: '02_Свитшот_белый.png', centerAxisPx: 347,
    physicalBodyHeightM: 0.70, bodyTopPx: 53, bodyBottomPx: 621,
    landmarks: { neckLeft: [266,54], neckRight: [423,53], shoulderRight: [575,128], armpitRight: [506,391], bodyHemRight: [497,619], bodyHemLeft: [193,621], cuffInnerRight: [519,657], cuffOuterRight: [590,662], cuffTopInnerRight: [522,610], cuffTopOuterRight: [603,616], bodyRibTopRight: [501,570], bodyRibBottomRight: [497,619], collarTop: [347,43], collarFrontBottom: [347,103] },
    paths: {
      bodyHemToCuffInnerRight: [[497,619],[500,592],[501,570],[501,536],[500,497],[500,455],[500,421],[502,399],[506,391],[510,412],[515,455],[519,500],[523,540],[521,581],[522,610],[519,657]],
      cuffOuterToNeckRight: [[590,662],[596,633],[603,616],[608,579],[611,531],[611,482],[611,431],[608,381],[605,340],[601,291],[598,246],[596,202],[593,170],[584,143],[575,128],[554,113],[522,99],[486,86],[452,73],[423,53]],
      bodyRibTop: [[193,570],[250,572],[347,571],[440,572],[501,570]],
      bodyRibBottom: [[193,621],[250,620],[347,621],[440,620],[497,619]],
      collarOuter: [[266,54],[276,77],[301,96],[347,103],[390,96],[417,78],[423,53]],
      collarOpening: [[276,53],[293,45],[347,43],[403,47],[418,54],[407,73],[382,81],[347,85],[312,81],[286,72],[276,53]],
    },
  },
  {
    id: 'longsleeve-white', file: '04_Лонгслив_белый.png', centerAxisPx: 350,
    physicalBodyHeightM: 0.70, bodyTopPx: 27, bodyBottomPx: 625,
    landmarks: { neckLeft: [268,27], neckRight: [432,29], shoulderRight: [559,89], armpitRight: [506,238], bodyHemRight: [504,624], bodyHemLeft: [189,625], cuffInnerRight: [574,681], cuffOuterRight: [637,683], cuffTopInnerRight: [571,660], cuffTopOuterRight: [634,660], bodyRibTopRight: [504,604], bodyRibBottomRight: [504,624], collarTop: [350,32], collarFrontBottom: [350,80] },
    paths: {
      bodyHemToCuffInnerRight: [[504,624],[504,580],[504,539],[503,500],[501,460],[499,420],[498,380],[497,340],[496,300],[498,266],[503,246],[506,238],[511,251],[517,274],[522,303],[529,326],[535,352],[541,382],[545,424],[548,462],[552,505],[557,546],[562,585],[567,622],[571,660],[574,681]],
      cuffOuterToNeckRight: [[637,683],[635,663],[634,628],[634,585],[633,543],[635,503],[636,462],[635,423],[632,381],[628,342],[624,307],[620,278],[616,248],[611,223],[603,188],[596,157],[587,128],[575,106],[559,89],[533,74],[500,59],[466,44],[432,29]],
      bodyHemTop: [[189,604],[270,605],[350,605],[430,605],[504,604]],
      bodyHemBottom: [[189,625],[270,626],[350,626],[430,625],[504,624]],
      collarOuter: [[261,26],[269,46],[291,65],[320,77],[350,80],[384,74],[412,59],[432,39],[440,29]],
      collarOpening: [[269,30],[286,34],[320,37],[350,38],[385,36],[418,33],[432,31],[426,48],[407,61],[382,67],[350,70],[322,67],[295,57],[278,43],[269,30]],
    },
  },
];

function signedArea(points) {
  return points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
}
function simplify(points, epsilon = 2) {
  if (points.length < 3) return points;
  const a = points[0], b = points.at(-1), dx = b[0] - a[0], dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  let farthest = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
    const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (d > farthest) { farthest = d; index = i; }
  }
  if (farthest <= epsilon) return [a, b];
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
}
function analyze(reference) {
  const file = path.join(sourceDirectory, reference.file);
  const sourceBytes = fs.readFileSync(file);
  const png = PNG.sync.read(sourceBytes);
  const { width, height } = png;
  const mask = new Uint8Array(width * height);
  let xMin = width, yMin = height, xMax = 0, yMax = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (png.data[(y * width + x) * 4 + 3] < 128) continue;
    mask[y * width + x] = 1; count++;
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
  }
  const on = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  const edges = new Map();
  const key = (x, y) => y * (width + 1) + x;
  const edge = (x1, y1, x2, y2) => { const k = key(x1, y1); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(key(x2, y2)); };
  for (let y = yMin; y <= yMax; y++) for (let x = xMin; x <= xMax; x++) if (on(x, y)) {
    if (!on(x, y - 1)) edge(x, y, x + 1, y);
    if (!on(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) edge(x, y + 1, x, y);
  }
  const loops = [];
  while (edges.size) {
    const first = edges.keys().next().value, loop = [];
    let cursor = first;
    for (let safety = 0; safety < width * height * 4; safety++) {
      loop.push([cursor % (width + 1), Math.floor(cursor / (width + 1))]);
      const next = edges.get(cursor);
      if (!next?.length) break;
      const target = next.pop(); if (!next.length) edges.delete(cursor);
      cursor = target;
      if (cursor === first) break;
    }
    if (loop.length > 2) loops.push(loop);
  }
  loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const contour = loops[0];
  const closed = [...contour, contour[0]];
  const referenceHeight = yMax - yMin + 1;
  const metresPerPixel = reference.physicalBodyHeightM / (reference.bodyBottomPx - reference.bodyTopPx);
  const normalize = ([x, y]) => [Number(((x - reference.centerAxisPx) / referenceHeight).toFixed(6)), Number(((yMax + 1 - y) / referenceHeight).toFixed(6))];
  const physical = ([x, y]) => [Number(((x - reference.centerAxisPx) * metresPerPixel).toFixed(6)), Number(((yMax + 1 - y) * metresPerPixel).toFixed(6))];
  const rows = [];
  for (let y = yMin; y <= yMax; y += 10) {
    const segments = []; let start = -1;
    for (let x = xMin; x <= xMax + 1; x++) { const filled = on(x, y); if (filled && start < 0) start = x; if (!filled && start >= 0) { segments.push([start, x - 1]); start = -1; } }
    rows.push({ yPx: y, segmentsPx: segments });
  }
  return {
    ...reference, sourcePath: file, sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), image: { width, height }, mask: { method: 'source alpha >= 128', filledPixels: count },
    boundsPx: { xMin, yMin, xMax, yMax, width: xMax - xMin + 1, height: referenceHeight },
    silhouetteRatios: { fullWidthToFullHeight: (xMax - xMin + 1) / referenceHeight, bodyHeightToFullHeight: (reference.bodyBottomPx - reference.bodyTopPx) / referenceHeight, cuffBelowBodyHemToFullHeight: (yMax - reference.bodyBottomPx) / referenceHeight, bodyHemWidthToFullHeight: (reference.landmarks.bodyHemRight[0] - reference.landmarks.bodyHemLeft[0]) / referenceHeight },
    calibration: { note: 'Body height is a chosen physical template, not a measurement of a photographed sample. Normalized coordinates use full alpha bounds height, x origin at center axis; y upward from lowest alpha pixel. For product.heightMm mapping multiply normalized coordinates by product.heightMm / 1000.', metresPerPixel, assumedBodyHeightM: reference.physicalBodyHeightM, resultingTotalHeightM: referenceHeight * metresPerPixel },
    landmarksNormalized: Object.fromEntries(Object.entries(reference.landmarks).map(([k,p]) => [k, normalize(p)])),
    landmarksPhysicalM: Object.fromEntries(Object.entries(reference.landmarks).map(([k,p]) => [k, physical(p)])),
    pathsNormalized: Object.fromEntries(Object.entries(reference.paths).map(([k,p]) => [k, p.map(normalize)])),
    externalContourPx: simplify(closed, 1.5), externalContourNormalized: simplify(closed, 1.5).map(normalize),
    externalContourRawPointCount: contour.length, scanlineSegments: rows,
    annotationPrecisionPx: 3, annotationMethod: 'Visual tracing of seam paths and features; external contour and bounds are exact alpha-mask measurements.',
  };
}
fs.mkdirSync(outputDirectory, { recursive: true });
const result = { schemaVersion: 1, createdAt: new Date().toISOString(), references: references.map(analyze) };
fs.writeFileSync(path.join(outputDirectory, 'measurements.json'), JSON.stringify(result, null, 2));
for (const reference of result.references) console.log(reference.id, JSON.stringify(reference.boundsPx), 'body calibrated height:', reference.calibration.resultingTotalHeightM.toFixed(3), 'm');
