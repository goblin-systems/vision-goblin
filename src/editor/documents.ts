import { pushHistory } from "./history";
import type { DocumentState, Guide, RasterLayer, SerializedDocument, TransformDraft } from "./types";
import { nextId, stripExtension } from "./utils";

export function createLayerCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = createLayerCanvas(source.width, source.height);
  canvas.getContext("2d")?.drawImage(source, 0, 0);
  return canvas;
}

export function syncLayerSource(layer: RasterLayer) {
  layer.sourceCanvas = cloneCanvas(layer.canvas);
}

function multiply2x2(
  left: { a: number; b: number; c: number; d: number },
  right: { a: number; b: number; c: number; d: number }
) {
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
  }
  return {
    canvas,
    x: draft.pivotX + minX,
    y: draft.pivotY + minY,
    width: canvas.width,
    height: canvas.height,
  };
}

export function getLayerContext(layer: RasterLayer): CanvasRenderingContext2D {
  const ctx = layer.canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable for layer");
  }
  return ctx;
}

export function fillLayer(layer: RasterLayer, color: string) {
  const ctx = getLayerContext(layer);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  layer.fillColor = color;
  syncLayerSource(layer);
}

export function clearLayer(layer: RasterLayer) {
  const ctx = getLayerContext(layer);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  layer.fillColor = undefined;
  syncLayerSource(layer);
}

export function createBackgroundLayer(width: number, height: number, color: string | null = "#ffffff"): RasterLayer {
  const layer: RasterLayer = {
    id: nextId("layer"),
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
  };
  if (color) {
    fillLayer(layer, color);
  } else {
    clearLayer(layer);
  }
  return layer;
}

export function createBlankDocument(
  name: string,
  width: number,
  height: number,
  defaultZoom: number,
  background: DocumentState["background"] = "white"
): DocumentState {
  const backgroundLayer = createBackgroundLayer(width, height, background === "white" ? "#ffffff" : null);
  const baseLayer: RasterLayer = {
    id: nextId("layer"),
    name: "Layer 1",
    canvas: createLayerCanvas(width, height),
    sourceCanvas: undefined,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
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
    history: ["Created blank canvas"],
    sourcePath: null,
    projectPath: null,
    background,
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: null,
    selectionInverted: false,
    guides: [],
  };
}

export function cloneLayer(layer: RasterLayer): RasterLayer {
  const canvas = cloneCanvas(layer.canvas);
  return {
    id: nextId("layer"),
    name: layer.name,
    canvas,
    sourceCanvas: cloneCanvas(layer.sourceCanvas ?? layer.canvas),
    x: layer.x,
    y: layer.y,
    visible: layer.visible,
    opacity: layer.opacity,
    locked: layer.locked,
    isBackground: layer.isBackground,
    fillColor: layer.fillColor,
  };
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
    sourcePath: null,
    projectPath: null,
    undoStack: [],
    redoStack: [],
    selectionRect: doc.selectionRect ? { ...doc.selectionRect } : null,
    selectionInverted: doc.selectionInverted,
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

export async function createDocumentFromBlob(
  name: string,
  blob: Blob,
  sourcePath: string | null,
  defaultZoom: number
): Promise<DocumentState> {
  const image = await blobToImage(blob);
  const doc = createBlankDocument(stripExtension(name), image.naturalWidth, image.naturalHeight, defaultZoom);
  const layer = doc.layers.find((item) => !item.isBackground) ?? doc.layers[1];
  if (!layer) {
    throw new Error("Failed to create base layer");
  }
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
    history: [...doc.history],
    sourcePath: doc.sourcePath,
    background: doc.background,
    selectionRect: doc.selectionRect ? { ...doc.selectionRect } : null,
    selectionInverted: doc.selectionInverted,
    guides: doc.guides.map((g) => ({ ...g })),
    layers: doc.layers.map((layer) => ({
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
    })),
  };
}

export async function deserializeDocument(
  payload: SerializedDocument,
  projectPath: string | null,
  dirty = false
): Promise<DocumentState> {
  const layers: RasterLayer[] = [];

  for (const item of payload.layers) {
    const image = await blobToImage(await (await fetch(item.dataUrl)).blob());
    const canvas = createLayerCanvas(payload.width, payload.height);
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    layers.push({
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
    });
  }

  return {
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
    history: [...payload.history],
    sourcePath: payload.sourcePath,
    projectPath,
    background: payload.background,
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: payload.selectionRect ? { ...payload.selectionRect } : null,
    selectionInverted: payload.selectionInverted,
    guides: (payload.guides ?? []).map((g) => ({ ...g })),
  };
}

