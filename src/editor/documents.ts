import { pushHistory } from "./history";
import { deserializeMask, invertMask, isMaskEmpty, maskBoundingRect, normalizeSelectionToMask, serializeMask } from "./selection";
import {
  getTextFillColor,
  type AdjustmentLayer,
  type AdjustmentLayerData,
  type DocumentState,
  type Layer,
  type LayerBase,
  type LayerEffect,
  type RasterLayer,
  type SerializedDocument,
  type ShapeKind,
  type ShapeLayer,
  type SmartObjectLayer,
  type TextFill,
  type TextLayer,
  type TextLayerData,
  type TextStroke,
  type TransformDraft,
} from "./types";
import { nextId, stripExtension } from "./utils";
import { applyAdjustmentLayerParams } from "./adjustmentLayers";
import { blendWithMask } from "./layerMask";
import { renderSmartObjectLayer } from "./smartObject";

export function createLayerCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const measureCanvas = createLayerCanvas(1, 1);

function getMeasureContext() {
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable for text measurement");
  }
  return ctx;
}

function buildTextFont(data: TextLayerData) {
  return `${data.italic ? "italic " : ""}${data.bold ? "700 " : "400 "}${data.fontSize}px ${data.fontFamily}`;
}

function wrapText(text: string, data: TextLayerData): string[] {
  const ctx = getMeasureContext();
  ctx.font = buildTextFont(data);
  const paragraphs = text.split(/\r?\n/);
  if (!data.boxWidth || data.boxWidth < data.fontSize) {
    return paragraphs;
  }

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width + Math.max(0, candidate.length - 1) * data.kerning <= data.boxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawTextLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, kerning: number, stroke?: boolean) {
  if (!kerning) {
    if (stroke) ctx.strokeText(text, x, y);
    else ctx.fillText(text, x, y);
    return;
  }
  let cursor = x;
  for (const char of text) {
    if (stroke) ctx.strokeText(char, cursor, y);
    else ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + kerning;
  }
}

function getTextMetrics(data: TextLayerData) {
  const ctx = getMeasureContext();
  ctx.font = buildTextFont(data);
  const lines = wrapText(data.text, data);
  const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width + Math.max(0, line.length - 1) * data.kerning), 0);
  const width = Math.max(1, Math.ceil(data.boxWidth ?? maxLineWidth + Math.max(8, data.fontSize * 0.35)));
  const lineAdvance = Math.max(1, Math.round(data.fontSize * data.lineHeight));
  const contentHeight = Math.max(1, Math.ceil(lines.length * lineAdvance + Math.max(8, data.fontSize * 0.35)));
  const height = Math.max(1, Math.ceil(data.boxHeight ?? contentHeight));
  return { lines, width, height, contentHeight, lineAdvance };
}

export function measureTextBoxBounds(data: TextLayerData) {
  const { width, height } = getTextMetrics(data);
  return { width, height };
}

/** Returns an empty effects array — effects are now opt-in (F2.3). */
function createDefaultEffects(): LayerEffect[] {
  return [];
}

function rotateCanvas(source: HTMLCanvasElement, rotationDeg: number) {
  const angle = (rotationDeg * Math.PI) / 180;
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const width = Math.max(1, Math.ceil(source.width * cos + source.height * sin));
  const height = Math.max(1, Math.ceil(source.width * sin + source.height * cos));
  const canvas = createLayerCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
  }
  return canvas;
}

function transformCanvas(source: HTMLCanvasElement, options: {
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  skewXDeg?: number;
  skewYDeg?: number;
}) {
  const skewX = Math.tan(((options.skewXDeg ?? 0) * Math.PI) / 180);
  const skewY = Math.tan(((options.skewYDeg ?? 0) * Math.PI) / 180);
  const angle = (options.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const matrix = {
    a: cos * options.scaleX - sin * skewY * options.scaleX,
    b: sin * options.scaleX + cos * skewY * options.scaleX,
    c: cos * skewX * options.scaleY - sin * options.scaleY,
    d: sin * skewX * options.scaleY + cos * options.scaleY,
  };
  const halfWidth = source.width / 2;
  const halfHeight = source.height / 2;
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
  ].map((point) => ({
    x: matrix.a * point.x + matrix.c * point.y,
    y: matrix.b * point.x + matrix.d * point.y,
  }));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  const canvas = createLayerCanvas(Math.max(1, Math.ceil(maxX - minX)), Math.max(1, Math.ceil(maxY - minY)));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, canvas.width / 2, canvas.height / 2);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return canvas;
}

/** Per-type default values for each effect property (used to fill missing fields). */
export const EFFECT_DEFAULTS: Record<string, LayerEffect> = {
  "drop-shadow": { type: "drop-shadow", color: "#000000", offsetX: 0, offsetY: 4, blur: 12, opacity: 0.35, enabled: false },
  "inner-shadow": { type: "inner-shadow", color: "#000000", offsetX: 0, offsetY: 4, blur: 8, opacity: 0.5, enabled: false },
  "outer-glow": { type: "outer-glow", color: "#ffffff", blur: 16, spread: 4, opacity: 0.6, enabled: false },
  "outline": { type: "outline", color: "#ffffff", width: 2, opacity: 1, enabled: false },
  "color-overlay": { type: "color-overlay", color: "#ff0000", opacity: 0.5, enabled: false },
};

/**
 * Normalizes a layer effects array.
 * - No args / empty → returns [] (opt-in, no forced defaults)
 * - With effects → fills missing fields per-type, drops unknown types
 * - Backward-compatible with old 2-item [shadow, outline] saves
 */
export function normalizeEffects(effects?: LayerEffect[]): LayerEffect[] {
  if (!effects || effects.length === 0) return createDefaultEffects();
  const result: LayerEffect[] = [];
  for (const effect of effects) {
    const defaults = EFFECT_DEFAULTS[effect.type];
    if (!defaults) continue; // unknown type — drop it
    result.push({ ...defaults, ...effect } as LayerEffect);
  }
  return result;
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = createLayerCanvas(source.width, source.height);
  canvas.getContext("2d")?.drawImage(source, 0, 0);
  return canvas;
}

