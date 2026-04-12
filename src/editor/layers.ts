import { pushHistory } from "./history";
import type { AdjustmentKind, AdjustmentLayer, DocumentState, DropShadowEffect, GradientStop, Layer, LayerEffect, OutlineEffect, RasterLayer, ShapeKind, ShapeLayer, SmartObjectLayer, TextFill, TextLayer, TextLayerData, TextStroke } from "./types";
import { cloneCanvas, cloneLayer, createAdjustmentLayer, createLayerCanvas, createShapeLayer, createTextLayer, fillLayer, snapshotDocument, syncLayerSource } from "./documents";
import { defaultParamsForKind, ADJUSTMENT_LABELS } from "./adjustmentLayers";
import { createSmartObjectLayer } from "./smartObject";
import { nextId } from "./utils";
import { fitReplacementTextData, matchReplacementTextRendering, type ReplacementTextSignal, type ReplacementTextStyleHints } from "./textReplacementMatcher";

type ReplacementBounds = { x: number; y: number; width: number; height: number };

export interface RasterTextReplacementPiece {
  bounds: ReplacementBounds;
}

export interface RasterTextReplacementApplyPiece extends RasterTextReplacementPiece {
  text: string;
}

type ReplacementSampleBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ReplacementSignalAnalysis = {
  signal: ReplacementTextSignal;
  sampleBounds: ReplacementSampleBounds;
  rowMinX: number[];
  rowMaxX: number[];
  colorWeight: number;
  redSum: number;
  greenSum: number;
  blueSum: number;
};

type RawReplacementSignalComponent = {
  bounds: { x: number; y: number; width: number; height: number };
  pixelCount: number;
};

export function canDeleteLayer(doc: DocumentState, layer: Layer): boolean {
  return !layer.isBackground && doc.layers.length > 1;
}

export function addLayer(doc: DocumentState, name?: string): RasterLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  const layer: RasterLayer = {
    id: nextId("layer"),
    type: "raster",
    name: name ?? `Layer ${doc.layers.length + 1}`,
    canvas: createLayerCanvas(doc.width, doc.height),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    effects: [],
  };

  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addTextLayer(doc: DocumentState, x: number, y: number, name?: string, overrides: Partial<TextLayerData> = {}): TextLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const layer = createTextLayer(name ?? `Text ${doc.layers.length}`, x, y, overrides);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addShapeLayer(doc: DocumentState, kind: ShapeKind, x: number, y: number, name?: string): ShapeLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const label = kind === "rectangle" ? "Rectangle" : kind === "ellipse" ? "Ellipse" : "Line";
  const layer = createShapeLayer(name ?? `${label} ${doc.layers.length}`, kind, x, y);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addAdjustmentLayer(doc: DocumentState, kind: AdjustmentKind, name?: string): AdjustmentLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const label = name ?? `${ADJUSTMENT_LABELS[kind]} ${doc.layers.length}`;
  const layer = createAdjustmentLayer(label, { kind, params: defaultParamsForKind(kind) });
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addSmartObjectLayer(doc: DocumentState, source: HTMLCanvasElement, x = 0, y = 0, name?: string): SmartObjectLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const layer = createSmartObjectLayer(name ?? `Smart Object ${doc.layers.length}`, source, x, y);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

function clampReplacementSampleBounds(
  layer: Pick<RasterLayer, "x" | "y" | "canvas">,
  cleanedCanvas: HTMLCanvasElement,
  bounds: ReplacementBounds,
): ReplacementSampleBounds {
  const localLeft = Math.max(0, Math.floor(bounds.x - layer.x));
  const localTop = Math.max(0, Math.floor(bounds.y - layer.y));
  const localRight = Math.min(
    layer.canvas.width,
    cleanedCanvas.width,
    Math.ceil(bounds.x + bounds.width - layer.x),
  );
  const localBottom = Math.min(
    layer.canvas.height,
    cleanedCanvas.height,
    Math.ceil(bounds.y + bounds.height - layer.y),
  );
  return {
    left: localLeft,
    top: localTop,
    width: Math.max(0, localRight - localLeft),
    height: Math.max(0, localBottom - localTop),
  };
}

function pickContrastReplacementTextFillColor(canvas: HTMLCanvasElement, sampleBounds: ReplacementSampleBounds): string {
  const ctx = canvas.getContext("2d");
  if (!ctx || sampleBounds.width <= 0 || sampleBounds.height <= 0) {
    return "#111111";
  }

  const imageData = ctx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height).data;
  let totalWeight = 0;
  let luminanceSum = 0;
  for (let index = 0; index < imageData.length; index += 4) {
    const alpha = imageData[index + 3] / 255;
    if (alpha <= 0) {
      continue;
    }
    const luminance = (0.2126 * imageData[index]) + (0.7152 * imageData[index + 1]) + (0.0722 * imageData[index + 2]);
    luminanceSum += luminance * alpha;
    totalWeight += alpha;
  }

  if (totalWeight <= 0) {
    return "#111111";
  }

  return (luminanceSum / totalWeight) > 150 ? "#111111" : "#ffffff";
}

function toHexChannel(value: number): string {
  const channel = Math.max(0, Math.min(255, Math.round(value)));
  return channel.toString(16).padStart(2, "0");
}