export function snapshotDocument(doc: DocumentState): string {
  return JSON.stringify(serializeDocument(doc));
}

export async function restoreDocumentFromSnapshot(doc: DocumentState, snapshot: string) {
  const restored = await deserializeDocument(JSON.parse(snapshot) as SerializedDocument, doc.projectPath, true);
  doc.name = restored.name;
  doc.width = restored.width;
  doc.height = restored.height;
  doc.zoom = restored.zoom;
  doc.panX = restored.panX;
  doc.panY = restored.panY;
  doc.layers = restored.layers;
  doc.activeLayerId = restored.activeLayerId;
  doc.history = restored.history;
  doc.sourcePath = restored.sourcePath;
  doc.background = restored.background;
  doc.dirty = true;
  doc.cropRect = null;
  doc.selectionRect = restored.selectionRect ? { ...restored.selectionRect } : null;
  doc.selectionInverted = restored.selectionInverted;
  doc.guides = restored.guides.map((g) => ({ ...g }));
}

export function buildStarterDocuments(defaultZoom: number): DocumentState[] {
  const a = createBlankDocument("Starter Shot", 1600, 1000, defaultZoom, "white");
  const layerA = a.layers.find((item) => !item.isBackground);
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
  }
  a.history = ["Loaded starter artwork"];
  a.dirty = false;

  const b = createBlankDocument("Poster Draft", 1080, 1350, defaultZoom, "white");
  const layerB = b.layers.find((item) => !item.isBackground);
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
  }
  b.history = ["Loaded starter artwork"];
  b.dirty = true;

  return [a, b];
}

export function createLayerThumb(layer: RasterLayer): HTMLCanvasElement {
  const thumb = document.createElement("canvas");
  thumb.width = 28;
  thumb.height = 28;
  const ctx = thumb.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 28, 28);
    ctx.drawImage(layer.canvas, 0, 0, 28, 28);
  }
  return thumb;
}

export function compositeDocumentOnto(ctx: CanvasRenderingContext2D, doc: DocumentState, x: number, y: number, scale: number, skipLayerId: string | null = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  for (const layer of doc.layers) {
    if (skipLayerId && layer.id === skipLayerId) continue;
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
    ctx.restore();
  }

  ctx.restore();
}

export async function compositeDocumentToBlob(
  doc: DocumentState,
  format: "png" | "jpg" | "webp",
  quality: number
): Promise<Blob> {
  const exportCanvas = createLayerCanvas(doc.width, doc.height);
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create export context");
  }

  if (format === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  compositeDocumentOnto(ctx, doc, 0, 0, 1);
  const mime = format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => {
    exportCanvas.toBlob(resolve, mime, quality);
  });
  if (!blob) {
    throw new Error("Export failed");
  }
  return blob;
}

export function resizeCanvasDocument(doc: DocumentState, nextWidth: number, nextHeight: number, offset: { x: number; y: number }) {
  for (const layer of doc.layers) {
    const nextCanvas = createLayerCanvas(nextWidth, nextHeight);
    const nextCtx = nextCanvas.getContext("2d");
    if (nextCtx) {
      nextCtx.drawImage(layer.canvas, offset.x, offset.y);
    }
    layer.canvas = nextCanvas;
    if (layer.isBackground && layer.fillColor) {
      fillLayer(layer, layer.fillColor);
    }
  }

  doc.width = nextWidth;
  doc.height = nextHeight;
  doc.cropRect = null;
  doc.selectionRect = null;
  doc.selectionInverted = false;
}

export function applyCropToDocument(doc: DocumentState, crop: { x: number; y: number; width: number; height: number }) {
  for (const layer of doc.layers) {
    const nextCanvas = createLayerCanvas(crop.width, crop.height);
    const nextCtx = nextCanvas.getContext("2d");
    if (nextCtx) {
      nextCtx.drawImage(layer.canvas, layer.x - crop.x, layer.y - crop.y);
    }
    layer.canvas = nextCanvas;
    layer.x = 0;
    layer.y = 0;
    if (layer.isBackground && layer.fillColor) {
      fillLayer(layer, layer.fillColor);
    }
  }

  doc.width = crop.width;
  doc.height = crop.height;
  doc.panX = 0;
  doc.panY = 0;
  doc.cropRect = null;
  doc.selectionRect = null;
  doc.selectionInverted = false;
  pushHistory(doc, "Applied crop");
}