export interface LayerLocalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getRasterLayerContentBoundsLocal(layer: Pick<RasterLayer, "canvas">): LayerLocalBounds | null {
  const { width, height } = layer.canvas;
  if (width < 1 || height < 1) {
    return null;
  }
  const ctx = layer.canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[((y * width) + x) * 4 + 3] <= 0) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function getRasterLayerContentBounds(layer: Pick<RasterLayer, "x" | "y" | "canvas">): LayerLocalBounds | null {
  const bounds = getRasterLayerContentBoundsLocal(layer);
  if (!bounds) {
    return null;
  }
  return {
    x: layer.x + bounds.x,
    y: layer.y + bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

export function extractRasterLayerContentCanvas(
  layer: Pick<RasterLayer, "canvas">,
  bounds: LayerLocalBounds | null | undefined = undefined,
): HTMLCanvasElement {
  const resolvedBounds = bounds === undefined ? getRasterLayerContentBoundsLocal(layer) : bounds;
  if (!resolvedBounds) {
    return cloneCanvas(layer.canvas);
  }
  if (
    resolvedBounds.x === 0
    && resolvedBounds.y === 0
    && resolvedBounds.width === layer.canvas.width
    && resolvedBounds.height === layer.canvas.height
  ) {
    return cloneCanvas(layer.canvas);
  }
  const canvas = createLayerCanvas(resolvedBounds.width, resolvedBounds.height);
  canvas.getContext("2d")?.drawImage(
    layer.canvas,
    resolvedBounds.x,
    resolvedBounds.y,
    resolvedBounds.width,
    resolvedBounds.height,
    0,
    0,
    resolvedBounds.width,
    resolvedBounds.height,
  );
  return canvas;
}

export function getLayerContext(layer: Pick<LayerBase, "canvas">): CanvasRenderingContext2D {
  const ctx = layer.canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable for layer");
  }
  return ctx;
}

export function syncLayerSource(layer: Layer) {
  layer.sourceCanvas = cloneCanvas(layer.canvas);
}

/** Set ctx.fillStyle based on a TextFill, scoped to the given text block dimensions. */
export function createTextFillStyle(ctx: CanvasRenderingContext2D, fill: TextFill, width: number, height: number): void {
  if (fill.type === "solid") {
    ctx.fillStyle = fill.color;
    return;
  }
  if (fill.type === "linear-gradient") {
    const rad = (fill.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const halfW = width / 2;
    const halfH = height / 2;
    const x0 = halfW - cos * halfW;
    const y0 = halfH - sin * halfH;
    const x1 = halfW + cos * halfW;
    const y1 = halfH + sin * halfH;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const stop of fill.stops) {
      grad.addColorStop(stop.offset, stop.color);
    }
    ctx.fillStyle = grad;
    return;
  }
  if (fill.type === "radial-gradient") {
    const cx = (fill.centerX ?? 0.5) * width;
    const cy = (fill.centerY ?? 0.5) * height;
    const radius = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(width - cx, cy),
      Math.hypot(cx, height - cy),
      Math.hypot(width - cx, height - cy),
      1,
    );
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const stop of fill.stops) {
      grad.addColorStop(stop.offset, stop.color);
    }
    ctx.fillStyle = grad;
    return;
  }
}

export function renderTextLayer(layer: TextLayer) {
  layer.textData.scaleX = layer.textData.scaleX ?? 1;
  layer.textData.scaleY = layer.textData.scaleY ?? 1;
  layer.textData.skewXDeg = layer.textData.skewXDeg ?? 0;
  layer.textData.skewYDeg = layer.textData.skewYDeg ?? 0;

  // Backward compat: if external code wrote to fillColor without updating fill,
  // or if fill is missing entirely (old test fixtures / inspector code), sync it.
  if (!layer.textData.fill) {
    layer.textData.fill = { type: "solid", color: layer.textData.fillColor ?? "#ffffff" };
  } else if (layer.textData.fill.type === "solid" && layer.textData.fillColor !== layer.textData.fill.color) {
    layer.textData.fill = { type: "solid", color: layer.textData.fillColor };
  }
  if (layer.textData.stroke === undefined) {
    layer.textData.stroke = null;
  }
  if (layer.textData.underline === undefined) {
    layer.textData.underline = false;
  }
  if (layer.textData.strikethrough === undefined) {
    layer.textData.strikethrough = false;
  }
  if (layer.textData.boxHeight === undefined) {
    layer.textData.boxHeight = null;
  }

  const { lines, width, height, contentHeight, lineAdvance } = getTextMetrics(layer.textData);
  const baseCanvas = createLayerCanvas(width, height);
  const ctx = getLayerContext({ canvas: baseCanvas });
  ctx.clearRect(0, 0, width, height);
  ctx.font = buildTextFont(layer.textData);
  ctx.textBaseline = "top";

  // Compute per-line x positions
  const linePositions: Array<{ line: string; x: number; y: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWidth = ctx.measureText(line).width + Math.max(0, line.length - 1) * layer.textData.kerning;
    const x = layer.textData.alignment === "center"
      ? (width - lineWidth) / 2
      : layer.textData.alignment === "right"
        ? width - lineWidth
        : 0;
    linePositions.push({ line, x, y: i * lineAdvance });
  }

  // Draw stroke BEFORE fill so fill renders on top
  const stroke = layer.textData.stroke;
  if (stroke && stroke.width > 0) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    for (const { line, x, y } of linePositions) {
      drawTextLine(ctx, line, x, y, layer.textData.kerning, true);
    }
  }

  // Draw fill
  createTextFillStyle(ctx, layer.textData.fill, width, contentHeight);
  for (const { line, x, y } of linePositions) {
    drawTextLine(ctx, line, x, y, layer.textData.kerning);
  }

  // Draw text decorations (underline / strikethrough)
  if (layer.textData.underline || layer.textData.strikethrough) {
    // ctx.fillStyle is already set from createTextFillStyle above
    const decorationHeight = Math.max(1, Math.round(layer.textData.fontSize / 16));
    for (const { line, x, y } of linePositions) {
      const lineWidth = ctx.measureText(line).width + Math.max(0, line.length - 1) * layer.textData.kerning;
      if (layer.textData.underline) {
        const underlineY = y + layer.textData.fontSize * 0.92;
        ctx.fillRect(x, underlineY, lineWidth, decorationHeight);
      }
      if (layer.textData.strikethrough) {
        const strikeY = y + layer.textData.fontSize * 0.55;
        ctx.fillRect(x, strikeY, lineWidth, decorationHeight);
      }
    }
  }

  const hasNativeTransform = Math.abs(layer.textData.scaleX - 1) > 0.001
    || Math.abs(layer.textData.scaleY - 1) > 0.001
    || Math.abs(layer.textData.rotationDeg) > 0.001
    || Math.abs(layer.textData.skewXDeg) > 0.001
    || Math.abs(layer.textData.skewYDeg) > 0.001;
  layer.canvas = hasNativeTransform
    ? transformCanvas(baseCanvas, {
      scaleX: layer.textData.scaleX,
      scaleY: layer.textData.scaleY,
      rotateDeg: layer.textData.rotationDeg,
      skewXDeg: layer.textData.skewXDeg,
      skewYDeg: layer.textData.skewYDeg,
    })
    : baseCanvas;
  // Sync deprecated fillColor and summary fillColor from fill
  const representativeColor = getTextFillColor(layer.textData.fill);
  layer.textData.fillColor = representativeColor;
  layer.fillColor = representativeColor;
  syncLayerSource(layer);
}