function analyseReplacementTextSignal(
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  bounds: ReplacementBounds,
): ReplacementSignalAnalysis {
  const sampleBounds = clampReplacementSampleBounds(layer, cleanedCanvas, bounds);
  const originalCtx = layer.canvas.getContext("2d");
  const cleanedCtx = cleanedCanvas.getContext("2d");
  if (!originalCtx || !cleanedCtx || sampleBounds.width <= 0 || sampleBounds.height <= 0) {
    return {
      signal: {
        width: sampleBounds.width,
        height: sampleBounds.height,
        alphaMask: new Uint8ClampedArray(sampleBounds.width * sampleBounds.height),
        pixelCount: 0,
        rowWeights: Array.from({ length: sampleBounds.height }, () => 0),
        columnWeights: Array.from({ length: sampleBounds.width }, () => 0),
        box: null,
      },
      sampleBounds,
      rowMinX: Array.from({ length: sampleBounds.height }, () => Number.POSITIVE_INFINITY),
      rowMaxX: Array.from({ length: sampleBounds.height }, () => -1),
      colorWeight: 0,
      redSum: 0,
      greenSum: 0,
      blueSum: 0,
    };
  }

  const originalData = originalCtx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height).data;
  const cleanedData = cleanedCtx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height).data;

  const rowMinX = Array.from({ length: sampleBounds.height }, () => Number.POSITIVE_INFINITY);
  const rowMaxX = Array.from({ length: sampleBounds.height }, () => -1);
  const rowWeights = Array.from({ length: sampleBounds.height }, () => 0);
  const columnWeights = Array.from({ length: sampleBounds.width }, () => 0);
  const alphaMask = new Uint8ClampedArray(sampleBounds.width * sampleBounds.height);

  let minX = sampleBounds.width;
  let maxX = -1;
  let minY = sampleBounds.height;
  let maxY = -1;
  let textPixelCount = 0;
  let colorWeight = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;

  for (let y = 0; y < sampleBounds.height; y += 1) {
    for (let x = 0; x < sampleBounds.width; x += 1) {
      const index = ((y * sampleBounds.width) + x) * 4;
      const originalAlpha = originalData[index + 3] / 255;
      const cleanedAlpha = cleanedData[index + 3] / 255;
      if (originalAlpha <= 0 && cleanedAlpha <= 0) {
        continue;
      }

      const alphaDelta = Math.max(0, originalAlpha - cleanedAlpha);
      const colourDelta = (
        Math.abs(originalData[index] - cleanedData[index])
        + Math.abs(originalData[index + 1] - cleanedData[index + 1])
        + Math.abs(originalData[index + 2] - cleanedData[index + 2])
      ) / (255 * 3);
      const removedTextScore = Math.max(alphaDelta, colourDelta * originalAlpha);
      if (removedTextScore < 0.18) {
        continue;
      }

      const weight = removedTextScore * (0.25 + originalAlpha);
      alphaMask[(y * sampleBounds.width) + x] = Math.round(Math.max(0, Math.min(1, removedTextScore)) * 255);
      textPixelCount += 1;
      rowWeights[y] += weight;
      columnWeights[x] += weight;
      colorWeight += weight;
      redSum += originalData[index] * weight;
      greenSum += originalData[index + 1] * weight;
      blueSum += originalData[index + 2] * weight;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      rowMinX[y] = Math.min(rowMinX[y], x);
      rowMaxX[y] = Math.max(rowMaxX[y], x);
    }
  }

  return {
    signal: {
      width: sampleBounds.width,
      height: sampleBounds.height,
      alphaMask,
      pixelCount: textPixelCount,
      rowWeights,
      columnWeights,
      box: textPixelCount > 0 && maxX >= minX && maxY >= minY
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
    },
    sampleBounds,
    rowMinX,
    rowMaxX,
    colorWeight,
    redSum,
    greenSum,
    blueSum,
  };
}

const GRADIENT_NUM_BANDS = 4;
const GRADIENT_THRESHOLD = 50;
const STROKE_ALPHA_THRESHOLD = 128;
const STROKE_MIN_EDGE_PIXELS = 4;
const STROKE_COLOR_THRESHOLD = 60;
const STROKE_MAX_WIDTH = 8;

