import { pushHistory } from "./history";
import { deserializeMask, serializeMask } from "./selection";
import type {
  AdjustmentLayer,
  AdjustmentLayerData,
  DocumentState,
  Layer,
  LayerBase,
  LayerEffect,
  RasterLayer,
  SerializedDocument,
  ShapeKind,
  ShapeLayer,
  SmartObjectLayer,
  TextLayer,
  TextLayerData,
  TransformDraft,
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

function drawTextLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, kerning: number) {
  if (!kerning) {
    ctx.fillText(text, x, y);
    return;
  }
  let cursor = x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
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
  const height = Math.max(1, Math.ceil(lines.length * lineAdvance + Math.max(8, data.fontSize * 0.35)));
  return { lines, width, height, lineAdvance };
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

export function renderTextLayer(layer: TextLayer) {
  const { lines, width, height, lineAdvance } = getTextMetrics(layer.textData);
  const baseCanvas = createLayerCanvas(width, height);
  const ctx = getLayerContext({ canvas: baseCanvas });
  ctx.clearRect(0, 0, width, height);
  ctx.font = buildTextFont(layer.textData);
  ctx.fillStyle = layer.textData.fillColor;
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWidth = ctx.measureText(line).width + Math.max(0, line.length - 1) * layer.textData.kerning;
    const x = layer.textData.alignment === "center"
      ? (width - lineWidth) / 2
      : layer.textData.alignment === "right"
        ? width - lineWidth
        : 0;
    drawTextLine(ctx, line, x, i * lineAdvance, layer.textData.kerning);
  }
  layer.canvas = layer.textData.rotationDeg ? rotateCanvas(baseCanvas, layer.textData.rotationDeg) : baseCanvas;
  layer.fillColor = layer.textData.fillColor;
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

  // Collect enabled effects by type
  const outerGlow = effects.find((e): e is Extract<LayerEffect, { type: "outer-glow" }> => e.type === "outer-glow" && e.enabled);
  const shadow = effects.find((e): e is Extract<LayerEffect, { type: "drop-shadow" }> => e.type === "drop-shadow" && e.enabled);
  const outline = effects.find((e): e is Extract<LayerEffect, { type: "outline" }> => e.type === "outline" && e.enabled);
  const innerShadow = effects.find((e): e is Extract<LayerEffect, { type: "inner-shadow" }> => e.type === "inner-shadow" && e.enabled);
  const colorOverlay = effects.find((e): e is Extract<LayerEffect, { type: "color-overlay" }> => e.type === "color-overlay" && e.enabled);

  // --- Behind-layer effects (drawn before layer content) ---

  // Outer glow: shadow API with 0 offset
  if (outerGlow && hasContent) {
    ctx.save();
    ctx.shadowColor = outerGlow.color;
    ctx.shadowBlur = outerGlow.blur + outerGlow.spread;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha *= outerGlow.opacity;
    ctx.drawImage(layer.canvas, x, y);
    ctx.restore();
  }

  // Drop shadow
  if (shadow && hasContent) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.globalAlpha *= shadow.opacity;
    ctx.drawImage(layer.canvas, x, y);
    ctx.restore();
  }

  // Outline (radial stamp)
  if (outline && outline.width > 0 && hasContent) {
    const outlined = buildOutlineCanvas(layer, outline.width, outline.color, outline.opacity);
    ctx.drawImage(outlined.canvas, x + outlined.offsetX, y + outlined.offsetY);
  }

  // --- Layer content ---

  const hasInnerEffects = (innerShadow || colorOverlay) && hasContent;

  if (hasInnerEffects) {
    // Use temp canvas so we can apply inside-layer effects clipped to layer alpha
    const temp = createLayerCanvas(layer.canvas.width, layer.canvas.height);
    const tCtx = temp.getContext("2d");
    if (tCtx) {
      // Draw layer content onto temp
      tCtx.drawImage(layer.canvas, 0, 0);

      // Inner shadow: inverted alpha + shadow API + source-atop
      if (innerShadow) {
        const inv = createLayerCanvas(layer.canvas.width, layer.canvas.height);
        const invCtx = inv.getContext("2d");
        if (invCtx) {
          // Create inverted alpha: fill everything, then punch out layer shape
          invCtx.fillStyle = "#000000";
          invCtx.fillRect(0, 0, inv.width, inv.height);
          invCtx.globalCompositeOperation = "destination-out";
          invCtx.drawImage(layer.canvas, 0, 0);
          invCtx.globalCompositeOperation = "source-over";

          // Draw inverted shape with shadow onto a shadow canvas
          const shadowCanvas = createLayerCanvas(layer.canvas.width, layer.canvas.height);
          const sCtx = shadowCanvas.getContext("2d");
          if (sCtx) {
            sCtx.shadowColor = innerShadow.color;
            sCtx.shadowBlur = innerShadow.blur;
            sCtx.shadowOffsetX = innerShadow.offsetX;
            sCtx.shadowOffsetY = innerShadow.offsetY;
            sCtx.drawImage(inv, 0, 0);
            // Clear the inverted shape itself so only the shadow remains
            sCtx.shadowColor = "transparent";
            sCtx.shadowBlur = 0;
            sCtx.shadowOffsetX = 0;
            sCtx.shadowOffsetY = 0;
            sCtx.globalCompositeOperation = "destination-out";
            sCtx.drawImage(inv, 0, 0);
            sCtx.globalCompositeOperation = "source-over";
          }

          // Composite inner shadow onto temp, clipped to layer alpha
          tCtx.save();
          tCtx.globalCompositeOperation = "source-atop";
          tCtx.globalAlpha = innerShadow.opacity;
          tCtx.drawImage(shadowCanvas, 0, 0);
          tCtx.restore();
        }
      }

      // Color overlay: fill clipped to layer alpha via source-atop
      if (colorOverlay) {
        tCtx.save();
        tCtx.globalCompositeOperation = "source-atop";
        tCtx.globalAlpha = colorOverlay.opacity;
        tCtx.fillStyle = colorOverlay.color;
        tCtx.fillRect(0, 0, temp.width, temp.height);
        tCtx.restore();
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

export function buildTransformPreview(draft: TransformDraft) {
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
  return { canvas, x: draft.pivotX + minX, y: draft.pivotY + minY, width: canvas.width, height: canvas.height };
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
    locked: layer.locked,
    isBackground: layer.isBackground,
    fillColor: layer.fillColor,
    effects: normalizeEffects(layer.effects),
    mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    aiProvenance: layer.aiProvenance ? { ...layer.aiProvenance, warnings: [...layer.aiProvenance.warnings] } : undefined,
  };
  if (layer.type === "text") {
    return { ...base, type: "text", textData: { ...layer.textData } };
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
    layers: doc.layers.map((layer) => ({
      type: layer.type,
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      visible: layer.visible,
      opacity: layer.opacity,
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
      const textLayer: TextLayer = { ...base, type: "text", textData: { ...item.textData } };
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
  };
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

export function compositeDocumentOnto(ctx: CanvasRenderingContext2D, doc: DocumentState, x: number, y: number, scale: number, skipLayerId: string | null = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Track whether we need an off-screen buffer for adjustment layers.
  // We only create the temp canvas if there is at least one visible adjustment layer.
  let hasAdjustments = false;
  for (const layer of doc.layers) {
    if (layer.type === "adjustment" && layer.visible && !(skipLayerId && layer.id === skipLayerId)) {
      hasAdjustments = true;
      break;
    }
  }

  if (!hasAdjustments) {
    // Fast path: no adjustment layers, draw directly
    for (const layer of doc.layers) {
      if (skipLayerId && layer.id === skipLayerId) continue;
      if (!layer.visible) continue;
      if (layer.type === "adjustment") continue; // shouldn't happen but guard
      ctx.save();
      ctx.globalAlpha = layer.opacity;
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
      if (skipLayerId && layer.id === skipLayerId) continue;
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
      fillColor: "#ffffff",
      bold: false,
      italic: false,
      boxWidth: null,
      ...overrides,
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