export function renderShapeLayer(layer: ShapeLayer) {
  const padding = Math.ceil(Math.max(layer.shapeData.strokeWidth, layer.shapeData.kind === "line" ? 2 : 0) + 2);
  const width = Math.max(1, Math.ceil(layer.shapeData.width + padding * 2));
  const height = Math.max(1, Math.ceil(layer.shapeData.height + padding * 2));
  const baseCanvas = createLayerCanvas(width, height);
  const ctx = getLayerContext({ canvas: baseCanvas });
  const x = padding;
  const y = padding;
  const w = Math.max(1, layer.shapeData.width);
  const h = Math.max(1, layer.shapeData.height);
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  if (layer.shapeData.kind === "ellipse") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (layer.shapeData.kind === "line") {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y);
  } else {
    const radius = Math.max(0, Math.min(layer.shapeData.cornerRadius, w / 2, h / 2));
    ctx.roundRect(x, y, w, h, radius);
  }
  if (layer.shapeData.fillColor && layer.shapeData.kind !== "line") {
    ctx.fillStyle = layer.shapeData.fillColor;
    ctx.fill();
  }
  if (layer.shapeData.strokeColor) {
    ctx.strokeStyle = layer.shapeData.strokeColor;
    ctx.lineWidth = Math.max(1, layer.shapeData.strokeWidth);
    ctx.stroke();
  }
  layer.canvas = layer.shapeData.rotationDeg ? rotateCanvas(baseCanvas, layer.shapeData.rotationDeg) : baseCanvas;
  layer.fillColor = layer.shapeData.fillColor ?? layer.shapeData.strokeColor ?? undefined;
  syncLayerSource(layer);
}

export function refreshLayerCanvas(layer: Layer) {
  if (layer.type === "text") {
    renderTextLayer(layer);
  } else if (layer.type === "shape") {
    renderShapeLayer(layer);
  } else if (layer.type === "adjustment") {
    // Adjustment layers have no visual canvas — nothing to refresh
  } else if (layer.type === "smart-object") {
    renderSmartObjectLayer(layer);
  } else {
    syncLayerSource(layer);
  }
}

function buildOutlineCanvas(layer: Layer, width: number, color: string, opacity: number) {
  const source = layer.canvas;
  const pad = Math.max(1, Math.ceil(width));
  const temp = createLayerCanvas(source.width + pad * 2, source.height + pad * 2);
  const tempCtx = temp.getContext("2d");
  if (!tempCtx) return { canvas: temp, offsetX: -pad, offsetY: -pad };
  const steps = Math.max(8, pad * 10);
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    tempCtx.drawImage(source, Math.round(Math.cos(angle) * pad) + pad, Math.round(Math.sin(angle) * pad) + pad);
  }
  tempCtx.globalCompositeOperation = "source-in";
  tempCtx.globalAlpha = opacity;
  tempCtx.fillStyle = color;
  tempCtx.fillRect(0, 0, temp.width, temp.height);
  tempCtx.globalCompositeOperation = "source-over";
  return { canvas: temp, offsetX: -pad, offsetY: -pad };
}

export function drawLayerOnto(ctx: CanvasRenderingContext2D, layer: Layer, x = layer.x, y = layer.y) {
  const effects = normalizeEffects(layer.effects);
  const hasContent = layer.canvas.width > 0 && layer.canvas.height > 0;
  const enabledEffects = effects.filter((effect) => effect.enabled);
  const behindEffects = enabledEffects.filter((effect) => effect.type === "outer-glow" || effect.type === "drop-shadow" || effect.type === "outline");
  const innerEffects = enabledEffects.filter((effect) => effect.type === "inner-shadow" || effect.type === "color-overlay");

  // --- Behind-layer effects (drawn before layer content) ---

  for (const effect of behindEffects) {
    if (!hasContent) break;
    if (effect.type === "outer-glow") {
      ctx.save();
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = effect.blur + effect.spread;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha *= effect.opacity;
      ctx.drawImage(layer.canvas, x, y);
      ctx.restore();
      continue;
    }
    if (effect.type === "drop-shadow") {
      ctx.save();
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = effect.blur;
      ctx.shadowOffsetX = effect.offsetX;
      ctx.shadowOffsetY = effect.offsetY;
      ctx.globalAlpha *= effect.opacity;
      ctx.drawImage(layer.canvas, x, y);
      ctx.restore();
      continue;
    }
    if (effect.type === "outline" && effect.width > 0) {
      const outlined = buildOutlineCanvas(layer, effect.width, effect.color, effect.opacity);
      ctx.drawImage(outlined.canvas, x + outlined.offsetX, y + outlined.offsetY);
    }
  }

  // --- Layer content ---

  const hasInnerEffects = innerEffects.length > 0 && hasContent;

  if (hasInnerEffects) {
    // Use temp canvas so we can apply inside-layer effects clipped to layer alpha
    const temp = createLayerCanvas(layer.canvas.width, layer.canvas.height);
    const tCtx = temp.getContext("2d");
    if (tCtx) {
      // Draw layer content onto temp
      tCtx.drawImage(layer.canvas, 0, 0);

      for (const effect of innerEffects) {
        if (effect.type === "inner-shadow") {
          const inv = createLayerCanvas(layer.canvas.width, layer.canvas.height);
          const invCtx = inv.getContext("2d");
          if (!invCtx) {
            continue;
          }
          invCtx.fillStyle = "#000000";
          invCtx.fillRect(0, 0, inv.width, inv.height);
          invCtx.globalCompositeOperation = "destination-out";
          invCtx.drawImage(layer.canvas, 0, 0);
          invCtx.globalCompositeOperation = "source-over";

          const shadowCanvas = createLayerCanvas(layer.canvas.width, layer.canvas.height);
          const sCtx = shadowCanvas.getContext("2d");
          if (!sCtx) {
            continue;
          }
          sCtx.shadowColor = effect.color;
          sCtx.shadowBlur = effect.blur;
          sCtx.shadowOffsetX = effect.offsetX;
          sCtx.shadowOffsetY = effect.offsetY;
          sCtx.drawImage(inv, 0, 0);
          sCtx.shadowColor = "transparent";
          sCtx.shadowBlur = 0;
          sCtx.shadowOffsetX = 0;
          sCtx.shadowOffsetY = 0;
          sCtx.globalCompositeOperation = "destination-out";
          sCtx.drawImage(inv, 0, 0);
          sCtx.globalCompositeOperation = "source-over";

          tCtx.save();
          tCtx.globalCompositeOperation = "source-atop";
          tCtx.globalAlpha = effect.opacity;
          tCtx.drawImage(shadowCanvas, 0, 0);
          tCtx.restore();
          continue;
        }

        if (effect.type === "color-overlay") {
          tCtx.save();
          tCtx.globalCompositeOperation = "source-atop";
          tCtx.globalAlpha = effect.opacity;
          tCtx.fillStyle = effect.color;
          tCtx.fillRect(0, 0, temp.width, temp.height);
          tCtx.restore();
        }
      }

      ctx.drawImage(temp, x, y);
    } else {
      // fallback — no temp context
      ctx.drawImage(layer.canvas, x, y);
    }
  } else {
    ctx.drawImage(layer.canvas, x, y);
  }
}