function detectGradientFromTextPixels(
  layerCanvas: HTMLCanvasElement,
  sampleBounds: ReplacementSampleBounds,
  textBox: { x: number; y: number; width: number; height: number },
): TextFill | null {
  const ctx = layerCanvas.getContext("2d");
  if (!ctx || sampleBounds.width <= 0 || sampleBounds.height <= 0) return null;

  const imageData = ctx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height);
  const data = imageData.data;
  const { width } = sampleBounds;

  const bandHeight = Math.max(1, Math.floor(textBox.height / GRADIENT_NUM_BANDS));
  const bandWidth = Math.max(1, Math.floor(textBox.width / GRADIENT_NUM_BANDS));
  const vertBands: { r: number; g: number; b: number; count: number }[] = [];
  const horizBands: { r: number; g: number; b: number; count: number }[] = [];

  for (let i = 0; i < GRADIENT_NUM_BANDS; i++) {
    vertBands.push({ r: 0, g: 0, b: 0, count: 0 });
    horizBands.push({ r: 0, g: 0, b: 0, count: 0 });
  }

  for (let y = textBox.y; y < textBox.y + textBox.height; y++) {
    for (let x = textBox.x; x < textBox.x + textBox.width; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] ?? 0;
      if (a < 128) continue;

      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;

      const vBand = Math.min(GRADIENT_NUM_BANDS - 1, Math.floor((y - textBox.y) / bandHeight));
      vertBands[vBand].r += r;
      vertBands[vBand].g += g;
      vertBands[vBand].b += b;
      vertBands[vBand].count += 1;

      const hBand = Math.min(GRADIENT_NUM_BANDS - 1, Math.floor((x - textBox.x) / bandWidth));
      horizBands[hBand].r += r;
      horizBands[hBand].g += g;
      horizBands[hBand].b += b;
      horizBands[hBand].count += 1;
    }
  }

  const avgColor = (band: { r: number; g: number; b: number; count: number }) => {
    if (band.count === 0) return null;
    return { r: band.r / band.count, g: band.g / band.count, b: band.b / band.count };
  };

  const vertColors = vertBands.map(avgColor);
  const horizColors = horizBands.map(avgColor);

  const colorDist = (a: { r: number; g: number; b: number } | null, b: { r: number; g: number; b: number } | null) => {
    if (!a || !b) return 0;
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  };

  const vertDist = colorDist(vertColors[0], vertColors[GRADIENT_NUM_BANDS - 1]);
  const horizDist = colorDist(horizColors[0], horizColors[GRADIENT_NUM_BANDS - 1]);

  if (vertDist < GRADIENT_THRESHOLD && horizDist < GRADIENT_THRESHOLD) {
    return null;
  }

  if (vertDist >= horizDist && vertDist >= GRADIENT_THRESHOLD) {
    const stops: GradientStop[] = vertColors
      .map((c, i) => c ? { offset: i / (GRADIENT_NUM_BANDS - 1), color: `#${toHexChannel(c.r)}${toHexChannel(c.g)}${toHexChannel(c.b)}` } : null)
      .filter((s): s is GradientStop => s !== null);
    if (stops.length >= 2) {
      return { type: "linear-gradient", angle: 90, stops };
    }
  }

  if (horizDist >= GRADIENT_THRESHOLD) {
    const stops: GradientStop[] = horizColors
      .map((c, i) => c ? { offset: i / (GRADIENT_NUM_BANDS - 1), color: `#${toHexChannel(c.r)}${toHexChannel(c.g)}${toHexChannel(c.b)}` } : null)
      .filter((s): s is GradientStop => s !== null);
    if (stops.length >= 2) {
      return { type: "linear-gradient", angle: 0, stops };
    }
  }

  return null;
}

function detectStrokeFromTextPixels(
  layerCanvas: HTMLCanvasElement,
  sampleBounds: ReplacementSampleBounds,
  textBox: { x: number; y: number; width: number; height: number },
): TextStroke | null {
  const ctx = layerCanvas.getContext("2d");
  if (!ctx || sampleBounds.width <= 0 || sampleBounds.height <= 0) return null;

  const imageData = ctx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height);
  const data = imageData.data;
  const { width } = sampleBounds;

  let edgeR = 0;
  let edgeG = 0;
  let edgeB = 0;
  let edgeCount = 0;
  let interiorR = 0;
  let interiorG = 0;
  let interiorB = 0;
  let interiorCount = 0;

  for (let y = textBox.y; y < textBox.y + textBox.height; y++) {
    for (let x = textBox.x; x < textBox.x + textBox.width; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] ?? 0;
      if (a < STROKE_ALPHA_THRESHOLD) continue;

      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;

      const hasTransparentNeighbor =
        ((data[((y - 1) * width + x) * 4 + 3] ?? 0) < STROKE_ALPHA_THRESHOLD)
        || ((data[((y + 1) * width + x) * 4 + 3] ?? 0) < STROKE_ALPHA_THRESHOLD)
        || ((data[(y * width + (x - 1)) * 4 + 3] ?? 0) < STROKE_ALPHA_THRESHOLD)
        || ((data[(y * width + (x + 1)) * 4 + 3] ?? 0) < STROKE_ALPHA_THRESHOLD);

      if (hasTransparentNeighbor) {
        edgeR += r;
        edgeG += g;
        edgeB += b;
        edgeCount++;
      } else {
        interiorR += r;
        interiorG += g;
        interiorB += b;
        interiorCount++;
      }
    }
  }

  if (edgeCount < STROKE_MIN_EDGE_PIXELS || interiorCount < STROKE_MIN_EDGE_PIXELS) return null;

  const edgeColor = { r: edgeR / edgeCount, g: edgeG / edgeCount, b: edgeB / edgeCount };
  const interiorColor = { r: interiorR / interiorCount, g: interiorG / interiorCount, b: interiorB / interiorCount };
  const dist = Math.sqrt(
    (edgeColor.r - interiorColor.r) ** 2
    + (edgeColor.g - interiorColor.g) ** 2
    + (edgeColor.b - interiorColor.b) ** 2,
  );

  if (dist < STROKE_COLOR_THRESHOLD) return null;

  const totalPixels = edgeCount + interiorCount;
  const edgeRatio = edgeCount / totalPixels;
  const minDim = Math.min(textBox.width, textBox.height);
  const estimatedWidth = Math.max(1, Math.round(edgeRatio * minDim / 2));

  return {
    color: `#${toHexChannel(edgeColor.r)}${toHexChannel(edgeColor.g)}${toHexChannel(edgeColor.b)}`,
    width: Math.min(estimatedWidth, STROKE_MAX_WIDTH),
  };
}

// ---------------------------------------------------------------------------
// Drop-shadow and outline effect detection
// ---------------------------------------------------------------------------

const SHADOW_ALPHA_MIN = 15;
const SHADOW_ALPHA_MAX = 200;
const SHADOW_SEARCH_MARGIN = 20;
const SHADOW_MIN_PIXELS = 8;
const SHADOW_NEAR_TEXT_RADIUS = 3;

export function detectDropShadowFromTextPixels(
  layerCanvas: HTMLCanvasElement,
  sampleBounds: ReplacementSampleBounds,
  textBox: { x: number; y: number; width: number; height: number },
): DropShadowEffect | null {
  const ctx = layerCanvas.getContext("2d");
  if (!ctx || sampleBounds.width <= 0 || sampleBounds.height <= 0) return null;

  const imgData = ctx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height);
  const data = imgData.data;
  const w = sampleBounds.width;

  const isTextPixel = (x: number, y: number): boolean => {
    if (x < textBox.x || x >= textBox.x + textBox.width || y < textBox.y || y >= textBox.y + textBox.height) return false;
    const idx = (y * w + x) * 4;
    return (data[idx + 3] ?? 0) >= 128;
  };

  const searchLeft = Math.max(0, textBox.x - SHADOW_SEARCH_MARGIN);
  const searchTop = Math.max(0, textBox.y - SHADOW_SEARCH_MARGIN);
  const searchRight = Math.min(sampleBounds.width, textBox.x + textBox.width + SHADOW_SEARCH_MARGIN);
  const searchBottom = Math.min(sampleBounds.height, textBox.y + textBox.height + SHADOW_SEARCH_MARGIN);

  let shadowR = 0;
  let shadowG = 0;
  let shadowB = 0;
  let shadowCount = 0;
  let offsetXSum = 0;
  let offsetYSum = 0;
  let maxDist = 0;

  const textCenterX = textBox.x + textBox.width / 2;
  const textCenterY = textBox.y + textBox.height / 2;

  for (let y = searchTop; y < searchBottom; y++) {
    for (let x = searchLeft; x < searchRight; x++) {
      if (isTextPixel(x, y)) continue;

      const idx = (y * w + x) * 4;
      const a = data[idx + 3] ?? 0;
      if (a < SHADOW_ALPHA_MIN || a > SHADOW_ALPHA_MAX) continue;

      let nearText = false;
      for (let dy = -SHADOW_NEAR_TEXT_RADIUS; dy <= SHADOW_NEAR_TEXT_RADIUS && !nearText; dy++) {
        for (let dx = -SHADOW_NEAR_TEXT_RADIUS; dx <= SHADOW_NEAR_TEXT_RADIUS && !nearText; dx++) {
          if (isTextPixel(x + dx, y + dy)) nearText = true;
        }
      }
      if (!nearText) continue;

      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;

      shadowR += r;
      shadowG += g;
      shadowB += b;
      shadowCount++;

      offsetXSum += (x - textCenterX);
      offsetYSum += (y - textCenterY);

      // Track max distance from nearest text pixel for blur estimation
      let minTextDist = Infinity;
      for (let dy = -SHADOW_SEARCH_MARGIN; dy <= SHADOW_SEARCH_MARGIN; dy++) {
        for (let dx = -SHADOW_SEARCH_MARGIN; dx <= SHADOW_SEARCH_MARGIN; dx++) {
          if (isTextPixel(x + dx, y + dy)) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            minTextDist = Math.min(minTextDist, dist);
          }
        }
      }
      if (minTextDist < Infinity) maxDist = Math.max(maxDist, minTextDist);
    }
  }

  if (shadowCount < SHADOW_MIN_PIXELS) return null;

  const avgR = Math.round(shadowR / shadowCount);
  const avgG = Math.round(shadowG / shadowCount);
  const avgB = Math.round(shadowB / shadowCount);
  const color = `#${toHexChannel(avgR)}${toHexChannel(avgG)}${toHexChannel(avgB)}`;

  const avgOffsetX = offsetXSum / shadowCount;
  const avgOffsetY = offsetYSum / shadowCount;
  const offsetX = Math.round(Math.sign(avgOffsetX) * Math.min(Math.abs(avgOffsetX) / (textBox.width / 4), 8));
  const offsetY = Math.round(Math.sign(avgOffsetY) * Math.min(Math.abs(avgOffsetY) / (textBox.height / 4), 8));

  const blur = Math.max(1, Math.round(maxDist));

  return {
    type: "drop-shadow",
    color,
    offsetX: Math.max(-12, Math.min(12, offsetX)),
    offsetY: Math.max(-12, Math.min(12, offsetY)),
    blur: Math.min(20, blur),
    opacity: 0.5,
    enabled: true,
  };
}

const OUTLINE_ALPHA_THRESHOLD = 100;
const OUTLINE_SEARCH_BAND = 6;
const OUTLINE_MIN_OUTER_PIXELS = 4;
const OUTLINE_MIN_INNER_PIXELS = 4;
const OUTLINE_COLOR_DIST_THRESHOLD = 40;