function multiply2x2(left: { a: number; b: number; c: number; d: number }, right: { a: number; b: number; c: number; d: number }) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
  };
}

export function buildTransformMatrix(draft: Pick<TransformDraft, "scaleX" | "scaleY" | "rotateDeg" | "skewXDeg" | "skewYDeg">) {
  const scale = { a: draft.scaleX, b: 0, c: 0, d: draft.scaleY };
  const skew = { a: 1, b: Math.tan((draft.skewYDeg * Math.PI) / 180), c: Math.tan((draft.skewXDeg * Math.PI) / 180), d: 1 };
  const angle = (draft.rotateDeg * Math.PI) / 180;
  const rotate = { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle) };
  return multiply2x2(rotate, multiply2x2(skew, scale));
}

type TransformPreview = {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TransformPreviewCacheKey = {
  sourceCanvas: HTMLCanvasElement;
  sourceWidth: number;
  sourceHeight: number;
  centerX: number;
  centerY: number;
  pivotX: number;
  pivotY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  textBoxWidth?: number | null;
  textBoxHeight?: number | null;
};

const transformPreviewCache = new WeakMap<TransformDraft, { key: TransformPreviewCacheKey; preview: TransformPreview }>();

function createTransformPreviewCacheKey(draft: TransformDraft): TransformPreviewCacheKey {
  return {
    sourceCanvas: draft.sourceCanvas,
    sourceWidth: draft.sourceCanvas.width,
    sourceHeight: draft.sourceCanvas.height,
    centerX: draft.centerX,
    centerY: draft.centerY,
    pivotX: draft.pivotX,
    pivotY: draft.pivotY,
    scaleX: draft.scaleX,
    scaleY: draft.scaleY,
    rotateDeg: draft.rotateDeg,
    skewXDeg: draft.skewXDeg,
    skewYDeg: draft.skewYDeg,
    textBoxWidth: draft.textBoxWidth,
    textBoxHeight: draft.textBoxHeight,
  };
}

function isMatchingTransformPreviewCacheKey(left: TransformPreviewCacheKey, right: TransformPreviewCacheKey) {
  return left.sourceCanvas === right.sourceCanvas
    && left.sourceWidth === right.sourceWidth
    && left.sourceHeight === right.sourceHeight
    && left.centerX === right.centerX
    && left.centerY === right.centerY
    && left.pivotX === right.pivotX
    && left.pivotY === right.pivotY
    && left.scaleX === right.scaleX
    && left.scaleY === right.scaleY
    && left.rotateDeg === right.rotateDeg
    && left.skewXDeg === right.skewXDeg
    && left.skewYDeg === right.skewYDeg
    && left.textBoxWidth === right.textBoxWidth
    && left.textBoxHeight === right.textBoxHeight;
}

export function buildTransformPreview(draft: TransformDraft) {
  if (draft.previewOverride) {
    return draft.previewOverride;
  }
  const nextKey = createTransformPreviewCacheKey(draft);
  const cached = transformPreviewCache.get(draft);
  if (cached && isMatchingTransformPreviewCacheKey(cached.key, nextKey)) {
    return cached.preview;
  }

  const matrix = buildTransformMatrix(draft);
  const source = draft.sourceCanvas;
  const anchorSourceX = draft.pivotX - draft.centerX + source.width / 2;
  const anchorSourceY = draft.pivotY - draft.centerY + source.height / 2;
  const corners = [
    { x: 0, y: 0 },
    { x: source.width, y: 0 },
    { x: 0, y: source.height },
    { x: source.width, y: source.height },
  ].map((point) => ({
    x: matrix.a * (point.x - anchorSourceX) + matrix.c * (point.y - anchorSourceY),
    y: matrix.b * (point.x - anchorSourceX) + matrix.d * (point.y - anchorSourceY),
  }));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  const canvas = createLayerCanvas(Math.max(1, Math.ceil(maxX - minX)), Math.max(1, Math.ceil(maxY - minY)));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, -minX, -minY);
    ctx.drawImage(source, -anchorSourceX, -anchorSourceY);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const preview = { canvas, x: draft.pivotX + minX, y: draft.pivotY + minY, width: canvas.width, height: canvas.height };
  transformPreviewCache.set(draft, { key: nextKey, preview });
  return preview;
}