export function detectOutlineEffectFromTextPixels(
  layerCanvas: HTMLCanvasElement,
  sampleBounds: ReplacementSampleBounds,
  textBox: { x: number; y: number; width: number; height: number },
): OutlineEffect | null {
  const ctx = layerCanvas.getContext("2d");
  if (!ctx || sampleBounds.width <= 0 || sampleBounds.height <= 0) return null;

  const imgData = ctx.getImageData(sampleBounds.left, sampleBounds.top, sampleBounds.width, sampleBounds.height);
  const data = imgData.data;
  const w = sampleBounds.width;

  let outerR = 0;
  let outerG = 0;
  let outerB = 0;
  let outerCount = 0;
  let innerR = 0;
  let innerG = 0;
  let innerB = 0;
  let innerCount = 0;

  const scanTop = Math.max(0, textBox.y - OUTLINE_SEARCH_BAND);
  const scanBottom = Math.min(sampleBounds.height, textBox.y + textBox.height + OUTLINE_SEARCH_BAND);
  const scanLeft = Math.max(0, textBox.x - OUTLINE_SEARCH_BAND);
  const scanRight = Math.min(sampleBounds.width, textBox.x + textBox.width + OUTLINE_SEARCH_BAND);

  for (let y = scanTop; y < scanBottom; y++) {
    for (let x = scanLeft; x < scanRight; x++) {
      const idx = (y * w + x) * 4;
      const a = data[idx + 3] ?? 0;
      if (a < OUTLINE_ALPHA_THRESHOLD) continue;

      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;

      const outsideBox = x < textBox.x || x >= textBox.x + textBox.width || y < textBox.y || y >= textBox.y + textBox.height;

      if (outsideBox) {
        outerR += r;
        outerG += g;
        outerB += b;
        outerCount++;
      } else {
        innerR += r;
        innerG += g;
        innerB += b;
        innerCount++;
      }
    }
  }

  if (outerCount < OUTLINE_MIN_OUTER_PIXELS || innerCount < OUTLINE_MIN_INNER_PIXELS) return null;

  const outerColor = { r: outerR / outerCount, g: outerG / outerCount, b: outerB / outerCount };
  const innerColor = { r: innerR / innerCount, g: innerG / innerCount, b: innerB / innerCount };

  const dist = Math.sqrt(
    (outerColor.r - innerColor.r) ** 2
    + (outerColor.g - innerColor.g) ** 2
    + (outerColor.b - innerColor.b) ** 2,
  );

  if (dist < OUTLINE_COLOR_DIST_THRESHOLD) return null;

  const perimeter = 2 * (textBox.width + textBox.height);
  const estimatedWidth = Math.max(1, Math.min(6, Math.round(outerCount / Math.max(1, perimeter))));

  return {
    type: "outline",
    color: `#${toHexChannel(Math.round(outerColor.r))}${toHexChannel(Math.round(outerColor.g))}${toHexChannel(Math.round(outerColor.b))}`,
    width: estimatedWidth,
    opacity: 1,
    enabled: true,
  };
}

function inferReplacementTextStyleHints(
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  bounds: ReplacementBounds,
  analysis: ReplacementSignalAnalysis,
): ReplacementTextStyleHints {
  const fallbackFillColor = pickContrastReplacementTextFillColor(cleanedCanvas, analysis.sampleBounds);
  const { signal, rowMinX, rowMaxX, sampleBounds, colorWeight, redSum, greenSum, blueSum } = analysis;

  if (signal.pixelCount <= 0 || !signal.box || colorWeight <= 0) {
    return {
      alignment: "left",
      fillColor: fallbackFillColor,
      fill: { type: "solid", color: fallbackFillColor },
      stroke: null,
      effects: [],
      bold: false,
      italic: false,
    };
  }

  const boxWidth = signal.box.width;
  const boxHeight = signal.box.height;
  const leftMargin = signal.box.x;
  const rightMargin = sampleBounds.width - signal.box.x - signal.box.width;
  const coverage = signal.pixelCount / Math.max(1, boxWidth * boxHeight);
  const rowsWithSignal = rowMinX
    .map((startX, row) => (Number.isFinite(startX) ? row : -1))
    .filter((row) => row >= 0);

  let alignment: TextLayerData["alignment"] = "left";
  if (boxWidth <= sampleBounds.width * 0.82) {
    const centreSupported = Math.min(leftMargin, rightMargin) >= Math.max(6, sampleBounds.width * 0.12)
      && Math.abs(leftMargin - rightMargin) <= Math.max(6, sampleBounds.width * 0.1);
    const rightSupported = rightMargin <= Math.max(4, sampleBounds.width * 0.08)
      && leftMargin >= Math.max(10, sampleBounds.width * 0.2, rightMargin * 2 + 4);
    if (centreSupported) {
      alignment = "center";
    } else if (rightSupported) {
      alignment = "right";
    }
  }

  let italic = false;
  if (rowsWithSignal.length >= 8 && boxWidth >= 12 && boxHeight >= 10) {
    const sliceSize = Math.max(3, Math.floor(rowsWithSignal.length / 4));
    const topRows = rowsWithSignal.slice(0, sliceSize);
    const bottomRows = rowsWithSignal.slice(-sliceSize);
    const averageCenter = (rows: number[]) => rows.reduce((sum, row) => sum + ((rowMinX[row] + rowMaxX[row]) / 2), 0) / rows.length;
    const topCenter = averageCenter(topRows);
    const bottomCenter = averageCenter(bottomRows);
    const verticalSpan = Math.max(1, bottomRows[bottomRows.length - 1] - topRows[0]);
    const horizontalShift = bottomCenter - topCenter;
    italic = Math.abs(horizontalShift) >= Math.max(4, boxWidth * 0.12)
      && (Math.abs(horizontalShift) / verticalSpan) >= 0.18;
  }

  const bold = coverage >= 0.45 && boxWidth >= 12 && boxHeight >= 10;

  const fillColorHex = `#${toHexChannel(redSum / colorWeight)}${toHexChannel(greenSum / colorWeight)}${toHexChannel(blueSum / colorWeight)}`;

  const detectedGradient = detectGradientFromTextPixels(layer.canvas, analysis.sampleBounds, signal.box);
  const detectedStroke = detectStrokeFromTextPixels(layer.canvas, analysis.sampleBounds, signal.box);
  const fill: TextFill = detectedGradient ?? { type: "solid", color: fillColorHex };

  const detectedShadow = detectDropShadowFromTextPixels(layer.canvas, analysis.sampleBounds, signal.box);
  const detectedOutline = detectOutlineEffectFromTextPixels(layer.canvas, analysis.sampleBounds, signal.box);
  const effects: LayerEffect[] = [];
  if (detectedShadow) effects.push(detectedShadow);
  if (detectedOutline) effects.push(detectedOutline);

  return {
    alignment,
    fillColor: fillColorHex,
    fill,
    stroke: detectedStroke,
    effects,
    bold,
    italic,
  };
}