export function buildTransformFrameBounds(draft: Pick<TransformDraft, "sourceCanvas" | "frameBounds" | "centerX" | "centerY" | "pivotX" | "pivotY" | "scaleX" | "scaleY" | "rotateDeg" | "skewXDeg" | "skewYDeg" | "previewOverride">) {
  if (draft.previewOverride) {
    return {
      x: draft.previewOverride.x,
      y: draft.previewOverride.y,
      width: draft.previewOverride.width,
      height: draft.previewOverride.height,
    };
  }
  const sourceBounds = draft.frameBounds ?? {
    x: draft.centerX - draft.sourceCanvas.width / 2,
    y: draft.centerY - draft.sourceCanvas.height / 2,
    width: draft.sourceCanvas.width,
    height: draft.sourceCanvas.height,
  };
  const matrix = buildTransformMatrix(draft);
  const corners = [
    { x: sourceBounds.x, y: sourceBounds.y },
    { x: sourceBounds.x + sourceBounds.width, y: sourceBounds.y },
    { x: sourceBounds.x, y: sourceBounds.y + sourceBounds.height },
    { x: sourceBounds.x + sourceBounds.width, y: sourceBounds.y + sourceBounds.height },
  ].map((point) => ({
    x: draft.pivotX + matrix.a * (point.x - draft.pivotX) + matrix.c * (point.y - draft.pivotY),
    y: draft.pivotY + matrix.b * (point.x - draft.pivotX) + matrix.d * (point.y - draft.pivotY),
  }));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function fillLayer(layer: Layer, color: string) {
  const ctx = getLayerContext(layer);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  layer.fillColor = color;
  syncLayerSource(layer);
}

export function clearLayer(layer: Layer) {
  const ctx = getLayerContext(layer);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  layer.fillColor = undefined;
  syncLayerSource(layer);
}

export function createBackgroundLayer(width: number, height: number, color: string | null = "#ffffff"): RasterLayer {
  const layer: RasterLayer = {
    id: nextId("layer"),
    type: "raster",
    name: "Background",
    canvas: createLayerCanvas(width, height),
    sourceCanvas: undefined,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    isBackground: true,
    fillColor: color ?? undefined,
    effects: normalizeEffects(),
  };
  if (color) fillLayer(layer, color); else clearLayer(layer);
  return layer;
}

export function createBlankDocument(name: string, width: number, height: number, defaultZoom: number, background: DocumentState["background"] = "white"): DocumentState {
  const backgroundLayer = createBackgroundLayer(width, height, background === "white" ? "#ffffff" : null);
  const baseLayer: RasterLayer = {
    id: nextId("layer"),
    type: "raster",
    name: "Layer 1",
    canvas: createLayerCanvas(width, height),
    sourceCanvas: undefined,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    effects: normalizeEffects(),
  };
  return {
    id: nextId("doc"),
    name,
    width,
    height,
    zoom: defaultZoom,
    panX: 0,
    panY: 0,
    dirty: false,
    layers: [backgroundLayer, baseLayer],
    activeLayerId: baseLayer.id,
    selectedLayerIds: [],
    history: ["Created blank canvas"],
    historyIndex: 0,
    sourcePath: null,
    projectPath: null,
    background,
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: null,
    selectionShape: "rect",
    selectionInverted: false,
    selectionPath: null,
    selectionMask: null,
    guides: [],
    customFonts: [],
  };
}

export function cloneLayer(layer: Layer): Layer {
  const base = {
    id: nextId("layer"),
    name: layer.name,
    canvas: cloneCanvas(layer.canvas),
    sourceCanvas: cloneCanvas(layer.sourceCanvas ?? layer.canvas),
    x: layer.x,
    y: layer.y,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    isBackground: layer.isBackground,
    fillColor: layer.fillColor,
    effects: normalizeEffects(layer.effects),
    mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    aiProvenance: layer.aiProvenance ? { ...layer.aiProvenance, warnings: [...layer.aiProvenance.warnings] } : undefined,
  };
  if (layer.type === "text") {
    return {
      ...base,
      type: "text",
      textData: {
        ...layer.textData,
        fill: layer.textData.fill.type === "solid"
          ? { ...layer.textData.fill }
          : { ...layer.textData.fill, stops: layer.textData.fill.stops.map((stop) => ({ ...stop })) },
        stroke: layer.textData.stroke ? { ...layer.textData.stroke } : null,
      },
    };
  }
  if (layer.type === "shape") {
    return { ...base, type: "shape", shapeData: { ...layer.shapeData } };
  }
  if (layer.type === "adjustment") {
    return { ...base, type: "adjustment", adjustmentData: { kind: layer.adjustmentData.kind, params: { ...layer.adjustmentData.params } } };
  }
  if (layer.type === "smart-object") {
    const srcCanvas = layer.smartObjectData.sourceCanvas ? cloneCanvas(layer.smartObjectData.sourceCanvas) : undefined;
    return {
      ...base,
      type: "smart-object",
      smartObjectData: {
        ...layer.smartObjectData,
        sourceCanvas: srcCanvas,
      },
    };
  }
  return { ...base, type: "raster" };
}

export function cloneDocument(doc: DocumentState): DocumentState {
  return {
    ...doc,
    id: nextId("doc"),
    name: `${doc.name} Copy`,
    dirty: true,
    layers: doc.layers.map(cloneLayer),
    activeLayerId: doc.activeLayerId,
    history: ["Duplicated document", ...doc.history].slice(0, 20),
    historyIndex: 0,
    sourcePath: null,
    projectPath: null,
    undoStack: [],
    redoStack: [],
    selectionRect: doc.selectionRect ? { ...doc.selectionRect } : null,
    selectionShape: doc.selectionShape,
    selectionInverted: doc.selectionInverted,
    selectionPath: doc.selectionPath ? { points: doc.selectionPath.points.map((p) => ({ ...p })), closed: doc.selectionPath.closed } : null,
    selectionMask: doc.selectionMask ? cloneCanvas(doc.selectionMask) : null,
    guides: doc.guides.map((g) => ({ ...g })),
    customFonts: doc.customFonts.map((f) => ({ ...f })),
  };
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createDocumentFromBlob(name: string, blob: Blob, sourcePath: string | null, defaultZoom: number): Promise<DocumentState> {
  const image = await blobToImage(blob);
  const doc = createBlankDocument(stripExtension(name), image.naturalWidth, image.naturalHeight, defaultZoom);
  const layer = doc.layers.find((item) => !item.isBackground && item.type === "raster") as RasterLayer | undefined;
  if (!layer) throw new Error("Failed to create base layer");
  layer.name = stripExtension(name) || "Image";
  getLayerContext(layer).drawImage(image, 0, 0);
  syncLayerSource(layer);
  doc.name = stripExtension(name);
  doc.sourcePath = sourcePath;
  doc.history = ["Imported image"];
  doc.dirty = false;
  return doc;
}

export function serializeDocument(doc: DocumentState): SerializedDocument {
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    zoom: doc.zoom,
    panX: doc.panX,
    panY: doc.panY,
    activeLayerId: doc.activeLayerId,
    selectedLayerIds: doc.selectedLayerIds.length > 0 ? [...doc.selectedLayerIds] : undefined,
    history: [...doc.history],
    sourcePath: doc.sourcePath,
    background: doc.background,
    selectionRect: doc.selectionRect ? { ...doc.selectionRect } : null,
    selectionShape: doc.selectionShape,
    selectionInverted: doc.selectionInverted,
    selectionPath: doc.selectionPath ? { points: doc.selectionPath.points.map((p) => ({ ...p })), closed: doc.selectionPath.closed } : null,
    selectionMaskDataUrl: doc.selectionMask ? serializeMask(doc.selectionMask) : null,
    guides: doc.guides.map((g) => ({ ...g })),
    customFonts: doc.customFonts.length > 0 ? doc.customFonts.map((f) => ({ ...f })) : undefined,
    layers: doc.layers.map((layer) => ({
      type: layer.type,
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      locked: layer.locked,
      isBackground: layer.isBackground,
      fillColor: layer.fillColor,
      dataUrl: layer.canvas.toDataURL("image/png"),
      effects: normalizeEffects(layer.effects),
      textData: layer.type === "text" ? { ...layer.textData } : undefined,
      shapeData: layer.type === "shape" ? { ...layer.shapeData } : undefined,
      adjustmentData: layer.type === "adjustment" ? { kind: layer.adjustmentData.kind, params: { ...layer.adjustmentData.params } } : undefined,
      smartObjectData: layer.type === "smart-object" ? {
        sourceDataUrl: layer.smartObjectData.sourceDataUrl,
        sourceWidth: layer.smartObjectData.sourceWidth,
        sourceHeight: layer.smartObjectData.sourceHeight,
        scaleX: layer.smartObjectData.scaleX,
        scaleY: layer.smartObjectData.scaleY,
        rotateDeg: layer.smartObjectData.rotateDeg,
      } : undefined,
      maskDataUrl: layer.mask ? serializeMask(layer.mask) : undefined,
      aiProvenance: layer.aiProvenance ? { ...layer.aiProvenance, warnings: [...layer.aiProvenance.warnings] } : undefined,
    })),
  };
}

export async function deserializeDocument(payload: SerializedDocument, projectPath: string | null, dirty = false): Promise<DocumentState> {
  const layers: Layer[] = [];
  for (const item of payload.layers) {
    const image = await blobToImage(await (await fetch(item.dataUrl)).blob());
    const canvas = createLayerCanvas(image.naturalWidth || payload.width, image.naturalHeight || payload.height);
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    const base = {
      id: item.id,
      name: item.name,
      x: item.x,
      y: item.y,
      visible: item.visible,
      opacity: item.opacity,
      blendMode: item.blendMode as GlobalCompositeOperation | undefined,
      locked: item.locked,
      isBackground: item.isBackground,
      fillColor: item.fillColor,
      canvas,
      sourceCanvas: cloneCanvas(canvas),
      effects: normalizeEffects(item.effects),
      aiProvenance: item.aiProvenance ? { ...item.aiProvenance, warnings: [...item.aiProvenance.warnings] } : undefined,
    };
    let layer: Layer;
    if (item.type === "text" && item.textData) {
      // Migrate legacy fillColor → fill for backward compatibility
      const fill: TextFill = item.textData.fill
        ?? { type: "solid", color: item.textData.fillColor ?? "#ffffff" };
      const stroke: TextStroke | null = item.textData.stroke ?? null;
      const textLayer: TextLayer = {
        ...base,
        type: "text",
        textData: {
          text: item.textData.text,
          fontFamily: item.textData.fontFamily,
          fontSize: item.textData.fontSize,
          lineHeight: item.textData.lineHeight,
          kerning: item.textData.kerning,
          rotationDeg: item.textData.rotationDeg,
          skewXDeg: item.textData.skewXDeg ?? 0,
          skewYDeg: item.textData.skewYDeg ?? 0,
          alignment: item.textData.alignment,
          fill,
          stroke,
          fillColor: getTextFillColor(fill),
          bold: item.textData.bold,
          italic: item.textData.italic,
          underline: item.textData.underline ?? false,
          strikethrough: item.textData.strikethrough ?? false,
          boxWidth: item.textData.boxWidth,
          boxHeight: item.textData.boxHeight ?? null,
          scaleX: item.textData.scaleX ?? 1,
          scaleY: item.textData.scaleY ?? 1,
        },
      };
      renderTextLayer(textLayer);
      layer = textLayer;
    } else if (item.type === "shape" && item.shapeData) {
      const shapeLayer: ShapeLayer = { ...base, type: "shape", shapeData: { ...item.shapeData } };
      renderShapeLayer(shapeLayer);
      layer = shapeLayer;
    } else if (item.type === "adjustment" && item.adjustmentData) {
      layer = { ...base, type: "adjustment", adjustmentData: { kind: item.adjustmentData.kind, params: { ...item.adjustmentData.params } } } as AdjustmentLayer;
    } else if (item.type === "smart-object" && item.smartObjectData) {
      const srcImage = await blobToImage(await (await fetch(item.smartObjectData.sourceDataUrl)).blob());
      const srcCanvas = createLayerCanvas(srcImage.naturalWidth || item.smartObjectData.sourceWidth, srcImage.naturalHeight || item.smartObjectData.sourceHeight);
      srcCanvas.getContext("2d")?.drawImage(srcImage, 0, 0);
      const smartLayer: SmartObjectLayer = {
        ...base,
        type: "smart-object",
        smartObjectData: {
          sourceDataUrl: item.smartObjectData.sourceDataUrl,
          sourceWidth: item.smartObjectData.sourceWidth,
          sourceHeight: item.smartObjectData.sourceHeight,
          scaleX: item.smartObjectData.scaleX,
          scaleY: item.smartObjectData.scaleY,
          rotateDeg: item.smartObjectData.rotateDeg,
          sourceCanvas: srcCanvas,
        },
      };
      renderSmartObjectLayer(smartLayer);
      layer = smartLayer;
    } else {
      layer = { ...base, type: "raster" };
    }
    if (item.maskDataUrl) {
      layer.mask = await deserializeMask(item.maskDataUrl, payload.width, payload.height);
    }
    layers.push(layer);
  }

  const doc: DocumentState = {
    id: nextId("doc"),
    name: payload.name,
    width: payload.width,
    height: payload.height,
    zoom: payload.zoom,
    panX: payload.panX,
    panY: payload.panY,
    dirty,
    layers,
    activeLayerId: payload.activeLayerId,
    selectedLayerIds: payload.selectedLayerIds ? [...payload.selectedLayerIds] : [],
    history: [...payload.history],
    historyIndex: 0,
    sourcePath: payload.sourcePath,
    projectPath,
    background: payload.background,
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: payload.selectionRect ? { ...payload.selectionRect } : null,
    selectionShape: payload.selectionShape ?? "rect",
    selectionInverted: payload.selectionInverted,
    selectionPath: payload.selectionPath ? { points: payload.selectionPath.points.map((p) => ({ ...p })), closed: payload.selectionPath.closed } : null,
    selectionMask: null,
    guides: (payload.guides ?? []).map((g) => ({ ...g })),
    customFonts: (payload.customFonts ?? []).map((f) => ({ ...f })),
  };
  if (payload.customFonts) {
    const { registerCustomFont } = await import("../app/customFontRegistry");
    for (const font of payload.customFonts) {
      await registerCustomFont(font.family, font.dataUrl, font.fileName);
    }
  }
  if (payload.selectionMaskDataUrl) {
    doc.selectionMask = await deserializeMask(payload.selectionMaskDataUrl, payload.width, payload.height);
  }
  return doc;
}

export function snapshotDocument(doc: DocumentState): string {
  return JSON.stringify(serializeDocument(doc));
}

export async function restoreDocumentFromSnapshot(doc: DocumentState, snapshot: string) {
  const restored = await deserializeDocument(JSON.parse(snapshot) as SerializedDocument, doc.projectPath, true);
  doc.name = restored.name;
  doc.width = restored.width;
  doc.height = restored.height;
  // zoom and pan are view state — not restored by undo/redo
  doc.layers = restored.layers;
  doc.activeLayerId = restored.activeLayerId;
  doc.selectedLayerIds = restored.selectedLayerIds ?? [];
  // doc.history and doc.historyIndex are managed separately by undo/redo logic
  doc.sourcePath = restored.sourcePath;
  doc.background = restored.background;
  doc.dirty = true;
  doc.cropRect = null;
  doc.selectionRect = restored.selectionRect ? { ...restored.selectionRect } : null;
  doc.selectionShape = restored.selectionShape;
  doc.selectionInverted = restored.selectionInverted;
  doc.selectionPath = restored.selectionPath;
  doc.selectionMask = restored.selectionMask ? cloneCanvas(restored.selectionMask) : null;
  doc.guides = restored.guides.map((g) => ({ ...g }));
  doc.customFonts = restored.customFonts.map((f) => ({ ...f }));
}

export function buildStarterDocuments(defaultZoom: number): DocumentState[] {
  const a = createBlankDocument("Starter Shot", 1600, 1000, defaultZoom, "white");
  const layerA = a.layers.find((item) => !item.isBackground && item.type === "raster") as RasterLayer | undefined;
  if (layerA) {
    const ctx = getLayerContext(layerA);
    const gradient = ctx.createLinearGradient(0, 0, a.width, a.height);
    gradient.addColorStop(0, "#1f2b50");
    gradient.addColorStop(1, "#0f1427");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, a.width, a.height);
    ctx.fillStyle = "#ffd54d";
    ctx.beginPath();
    ctx.arc(520, 430, 220, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(980, 180, 300, 600);
    syncLayerSource(layerA);
  }
  a.history = ["Loaded starter artwork"];
  a.dirty = false;

  const b = createBlankDocument("Poster Draft", 1080, 1350, defaultZoom, "white");
  const layerB = b.layers.find((item) => !item.isBackground && item.type === "raster") as RasterLayer | undefined;
  if (layerB) {
    const ctx = getLayerContext(layerB);
    const gradient = ctx.createLinearGradient(0, 0, b.width, b.height);
    gradient.addColorStop(0, "#f59e0b");
    gradient.addColorStop(1, "#7c3aed");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, b.width, b.height);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(120, 180, 840, 220);
    ctx.fillStyle = "rgba(7,11,21,0.82)";
    ctx.fillRect(160, 460, 760, 520);
    syncLayerSource(layerB);
  }
  b.history = ["Loaded starter artwork"];
  b.dirty = true;
  return [a, b];
}