function extractReplacementSignalComponents(signal: ReplacementTextSignal): RawReplacementSignalComponent[] {
  if (signal.width <= 0 || signal.height <= 0 || signal.pixelCount <= 0) {
    return [];
  }

  const visited = new Uint8Array(signal.width * signal.height);
  const queue = new Int32Array(signal.width * signal.height);
  const components: RawReplacementSignalComponent[] = [];

  const toIndex = (x: number, y: number) => y * signal.width + x;
  const isFilled = (index: number) => (signal.alphaMask[index] ?? 0) > 0;

  for (let startY = 0; startY < signal.height; startY += 1) {
    for (let startX = 0; startX < signal.width; startX += 1) {
      const startIndex = toIndex(startX, startY);
      if (visited[startIndex] || !isFilled(startIndex)) {
        continue;
      }

      let queueStart = 0;
      let queueEnd = 0;
      queue[queueEnd++] = startIndex;
      visited[startIndex] = 1;

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      let pixelCount = 0;

      while (queueStart < queueEnd) {
        const currentIndex = queue[queueStart++];
        const x = currentIndex % signal.width;
        const y = Math.floor(currentIndex / signal.width);
        pixelCount += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbors = [
          x > 0 ? currentIndex - 1 : -1,
          x + 1 < signal.width ? currentIndex + 1 : -1,
          y > 0 ? currentIndex - signal.width : -1,
          y + 1 < signal.height ? currentIndex + signal.width : -1,
        ];

        for (const neighborIndex of neighbors) {
          if (neighborIndex < 0 || visited[neighborIndex] || !isFilled(neighborIndex)) {
            continue;
          }
          visited[neighborIndex] = 1;
          queue[queueEnd++] = neighborIndex;
        }
      }

      components.push({
        bounds: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        pixelCount,
      });
    }
  }

  return components.sort((left, right) => {
    if (left.bounds.y !== right.bounds.y) {
      return left.bounds.y - right.bounds.y;
    }
    return left.bounds.x - right.bounds.x;
  });
}

function clampToRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function shouldMergeReplacementComponents(
  left: RawReplacementSignalComponent,
  right: RawReplacementSignalComponent,
  horizontalGap: number,
  verticalGap: number,
) {
  const leftRight = left.bounds.x + left.bounds.width;
  const rightRight = right.bounds.x + right.bounds.width;
  const leftBottom = left.bounds.y + left.bounds.height;
  const rightBottom = right.bounds.y + right.bounds.height;
  const horizontalOverlap = left.bounds.x <= rightRight + horizontalGap && right.bounds.x <= leftRight + horizontalGap;
  const verticalOverlap = left.bounds.y <= rightBottom + verticalGap && right.bounds.y <= leftBottom + verticalGap;
  return horizontalOverlap && verticalOverlap;
}

function mergeReplacementComponents(
  left: RawReplacementSignalComponent,
  right: RawReplacementSignalComponent,
): RawReplacementSignalComponent {
  const minX = Math.min(left.bounds.x, right.bounds.x);
  const minY = Math.min(left.bounds.y, right.bounds.y);
  const maxX = Math.max(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width);
  const maxY = Math.max(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height);
  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    pixelCount: left.pixelCount + right.pixelCount,
  };
}