export function createLayerThumb(layer: Layer): HTMLCanvasElement {
  const thumb = document.createElement("canvas");
  thumb.width = 28;
  thumb.height = 28;
  const ctx = thumb.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 28, 28);
    const scale = Math.min(28 / Math.max(1, layer.canvas.width), 28 / Math.max(1, layer.canvas.height));
    ctx.save();
    ctx.translate((28 - layer.canvas.width * scale) / 2, (28 - layer.canvas.height * scale) / 2);
    ctx.scale(scale, scale);
    drawLayerOnto(ctx, layer, 0, 0);
    ctx.restore();
  }
  return thumb;
}

export function compositeDocumentOnto(
  ctx: CanvasRenderingContext2D,
  doc: DocumentState,
  x: number,
  y: number,
  scale: number,
  skipLayerIds: string | string[] | null = null,
  options: { skipAdjustmentLayers?: boolean } = {}
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const skipAdjustmentLayers = options.skipAdjustmentLayers ?? false;
  const skippedLayerIds = skipLayerIds == null
    ? null
    : new Set(Array.isArray(skipLayerIds) ? skipLayerIds : [skipLayerIds]);

  // Track whether we need an off-screen buffer for adjustment layers.
  // We only create the temp canvas if there is at least one visible adjustment layer.
  let hasAdjustments = false;
  for (const layer of doc.layers) {
    if (layer.type === "adjustment" && layer.visible && !skippedLayerIds?.has(layer.id)) {
      hasAdjustments = true;
      break;
    }
  }

  if (!hasAdjustments || skipAdjustmentLayers) {
    // Fast path: no adjustment layers, draw directly
    for (const layer of doc.layers) {
      if (skippedLayerIds?.has(layer.id)) continue;
      if (!layer.visible) continue;
      if (layer.type === "adjustment") continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.blendMode) { ctx.globalCompositeOperation = layer.blendMode; }
      drawLayerOnto(ctx, layer);
      ctx.restore();
    }
  } else {
    // Slow path: use temp canvas for adjustment layer compositing
    const tempCanvas = createLayerCanvas(doc.width, doc.height);
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) {
      ctx.restore();
      return;
    }

    for (const layer of doc.layers) {
      if (skippedLayerIds?.has(layer.id)) continue;
      if (!layer.visible) continue;

      if (layer.type === "adjustment") {
        // Apply adjustment to everything composited so far
        const imgData = tempCtx.getImageData(0, 0, doc.width, doc.height);
        const adjusted = applyAdjustmentLayerParams(layer.adjustmentData, imgData);
        if (layer.mask) {
          // Blend between original and adjusted using the mask
          const blended = blendWithMask(imgData, adjusted, layer.mask);
          tempCtx.putImageData(blended, 0, 0);
        } else {
          tempCtx.putImageData(adjusted, 0, 0);
        }
      } else {
        tempCtx.save();
        tempCtx.globalAlpha = layer.opacity;
        if (layer.blendMode) { tempCtx.globalCompositeOperation = layer.blendMode; }
        drawLayerOnto(tempCtx, layer);
        tempCtx.restore();
      }
    }

    ctx.drawImage(tempCanvas, 0, 0);
  }

  ctx.restore();
}