export function detectRasterTextReplacementPieces(
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  bounds: ReplacementBounds,
): RasterTextReplacementPiece[] {
  const analysis = analyseReplacementTextSignal(layer, cleanedCanvas, bounds);
  if (analysis.signal.pixelCount <= 0 || !analysis.signal.box) {
    return [{ bounds }];
  }

  const rawComponents = extractReplacementSignalComponents(analysis.signal);
  if (rawComponents.length <= 1) {
    return [{
      bounds: {
        x: layer.x + analysis.sampleBounds.left + analysis.signal.box.x,
        y: layer.y + analysis.sampleBounds.top + analysis.signal.box.y,
        width: analysis.signal.box.width,
        height: analysis.signal.box.height,
      },
    }];
  }

  const minimumPixelCount = Math.max(4, Math.min(24, Math.round(analysis.signal.pixelCount * 0.01)));
  let merged = rawComponents.filter((component) => component.pixelCount >= minimumPixelCount);
  if (merged.length === 0) {
    merged = rawComponents;
  }

  const averageHeight = merged.reduce((sum, component) => sum + component.bounds.height, 0) / Math.max(1, merged.length);
  const horizontalGap = clampToRange(Math.round(averageHeight * 0.9), 6, 28);
  const verticalGap = clampToRange(Math.round(averageHeight * 0.45), 3, 16);

  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex += 1) {
        if (!shouldMergeReplacementComponents(merged[leftIndex], merged[rightIndex], horizontalGap, verticalGap)) {
          continue;
        }
        merged[leftIndex] = mergeReplacementComponents(merged[leftIndex], merged[rightIndex]);
        merged.splice(rightIndex, 1);
        changed = true;
        break outer;
      }
    }
  }

  const padding = clampToRange(Math.round(averageHeight * 0.15), 1, 4);
  const selectionLeft = bounds.x;
  const selectionTop = bounds.y;
  const selectionRight = bounds.x + bounds.width;
  const selectionBottom = bounds.y + bounds.height;

  return merged
    .map((component) => {
      const pieceLeft = layer.x + analysis.sampleBounds.left + component.bounds.x;
      const pieceTop = layer.y + analysis.sampleBounds.top + component.bounds.y;
      const pieceRight = pieceLeft + component.bounds.width;
      const pieceBottom = pieceTop + component.bounds.height;
      return {
        bounds: {
          x: Math.max(selectionLeft, pieceLeft - padding),
          y: Math.max(selectionTop, pieceTop - padding),
          width: Math.max(1, Math.min(selectionRight, pieceRight + padding) - Math.max(selectionLeft, pieceLeft - padding)),
          height: Math.max(1, Math.min(selectionBottom, pieceBottom + padding) - Math.max(selectionTop, pieceTop - padding)),
        },
      } satisfies RasterTextReplacementPiece;
    })
    .sort((left, right) => {
      if (left.bounds.y !== right.bounds.y) {
        return left.bounds.y - right.bounds.y;
      }
      return left.bounds.x - right.bounds.x;
    });
}

export function replaceRasterTextWithEditableLayers(
  doc: DocumentState,
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  replacements: RasterTextReplacementApplyPiece[],
  historyLabel: string,
): TextLayer[] {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  const preparedReplacements = replacements.map((replacement) => {
    const analysis = analyseReplacementTextSignal(layer, cleanedCanvas, replacement.bounds);
    const styleHints = inferReplacementTextStyleHints(layer, cleanedCanvas, replacement.bounds, analysis);
    const match = matchReplacementTextRendering(replacement.text, replacement.bounds, styleHints, analysis.signal);
    const textLayer = createTextLayer(
      `Text ${doc.layers.length + 1}`,
      Math.round(replacement.bounds.x),
      Math.round(replacement.bounds.y),
      fitReplacementTextData(replacement.text, replacement.bounds, styleHints, {
        fontFamily: match.fontFamily,
        lineHeight: match.lineHeight,
        kerning: match.kerning,
      }),
    );
    if (styleHints.effects.length > 0) {
      textLayer.effects = [...styleHints.effects];
    }
    return textLayer;
  });

  layer.canvas = cloneCanvas(cleanedCanvas);
  syncLayerSource(layer);

  const layerIndex = doc.layers.findIndex((entry) => entry.id === layer.id);
  doc.layers.splice(layerIndex >= 0 ? layerIndex + 1 : doc.layers.length, 0, ...preparedReplacements);
  const lastTextLayer = preparedReplacements[preparedReplacements.length - 1] ?? null;
  if (lastTextLayer) {
    doc.activeLayerId = lastTextLayer.id;
    doc.selectedLayerIds = preparedReplacements.length > 1
      ? preparedReplacements.map((textLayer) => textLayer.id)
      : [];
  }
  doc.dirty = true;
  pushHistory(doc, historyLabel);
  return preparedReplacements;
}

export function replaceRasterTextWithEditableLayer(
  doc: DocumentState,
  layer: RasterLayer,
  cleanedCanvas: HTMLCanvasElement,
  text: string,
  bounds: { x: number; y: number; width: number; height: number },
  historyLabel: string,
): TextLayer {
  return replaceRasterTextWithEditableLayers(
    doc,
    layer,
    cleanedCanvas,
    [{ text, bounds }],
    historyLabel,
  )[0]!;
}

export function moveLayer(doc: DocumentState, layerId: string, direction: -1 | 1): boolean {
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return false;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= doc.layers.length) return false;
  if (doc.layers[index].isBackground || doc.layers[nextIndex].isBackground) return false;

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const [layer] = doc.layers.splice(index, 1);
  doc.layers.splice(nextIndex, 0, layer);
  pushHistory(doc, `Reordered ${layer.name}`);
  return true;
}

export function duplicateLayer(doc: DocumentState, layerId: string): Layer | null {
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return null;

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const duplicate = cloneLayer(doc.layers[index]);
  duplicate.name = `${doc.layers[index].name} Copy`;
  doc.layers.splice(index + 1, 0, duplicate);
  doc.activeLayerId = duplicate.id;
  pushHistory(doc, `Duplicated ${doc.layers[index].name}`);
  return duplicate;
}