export async function compositeDocumentToBlob(doc: DocumentState, format: "png" | "jpg" | "webp", quality: number): Promise<Blob> {
  const exportCanvas = createLayerCanvas(doc.width, doc.height);
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create export context");
  if (format === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  compositeDocumentOnto(ctx, doc, 0, 0, 1);
  const mime = format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => {
    exportCanvas.toBlob(resolve, mime, quality);
  });
  if (!blob) throw new Error("Export failed");
  return blob;
}

function resolveDocumentSelectionMask(doc: Pick<DocumentState, "width" | "height" | "selectionRect" | "selectionShape" | "selectionPath" | "selectionMask" | "selectionInverted">) {
  const mask = normalizeSelectionToMask(doc.width, doc.height, doc.selectionRect, doc.selectionShape, doc.selectionPath, doc.selectionMask);
  if (!mask) {
    return null;
  }
  if (doc.selectionInverted) {
    invertMask(mask);
  }
  return isMaskEmpty(mask) ? null : mask;
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
  if (!blob) {
    throw new Error("Export failed");
  }
  return blob;
}

export interface DocumentClipboardRenderResult {
  canvas: HTMLCanvasElement;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
}

export function renderDocumentClipboardCanvas(doc: DocumentState): DocumentClipboardRenderResult {
  const compositeCanvas = createLayerCanvas(doc.width, doc.height);
  const compositeCtx = compositeCanvas.getContext("2d");
  if (!compositeCtx) {
    throw new Error("Failed to create clipboard export context");
  }
  compositeDocumentOnto(compositeCtx, doc, 0, 0, 1);

  const effectiveMask = resolveDocumentSelectionMask(doc);
  if (!effectiveMask) {
    return { canvas: compositeCanvas, selectionBounds: null };
  }

  const selectionBounds = maskBoundingRect(effectiveMask);
  if (!selectionBounds) {
    return { canvas: compositeCanvas, selectionBounds: null };
  }

  const maskCtx = effectiveMask.getContext("2d");
  if (!maskCtx) {
    throw new Error("Failed to read selection mask");
  }

  const croppedCanvas = createLayerCanvas(selectionBounds.width, selectionBounds.height);
  const croppedCtx = croppedCanvas.getContext("2d");
  if (!croppedCtx) {
    throw new Error("Failed to create cropped clipboard context");
  }

  const sourceImage = compositeCtx.getImageData(
    selectionBounds.x,
    selectionBounds.y,
    selectionBounds.width,
    selectionBounds.height,
  );
  const maskImage = maskCtx.getImageData(
    selectionBounds.x,
    selectionBounds.y,
    selectionBounds.width,
    selectionBounds.height,
  );
  const output = croppedCtx.createImageData(selectionBounds.width, selectionBounds.height);

  for (let index = 0; index < output.data.length; index += 4) {
    const maskAlpha = maskImage.data[index + 3] / 255;
    if (maskAlpha <= 0) {
      continue;
    }
    output.data[index] = Math.round(sourceImage.data[index] * maskAlpha);
    output.data[index + 1] = Math.round(sourceImage.data[index + 1] * maskAlpha);
    output.data[index + 2] = Math.round(sourceImage.data[index + 2] * maskAlpha);
    output.data[index + 3] = Math.round(sourceImage.data[index + 3] * maskAlpha);
  }

  croppedCtx.putImageData(output, 0, 0);
  return { canvas: croppedCanvas, selectionBounds };
}