export function renameLayer(doc: DocumentState, layerId: string, nextName: string): boolean {
  const layer = doc.layers.find((item) => item.id === layerId);
  const normalized = nextName.trim();
  if (!layer || !normalized || normalized === layer.name) return false;

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.name = normalized;
  pushHistory(doc, `Renamed layer to ${normalized}`);
  return true;
}

export function deleteLayer(doc: DocumentState, layerId: string): { ok: boolean; deletedName?: string; reason?: string } {
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return { ok: false, reason: "not-found" };
  const layer = doc.layers[index];
  if (!canDeleteLayer(doc, layer)) {
    return { ok: false, reason: "protected" };
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  doc.layers.splice(index, 1);
  doc.activeLayerId = doc.layers[Math.max(0, index - 1)]?.id ?? doc.layers[0].id;
  pushHistory(doc, `Deleted ${layer.name}`);
  return { ok: true, deletedName: layer.name };
}

export function toggleLayerVisibility(doc: DocumentState, layerId: string): boolean {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) return false;
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.visible = !layer.visible;
  pushHistory(doc, `${layer.visible ? "Showed" : "Hid"} ${layer.name}`);
  return true;
}

export function toggleLayerLock(doc: DocumentState, layerId: string): boolean {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) return false;
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.locked = !layer.locked;
  pushHistory(doc, `${layer.locked ? "Locked" : "Unlocked"} ${layer.name}`);
  return true;
}

export function setBackgroundLayerColor(doc: DocumentState, color: string): boolean {
  const backgroundLayer = doc.layers[0];
  if (!backgroundLayer?.isBackground) return false;
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  fillLayer(backgroundLayer, color);
  pushHistory(doc, "Changed background colour");
  return true;
}

export function selectLayer(doc: DocumentState, layerId: string): boolean {
  const exists = doc.layers.some((layer) => layer.id === layerId);
  if (!exists) return false;
  doc.activeLayerId = layerId;
  doc.selectedLayerIds = [];
  return true;
}

/**
 * Toggle a layer in/out of the multi-selection (Ctrl+click).
 * The active layer always stays selected. If the toggled layer was the active
 * layer and it's being removed from multi-select, we just ignore (keep it).
 */
export function toggleLayerMultiSelect(doc: DocumentState, layerId: string): boolean {
  const exists = doc.layers.some((layer) => layer.id === layerId);
  if (!exists) return false;

  // Bootstrap: if selectedLayerIds is empty, seed it with the current active layer
  if (doc.selectedLayerIds.length === 0) {
    doc.selectedLayerIds = [doc.activeLayerId];
  }

  const idx = doc.selectedLayerIds.indexOf(layerId);
  if (idx >= 0) {
    // Deselect — but don't remove the active layer from the list
    if (layerId === doc.activeLayerId) return false;
    doc.selectedLayerIds.splice(idx, 1);
    // If only 1 left, collapse back to single-select
    if (doc.selectedLayerIds.length <= 1) {
      doc.activeLayerId = doc.selectedLayerIds[0] ?? doc.activeLayerId;
      doc.selectedLayerIds = [];
    }
  } else {
    // Add to multi-select
    doc.selectedLayerIds.push(layerId);
    doc.activeLayerId = layerId;
  }
  return true;
}

/**
 * Extend multi-selection to a range (Shift+click).
 * Selects all layers between the current active layer and the clicked layer.
 */
export function rangeSelectLayers(doc: DocumentState, layerId: string): boolean {
  const targetIdx = doc.layers.findIndex((l) => l.id === layerId);
  const activeIdx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
  if (targetIdx < 0 || activeIdx < 0) return false;

  const lo = Math.min(targetIdx, activeIdx);
  const hi = Math.max(targetIdx, activeIdx);
  doc.selectedLayerIds = doc.layers.slice(lo, hi + 1).map((l) => l.id);
  // Keep activeLayerId as the clicked layer
  doc.activeLayerId = layerId;
  return true;
}

/**
 * Return the effective set of selected layer IDs.
 * If multi-select is active returns that list, otherwise returns just the active layer.
 */
export function getSelectedLayerIds(doc: DocumentState): string[] {
  return doc.selectedLayerIds.length > 0 ? doc.selectedLayerIds : [doc.activeLayerId];
}

/**
 * Rasterize any non-raster layer (text, shape, smart-object) into a plain
 * raster layer. The current display canvas becomes the raster content.
 * Adjustment layers cannot be rasterized.
 * Returns the new raster layer, or null if the layer can't be rasterized.
 */
export function rasterizeLayer(
  layers: Layer[],
  layerId: string,
): RasterLayer | null {
  const index = layers.findIndex((l) => l.id === layerId);
  if (index === -1) return null;
  const old = layers[index];
  if (old.type === "raster" || old.type === "adjustment") return null;

  const rasterLayer: RasterLayer = {
    id: old.id,
    type: "raster",
    name: old.name,
    canvas: cloneCanvas(old.canvas),
    sourceCanvas: cloneCanvas(old.canvas),
    x: old.x,
    y: old.y,
    visible: old.visible,
    opacity: old.opacity,
    locked: old.locked,
    isBackground: old.isBackground,
    fillColor: old.fillColor,
    effects: old.effects ? [...old.effects] : [],
    mask: old.mask ? cloneCanvas(old.mask) : undefined,
  };
  layers[index] = rasterLayer;
  return rasterLayer;
}