export async function renderDocumentClipboardBlob(doc: DocumentState): Promise<Blob> {
  const { canvas } = renderDocumentClipboardCanvas(doc);
  return canvasToBlob(canvas, "image/png");
}

export function resizeCanvasDocument(doc: DocumentState, nextWidth: number, nextHeight: number, offset: { x: number; y: number }) {
  for (const layer of doc.layers) {
    if (layer.type === "raster") {
      const nextCanvas = createLayerCanvas(nextWidth, nextHeight);
      const nextCtx = nextCanvas.getContext("2d");
      if (nextCtx) {
        nextCtx.drawImage(layer.canvas, offset.x, offset.y);
      }
      layer.canvas = nextCanvas;
      if (layer.isBackground && layer.fillColor) {
        fillLayer(layer, layer.fillColor);
      } else {
        syncLayerSource(layer);
      }
    } else {
      layer.x += offset.x;
      layer.y += offset.y;
    }
  }
  doc.width = nextWidth;
  doc.height = nextHeight;
  doc.cropRect = null;
  doc.selectionRect = null;
  doc.selectionInverted = false;
  doc.selectionMask = null;
}

export function applyCropToDocument(doc: DocumentState, crop: { x: number; y: number; width: number; height: number }) {
  for (const layer of doc.layers) {
    if (layer.type === "raster") {
      const nextCanvas = createLayerCanvas(crop.width, crop.height);
      const nextCtx = nextCanvas.getContext("2d");
      if (nextCtx) {
        nextCtx.drawImage(layer.canvas, layer.x - crop.x, layer.y - crop.y);
      }
      layer.canvas = nextCanvas;
      layer.x = 0;
      layer.y = 0;
      if (layer.isBackground && layer.fillColor) fillLayer(layer, layer.fillColor); else syncLayerSource(layer);
    } else {
      layer.x -= crop.x;
      layer.y -= crop.y;
    }
  }
  doc.width = crop.width;
  doc.height = crop.height;
  doc.panX = 0;
  doc.panY = 0;
  doc.cropRect = null;
  doc.selectionRect = null;
  doc.selectionInverted = false;
  doc.selectionMask = null;
  pushHistory(doc, "Applied crop");
}

export function createTextLayer(name: string, x: number, y: number, overrides: Partial<TextLayerData> = {}): TextLayer {
  const fill = overrides.fill ?? { type: "solid" as const, color: overrides.fillColor ?? "#ffffff" };
  const fillColor = getTextFillColor(fill);
  const layer: TextLayer = {
    id: nextId("layer"),
    type: "text",
    name,
    canvas: createLayerCanvas(1, 1),
    sourceCanvas: undefined,
    x,
    y,
    visible: true,
    opacity: 1,
    locked: false,
    effects: normalizeEffects(),
    textData: {
      text: "Text",
      fontFamily: "Georgia",
      fontSize: 64,
      lineHeight: 1.2,
      kerning: 0,
      rotationDeg: 0,
      alignment: "left",
      fill,
      stroke: null,
      fillColor,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      boxWidth: null,
      boxHeight: null,
      ...overrides,
      scaleX: overrides.scaleX ?? 1,
      scaleY: overrides.scaleY ?? 1,
      skewXDeg: overrides.skewXDeg ?? 0,
      skewYDeg: overrides.skewYDeg ?? 0,
    },
  };
  renderTextLayer(layer);
  return layer;
}

export function measureTextBoxHeight(data: TextLayerData) {
  const { lines, lineAdvance } = getTextMetrics(data);
  return Math.max(1, Math.ceil(lines.length * lineAdvance + Math.max(8, data.fontSize * 0.35)));
}

export function createShapeLayer(name: string, kind: ShapeKind, x: number, y: number): ShapeLayer {
  const layer: ShapeLayer = {
    id: nextId("layer"),
    type: "shape",
    name,
    canvas: createLayerCanvas(1, 1),
    sourceCanvas: undefined,
    x,
    y,
    visible: true,
    opacity: 1,
    locked: false,
    effects: normalizeEffects(),
    shapeData: {
      kind,
      width: kind === "line" ? 240 : 220,
      height: kind === "line" ? 120 : 160,
      rotationDeg: 0,
      fillColor: kind === "line" ? null : "#4ADE80",
      strokeColor: "#F8FAFC",
      strokeWidth: 4,
      cornerRadius: kind === "rectangle" ? 18 : 0,
    },
  };
  renderShapeLayer(layer);
  return layer;
}

export function createAdjustmentLayer(name: string, data: AdjustmentLayerData): AdjustmentLayer {
  return {
    id: nextId("layer"),
    type: "adjustment",
    name,
    canvas: createLayerCanvas(1, 1), // placeholder — adjustment layers have no pixel content
    sourceCanvas: undefined,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    effects: normalizeEffects(),
    adjustmentData: { kind: data.kind, params: { ...data.params } },
  };
}
