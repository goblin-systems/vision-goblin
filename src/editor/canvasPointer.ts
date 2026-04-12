import { beginDocumentOperation, cancelDocumentOperation, commitDocumentOperation, markDocumentOperationChanged, pushHistory } from "./history";
import { buildCropRect, getDocCoordinates } from "./geometry";
import type { BrushState, DocumentState, Layer, PointerState, RasterLayer, Rect, SelectionPath, TextLayer, TransformDraft, TransformHandle, TransformIntent } from "./types";
import { applyCropToDocument, buildTransformFrameBounds, buildTransformPreview, snapshotDocument, createLayerCanvas, compositeDocumentOnto, getLayerContext, measureTextBoxBounds, refreshLayerCanvas, syncLayerSource } from "./documents";
import { clamp } from "./utils";
import { applySelectionClip, combineMasks, createMaskCanvas, defaultPolygonRotation, drawThroughMask, isAxisAlignedRectMarquee, maskBoundingRect, maskContainsRect, rasterizeRectToMask, type SelectionMode } from "./selection";
import { drawMaskStroke } from "./layerMask";
import { applyFillToSelection } from "./fill";
import { getFillGradientTargetError } from "./fillGradientValidation";
import { selectLayer } from "./layers";
import { findTopmostPixelBackedLayerAtPoint, findTopmostShapeLayerAtPoint } from "./shapeHitTesting";
import { createHealingStrokeSession, healingStroke, resetHealingStrokeSession, type HealingStrokeSession } from "./healing";

type TransformMode = "scale" | "rotate";
type TransformDraftState = {
  layerId: string;
  intent: TransformIntent;
   frameBounds?: Rect;
   previewLayerIds?: string[];
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  centerX: number;
  centerY: number;
  pivotX: number;
  pivotY: number;
  sourceCanvas: HTMLCanvasElement;
  textBoxWidth?: number | null;
  textBoxHeight?: number | null;
  previewOverride?: TransformDraft["previewOverride"];
};

function getDraftFrameBounds(draft: TransformDraftState, layer: Layer) {
  return buildTransformFrameBounds({
    ...draft,
    frameBounds: draft.frameBounds ?? { x: layer.x, y: layer.y, width: layer.canvas.width, height: layer.canvas.height },
  });
}

function createTransformProxyLayer(layer: Layer, bounds: Rect): Layer {
  if (bounds.width === layer.canvas.width && bounds.height === layer.canvas.height) {
    return layer;
  }
  const proxyCanvas = createLayerCanvas(Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)));
  return {
    ...layer,
    canvas: proxyCanvas,
    sourceCanvas: proxyCanvas,
    x: bounds.x,
    y: bounds.y,
  };
}

function unionRects(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function subtractRect(base: Rect, cut: Rect): Rect | null {
  const overlap = intersectRects(base, cut);
  if (!overlap) return base;
  if (overlap.width === base.width && overlap.height === base.height) return null;

  const candidates: Rect[] = [];
  if (overlap.y > base.y) {
    candidates.push({ x: base.x, y: base.y, width: base.width, height: overlap.y - base.y });
  }
  const baseBottom = base.y + base.height;
  const overlapBottom = overlap.y + overlap.height;
  if (overlapBottom < baseBottom) {
    candidates.push({ x: base.x, y: overlapBottom, width: base.width, height: baseBottom - overlapBottom });
  }
  if (overlap.x > base.x) {
    candidates.push({ x: base.x, y: overlap.y, width: overlap.x - base.x, height: overlap.height });
  }
  const baseRight = base.x + base.width;
  const overlapRight = overlap.x + overlap.width;
  if (overlapRight < baseRight) {
    candidates.push({ x: overlapRight, y: overlap.y, width: baseRight - overlapRight, height: overlap.height });
  }

  return candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? null;
}

function buildCornerMarqueeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  doc: Pick<DocumentState, "width" | "height">,
  perfect = false,
): Rect {
  if (!perfect) {
    return buildCropRect(startX, startY, currentX, currentY, doc);
  }

  const anchorX = clamp(Math.round(startX), 0, doc.width);
  const anchorY = clamp(Math.round(startY), 0, doc.height);
  const cursorX = clamp(Math.round(currentX), 0, doc.width);
  const cursorY = clamp(Math.round(currentY), 0, doc.height);
  const size = Math.max(1, Math.min(Math.abs(cursorX - anchorX), Math.abs(cursorY - anchorY)));
  const dragLeft = cursorX < anchorX;
  const dragUp = cursorY < anchorY;

  return {
    x: dragLeft ? anchorX - size : anchorX,
    y: dragUp ? anchorY - size : anchorY,
    width: size,
    height: size,
  };
}

function applySelectionMode(current: Rect | null, next: Rect | null, mode: "replace" | "add" | "subtract" | "intersect") {
  if (!next) return current;
  if (mode === "replace" || !current) return next;
  if (mode === "add") return unionRects(current, next);
  if (mode === "intersect") return intersectRects(current, next);
  return subtractRect(current, next);
}

function getTransformHandle(
  layer: Layer,
  x: number,
  y: number,
  mode: TransformMode,
  boundsOverride?: { x: number; y: number; width: number; height: number },
  intent: TransformIntent = "layer",
): TransformHandle | null {
  const bx = boundsOverride?.x ?? layer.x;
  const by = boundsOverride?.y ?? layer.y;
  const bw = boundsOverride?.width ?? layer.canvas.width;
  const bh = boundsOverride?.height ?? layer.canvas.height;
  const right = bx + bw;
  const bottom = by + bh;
  const centerX = bx + bw / 2;
  const centerY = by + bh / 2;
  const handles: Array<[TransformHandle, number, number]> = intent === "text-layout"
    ? [["nw", bx, by], ["ne", right, by], ["sw", bx, bottom], ["se", right, bottom], ["n", centerX, by], ["e", right, centerY], ["s", centerX, bottom], ["w", bx, centerY]]
    : mode === "rotate"
    ? [["nw", bx, by], ["ne", right, by], ["sw", bx, bottom], ["se", right, bottom]]
    : [["nw", bx, by], ["ne", right, by], ["sw", bx, bottom], ["se", right, bottom], ["n", centerX, by], ["e", right, centerY], ["s", centerX, bottom], ["w", bx, centerY]];
  return handles.find(([, cx, cy]) => Math.abs(x - cx) <= 12 && Math.abs(y - cy) <= 12)?.[0] ?? null;
}

function isPointInsideLayerFrame(layer: Layer, x: number, y: number, boundsOverride?: { x: number; y: number; width: number; height: number }) {
  const bx = boundsOverride?.x ?? layer.x;
  const by = boundsOverride?.y ?? layer.y;
  const bw = boundsOverride?.width ?? layer.canvas.width;
  const bh = boundsOverride?.height ?? layer.canvas.height;
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

function applyTransformedCanvas(
  layer: Layer,
  source: HTMLCanvasElement,
  matrix: { a: number; b: number; c: number; d: number },
  anchorSourceX: number,
  anchorSourceY: number,
  anchorWorldX: number,
  anchorWorldY: number
) {
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
  const nextWidth = Math.max(1, Math.ceil(maxX - minX));
  const nextHeight = Math.max(1, Math.ceil(maxY - minY));
  const nextCanvas = createLayerCanvas(nextWidth, nextHeight);
  const nextCtx = nextCanvas.getContext("2d");
  if (nextCtx) {
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, -minX, -minY);
    nextCtx.drawImage(source, -anchorSourceX, -anchorSourceY);
    nextCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
  layer.canvas = nextCanvas;
  layer.x = Math.round(anchorWorldX + minX);
  layer.y = Math.round(anchorWorldY + minY);
}

function resizeLayerFromHandle(
  layer: Layer,
  handle: TransformHandle,
  x: number,
  y: number,
  startX: number,
  startY: number,
  startWidth: number,
  startHeight: number,
  preserveAspectRatio: boolean
) {
  const source = layer.sourceCanvas ?? layer.canvas;
  const anchorX = handle.endsWith("w") ? startX + startWidth : startX;
  const anchorY = handle.startsWith("n") ? startY + startHeight : startY;
  const nextLeft = handle.endsWith("w") ? Math.min(x, anchorX - 1) : anchorX;
  const nextTop = handle.startsWith("n") ? Math.min(y, anchorY - 1) : anchorY;
  const nextRight = handle.endsWith("w") ? anchorX : Math.max(x, anchorX + 1);
  const nextBottom = handle.startsWith("n") ? anchorY : Math.max(y, anchorY + 1);
  let nextWidth = Math.max(1, Math.round(nextRight - nextLeft));
  let nextHeight = Math.max(1, Math.round(nextBottom - nextTop));
  if (preserveAspectRatio) {
    const aspect = startWidth / Math.max(1, startHeight);
    if (Math.abs(nextWidth / Math.max(1, nextHeight) - aspect) > 0.001) {
      if (Math.abs(x - anchorX) > Math.abs(y - anchorY)) {
        nextHeight = Math.max(1, Math.round(nextWidth / aspect));
      } else {
        nextWidth = Math.max(1, Math.round(nextHeight * aspect));
      }
    }
  }
  const nextCanvas = createLayerCanvas(nextWidth, nextHeight);
  const nextCtx = nextCanvas.getContext("2d");
  if (nextCtx) {
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.drawImage(source, 0, 0, nextWidth, nextHeight);
  }
  layer.canvas = nextCanvas;
  layer.x = Math.round(Math.min(nextLeft, nextRight));
  layer.y = Math.round(Math.min(nextTop, nextBottom));
}

function rotateDraft(
  draft: { pivotX: number; pivotY: number; rotateDeg: number },
  x: number,
  y: number,
  startX: number,
  startY: number,
  baseRotateDeg: number,
  constrain = false
) {
  const angle = Math.atan2(y - draft.pivotY, x - draft.pivotX) - Math.atan2(startY - draft.pivotY, startX - draft.pivotX);
  let deg = baseRotateDeg + (angle * 180) / Math.PI;
  if (constrain) {
    deg = Math.round(deg / 15) * 15;
  }
  draft.rotateDeg = deg;
}

function skewDraft(
  draft: { skewXDeg: number; skewYDeg: number },
  handle: TransformHandle,
  x: number,
  y: number,
  startX: number,
  startY: number,
  startWidth: number,
  startHeight: number,
  baseSkewXDeg: number,
  baseSkewYDeg: number
) {
  const startHandleX = handle === "e" ? startX + startWidth : handle === "w" ? startX : startX + startWidth / 2;
  const startHandleY = handle === "s" ? startY + startHeight : handle === "n" ? startY : startY + startHeight / 2;
  const dx = x - startHandleX;
  const dy = y - startHandleY;
  draft.skewXDeg = baseSkewXDeg + ((handle === "n" || handle === "s")
    ? clamp((handle === "n" ? -dx : dx) / Math.max(1, startHeight), -1.5, 1.5) * 45
    : 0);
  draft.skewYDeg = baseSkewYDeg + ((handle === "e" || handle === "w")
    ? clamp((handle === "w" ? -dy : dy) / Math.max(1, startWidth), -1.5, 1.5) * 45
    : 0);
}

function isTextBoxResizeHandle(handle: TransformHandle) {
  return handle === "n" || handle === "s";
}

function isTextHorizontalResizeHandle(handle: TransformHandle) {
  return handle === "e" || handle === "w";
}

function isTextCornerResizeHandle(handle: TransformHandle) {
  return handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";
}

function buildTextLayoutPreviewLayer(
  draft: TransformDraftState,
  layer: TextLayer,
  overrides: Partial<Pick<TextLayer["textData"], "boxWidth" | "boxHeight">>,
) {
  const previewLayer: TextLayer = {
    ...layer,
    canvas: layer.canvas,
    sourceCanvas: layer.sourceCanvas,
    textData: {
      ...layer.textData,
      boxWidth: draft.textBoxWidth ?? layer.textData.boxWidth,
      boxHeight: draft.textBoxHeight ?? layer.textData.boxHeight,
      ...overrides,
    },
  };
  refreshLayerCanvas(previewLayer);
  return previewLayer;
}

function applyTextLayoutPreview(
  draft: TransformDraftState,
  handle: TransformHandle,
  startX: number,
  startY: number,
  startWidth: number,
  startHeight: number,
  previewLayer: TextLayer,
) {
  draft.scaleX = 1;
  draft.scaleY = 1;
  draft.skewXDeg = 0;
  draft.skewYDeg = 0;
  draft.rotateDeg = 0;
  draft.previewOverride = {
    canvas: previewLayer.canvas,
    x: handle.endsWith("e") || handle === "n" || handle === "s"
      ? startX
      : startX + startWidth - previewLayer.canvas.width,
    y: handle.startsWith("s") || handle === "e" || handle === "w"
      ? startY
      : startY + startHeight - previewLayer.canvas.height,
    width: previewLayer.canvas.width,
    height: previewLayer.canvas.height,
  };
  draft.centerX = draft.previewOverride.x + draft.previewOverride.width / 2;
  draft.centerY = draft.previewOverride.y + draft.previewOverride.height / 2;
  draft.pivotX = draft.centerX;
  draft.pivotY = draft.centerY;
}

function updateTextDraftFromSideHandle(
  draft: TransformDraftState,
  layer: TextLayer,
  handle: TransformHandle,
  x: number,
  startX: number,
  startY: number,
  startWidth: number,
  startHeight: number,
  startTextBoxWidth: number,
) {
  const initialBoxWidth = Math.max(1, Math.round(startTextBoxWidth || layer.textData.boxWidth || measureTextBoxBounds(layer.textData).width));
  const left = handle === "w" ? Math.min(x, startX + startWidth - 1) : startX;
  const right = handle === "w" ? startX + startWidth : Math.max(x, startX + 1);
  const nextFrameWidth = Math.max(1, Math.round(right - left));
  const widthRatio = nextFrameWidth / Math.max(1, startWidth);
  const nextTextBoxWidth = Math.max(24, Math.round(initialBoxWidth * widthRatio));
  const previewLayer = buildTextLayoutPreviewLayer(draft, layer, { boxWidth: nextTextBoxWidth });
  draft.textBoxWidth = nextTextBoxWidth;
  applyTextLayoutPreview(draft, handle, startX, startY, startWidth, startHeight, previewLayer);
}

function updateTextDraftFromVerticalHandle(
  draft: TransformDraftState,
  layer: TextLayer,
  handle: TransformHandle,
  y: number,
  startX: number,
  startY: number,
  startWidth: number,
  startHeight: number,
  startTextBoxHeight: number,
) {
  const initialBoxHeight = Math.max(1, Math.round(startTextBoxHeight || layer.textData.boxHeight || measureTextBoxBounds(layer.textData).height));
  const top = handle === "n" ? Math.min(y, startY + startHeight - 1) : startY;
  const bottom = handle === "n" ? startY + startHeight : Math.max(y, startY + 1);
  const nextFrameHeight = Math.max(1, Math.round(bottom - top));
  const heightRatio = nextFrameHeight / Math.max(1, startHeight);
  const nextTextBoxHeight = Math.max(24, Math.round(initialBoxHeight * heightRatio));
  const previewLayer = buildTextLayoutPreviewLayer(draft, layer, { boxHeight: nextTextBoxHeight });
  draft.textBoxHeight = nextTextBoxHeight;
  applyTextLayoutPreview(draft, handle, startX, startY, startWidth, startHeight, previewLayer);
}

function updateTextDraftFromCornerHandle(
  draft: TransformDraftState,
  layer: TextLayer,
  handle: TransformHandle,
  x: number,
  y: number,
  startX: number,
  startY: number,
  startWidth: number,
  startHeight: number,
  startTextBoxWidth: number,
  startTextBoxHeight: number,
) {
  const initialBoxWidth = Math.max(1, Math.round(startTextBoxWidth || layer.textData.boxWidth || measureTextBoxBounds(layer.textData).width));
  const initialBoxHeight = Math.max(1, Math.round(startTextBoxHeight || layer.textData.boxHeight || measureTextBoxBounds(layer.textData).height));
  const left = handle.endsWith("w") ? Math.min(x, startX + startWidth - 1) : startX;
  const right = handle.endsWith("w") ? startX + startWidth : Math.max(x, startX + 1);
  const top = handle.startsWith("n") ? Math.min(y, startY + startHeight - 1) : startY;
  const bottom = handle.startsWith("n") ? startY + startHeight : Math.max(y, startY + 1);
  const nextFrameWidth = Math.max(1, Math.round(right - left));
  const nextFrameHeight = Math.max(1, Math.round(bottom - top));
  const nextTextBoxWidth = Math.max(24, Math.round(initialBoxWidth * (nextFrameWidth / Math.max(1, startWidth))));
  const nextTextBoxHeight = Math.max(24, Math.round(initialBoxHeight * (nextFrameHeight / Math.max(1, startHeight))));
  const previewLayer = buildTextLayoutPreviewLayer(draft, layer, {
    boxWidth: nextTextBoxWidth,
    boxHeight: nextTextBoxHeight,
  });
  draft.textBoxWidth = nextTextBoxWidth;
  draft.textBoxHeight = nextTextBoxHeight;
  applyTextLayoutPreview(draft, handle, startX, startY, startWidth, startHeight, previewLayer);
}

export function drawStroke(
  layer: RasterLayer,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  mode: "brush" | "eraser",
  brushSize: number,
  brushOpacity: number,
  activeColour: string,
  selectionRect?: Rect | null,
  selectionInverted = false,
  selectionShape: "rect" | "ellipse" = "rect",
  selectionPath?: SelectionPath | null,
  selectionMask?: HTMLCanvasElement | null
) {
  const ctx = getLayerContext(layer);
  const strokeFn = (c: CanvasRenderingContext2D, compositeOperation: GlobalCompositeOperation) => {
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = brushSize;
    c.globalAlpha = brushOpacity;
    c.globalCompositeOperation = compositeOperation;
    c.strokeStyle = activeColour;
    c.beginPath();
    c.moveTo(fromX - layer.x, fromY - layer.y);
    c.lineTo(toX - layer.x, toY - layer.y);
    c.stroke();
  };

  if (selectionMask) {
    drawThroughMask(
      ctx,
      layer.canvas.width,
      layer.canvas.height,
      selectionMask,
      selectionInverted,
      layer.x,
      layer.y,
      (maskCtx) => strokeFn(maskCtx, "source-over"),
      mode === "eraser" ? "destination-out" : "source-over",
    );
  } else if (selectionRect) {
    ctx.save();
    applySelectionClip(ctx, selectionRect, selectionShape, selectionInverted, selectionPath ?? null, layer.x, layer.y, layer.canvas.width, layer.canvas.height);
    strokeFn(ctx, mode === "eraser" ? "destination-out" : "source-over");
    ctx.restore();
  } else {
    ctx.save();
    strokeFn(ctx, mode === "eraser" ? "destination-out" : "source-over");
    ctx.restore();
  }
}

/**
 * Smudge stroke: samples pixels at (fromX,fromY) and blends them into (toX,toY)
 * within a circular brush area, with given strength (0-1).
 */
export function smudgeStroke(
  layer: RasterLayer,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  brushSize: number,
  strength: number,
  selectionRect?: Rect | null,
  selectionInverted = false,
  selectionShape: "rect" | "ellipse" = "rect"
) {
  const ctx = getLayerContext(layer);
  const radius = brushSize / 2;
  const lx = Math.floor(fromX - layer.x - radius);
  const ly = Math.floor(fromY - layer.y - radius);
  const size = Math.ceil(brushSize);
  if (size < 1) return;

  // Clamp source region to layer bounds
  const sx = Math.max(0, lx);
  const sy = Math.max(0, ly);
  const ex = Math.min(layer.canvas.width, lx + size);
  const ey = Math.min(layer.canvas.height, ly + size);
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw < 1 || sh < 1) return;

  // Sample source pixels
  const sourceData = ctx.getImageData(sx, sy, sw, sh);
  const srcPixels = new Uint8ClampedArray(sourceData.data);

  // Target position on layer
  const tx = Math.floor(toX - layer.x - radius);
  const ty = Math.floor(toY - layer.y - radius);
  const tsx = Math.max(0, tx);
  const tsy = Math.max(0, ty);
  const tex = Math.min(layer.canvas.width, tx + size);
  const tey = Math.min(layer.canvas.height, ty + size);
  const tw = tex - tsx;
  const th = tey - tsy;
  if (tw < 1 || th < 1) return;

  const destData = ctx.getImageData(tsx, tsy, tw, th);
  const dstPixels = destData.data;

  const centerR = radius;
  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      const docPx = tsx + px + layer.x;
      const docPy = tsy + py + layer.y;

      // Check selection clipping
      if (selectionRect) {
        const inSel = isInSelection(docPx, docPy, selectionRect, selectionShape);
        if (selectionInverted ? inSel : !inSel) continue;
      }

      // Check circular brush
      const bx = (tsx + px) - tx;
      const by = (tsy + py) - ty;
      const dist = Math.sqrt((bx - centerR) ** 2 + (by - centerR) ** 2);
      if (dist > radius) continue;

      // Map target pixel back to source region
      const srcPx = (tsx + px) - tx + (sx - lx);
      const srcPy = (tsy + py) - ty + (sy - ly);
      if (srcPx < 0 || srcPx >= sw || srcPy < 0 || srcPy >= sh) continue;

      const si = (srcPy * sw + srcPx) * 4;
      const di = (py * tw + px) * 4;

      // Feather at edges
      const feather = Math.max(0, 1 - dist / radius);
      const s = strength * feather;

      dstPixels[di]     = Math.round(dstPixels[di]     + (srcPixels[si]     - dstPixels[di])     * s);
      dstPixels[di + 1] = Math.round(dstPixels[di + 1] + (srcPixels[si + 1] - dstPixels[di + 1]) * s);
      dstPixels[di + 2] = Math.round(dstPixels[di + 2] + (srcPixels[si + 2] - dstPixels[di + 2]) * s);
      dstPixels[di + 3] = Math.round(dstPixels[di + 3] + (srcPixels[si + 3] - dstPixels[di + 3]) * s);
    }
  }

  ctx.putImageData(destData, tsx, tsy);
}

/**
 * Clone stamp: paints pixels sampled from a source offset onto the target position.
 */
export function cloneStampStroke(
  layer: RasterLayer,
  toX: number,
  toY: number,
  offsetX: number,
  offsetY: number,
  brushSize: number,
  brushOpacity: number,
  selectionRect?: Rect | null,
  selectionInverted = false,
  selectionShape: "rect" | "ellipse" = "rect"
) {
  const ctx = getLayerContext(layer);
  const radius = brushSize / 2;
  const size = Math.ceil(brushSize);
  if (size < 1) return;

  // Source position (where we're sampling from)
  const srcDocX = toX + offsetX;
  const srcDocY = toY + offsetY;
  const slx = Math.floor(srcDocX - layer.x - radius);
  const sly = Math.floor(srcDocY - layer.y - radius);
  const ssx = Math.max(0, slx);
  const ssy = Math.max(0, sly);
  const sex = Math.min(layer.canvas.width, slx + size);
  const sey = Math.min(layer.canvas.height, sly + size);
  const ssw = sex - ssx;
  const ssh = sey - ssy;
  if (ssw < 1 || ssh < 1) return;

  const sourceData = ctx.getImageData(ssx, ssy, ssw, ssh);
  const srcPixels = sourceData.data;

  // Target position
  const tlx = Math.floor(toX - layer.x - radius);
  const tly = Math.floor(toY - layer.y - radius);
  const tsx = Math.max(0, tlx);
  const tsy = Math.max(0, tly);
  const tex = Math.min(layer.canvas.width, tlx + size);
  const tey = Math.min(layer.canvas.height, tly + size);
  const tw = tex - tsx;
  const th = tey - tsy;
  if (tw < 1 || th < 1) return;

  const destData = ctx.getImageData(tsx, tsy, tw, th);
  const dstPixels = destData.data;

  const centerR = radius;
  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      const docPx = tsx + px + layer.x;
      const docPy = tsy + py + layer.y;

      if (selectionRect) {
        const inSel = isInSelection(docPx, docPy, selectionRect, selectionShape);
        if (selectionInverted ? inSel : !inSel) continue;
      }

      const bx = (tsx + px) - tlx;
      const by = (tsy + py) - tly;
      const dist = Math.sqrt((bx - centerR) ** 2 + (by - centerR) ** 2);
      if (dist > radius) continue;

      // Map to source pixel
      const srcPx = (tsx + px) - tlx + (ssx - slx);
      const srcPy = (tsy + py) - tly + (ssy - sly);
      if (srcPx < 0 || srcPx >= ssw || srcPy < 0 || srcPy >= ssh) continue;

      const si = (srcPy * ssw + srcPx) * 4;
      const di = (py * tw + px) * 4;

      const feather = Math.max(0, 1 - dist / radius);
      const alpha = brushOpacity * feather;

      dstPixels[di]     = Math.round(dstPixels[di]     + (srcPixels[si]     - dstPixels[di])     * alpha);
      dstPixels[di + 1] = Math.round(dstPixels[di + 1] + (srcPixels[si + 1] - dstPixels[di + 1]) * alpha);
      dstPixels[di + 2] = Math.round(dstPixels[di + 2] + (srcPixels[si + 2] - dstPixels[di + 2]) * alpha);
      dstPixels[di + 3] = Math.round(dstPixels[di + 3] + (srcPixels[si + 3] - dstPixels[di + 3]) * alpha);
    }
  }

  ctx.putImageData(destData, tsx, tsy);
}

function isInSelection(x: number, y: number, rect: Rect, shape: "rect" | "ellipse"): boolean {
  if (shape === "ellipse") {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1;
  }
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function pickColourAt(doc: DocumentState, docX: number, docY: number): string | null {
  const composite = createLayerCanvas(doc.width, doc.height);
  const ctx = composite.getContext("2d");
  if (!ctx) return null;
  compositeDocumentOnto(ctx, doc, 0, 0, 1);
  const pixel = ctx.getImageData(clamp(Math.round(docX), 0, doc.width - 1), clamp(Math.round(docY), 0, doc.height - 1), 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function drawEphemeralMaskStroke(
  mask: HTMLCanvasElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  brushSize: number,
  brushOpacity: number,
  mode: "reveal" | "hide",
) {
  const ctx = mask.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = brushSize;
  ctx.globalAlpha = brushOpacity;
  ctx.globalCompositeOperation = mode === "hide" ? "destination-out" : "source-over";
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.restore();
}

interface CanvasPointerDeps {
  editorCanvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getActiveTool: () => string;
  isTextEditingActive: () => boolean;
  commitTransformDraft: () => void;
  cancelTransformDraft: (showMessage?: boolean) => void;
  getSelectionMode: () => "replace" | "add" | "subtract" | "intersect";
  getMarqueeShape: () => number;
  getTransformMode: () => TransformMode;
  ensureTransformDraft: (doc: DocumentState, layer: Layer, intent?: TransformIntent) => TransformDraftState | null;
  getTransformDraft: () => TransformDraftState | null;
  syncTransformInputs: () => void;
  getBrushState: () => BrushState;
  getSpacePressed: () => boolean;
  getMarqueeModifiers: () => { rotate: boolean; perfect: boolean };
  snapLayerPosition: (layer: Layer, x: number, y: number) => { x: number; y: number };
  pointerState: PointerState;
  renderCanvas: () => void;
  scheduleCanvasRender: () => void;
  renderEditorState: () => void;
  onColourPicked: (colour: string) => void;
  getCloneSource: () => { x: number; y: number } | null;
  setCloneSource: (source: { x: number; y: number } | null) => void;
  onLassoPoint: (x: number, y: number) => void;
  onLassoComplete: () => void;
  onCreateTextLayer: (x: number, y: number) => Layer | null;
  onCreateShapeLayer: (x: number, y: number) => Layer | null;
  onLayerCreationCommitted?: (layer: Layer) => void;
  getCustomPaintTarget: () => {
    canvas: HTMLCanvasElement;
    exclusiveCanvas?: HTMLCanvasElement;
    historyMode: "document" | "ephemeral";
    paintLabel: string;
    logLabel: string;
  } | null;
  /** Returns the layer ID whose mask is being edited, or null if not in mask-edit mode. */
  getMaskEditTarget: () => string | null;
  /** Returns the quick mask canvas when quick mask mode is active, or null. */
  getQuickMaskCanvas: () => HTMLCanvasElement | null;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  /** When an AI mask session is active, returns the target canvas for selection results. Null means use doc.selectionMask as normal. */
  getSelectionMaskTarget: () => HTMLCanvasElement | null;
}

function shouldCommitPendingTransformBeforePointerAction(tool: string) {
  return [
    "move",
    "crop",
    "marquee",
    "lasso",
    "polygon-lasso",
    "magic-wand",
    "brush",
    "eraser",
    "fill",
    "gradient",
    "smudge",
    "clone-stamp",
    "healing-brush",
    "text",
    "shape",
  ].includes(tool);
}

function shouldAltPickLayer(tool: string) {
  return [
    "move",
    "transform",
    "brush",
    "eraser",
    "fill",
    "gradient",
    "eyedropper",
    "smudge",
    "healing-brush",
  ].includes(tool);
}

function toolOwnsTransformDraft(tool: string, draft: TransformDraftState | null) {
  if (!draft) {
    return false;
  }
  return (tool === "transform" && draft.intent === "layer")
    || (tool === "text" && draft.intent === "text-layout");
}

function isTransformInteractiveTool(tool: string) {
  return tool === "transform" || tool === "text";
}

export function createCanvasPointerController(deps: CanvasPointerDeps) {
  let polygonLastClickTime = 0;
  let healingSession: HealingStrokeSession | null = null;

  function clearHealingSession() {
    if (healingSession) {
      resetHealingStrokeSession(healingSession);
      healingSession = null;
    }
  }

  function handlePointerDown(event: PointerEvent) {
    clearHealingSession();
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const activeTool = deps.getActiveTool();
    const { x, y } = getDocCoordinates(event.clientX, event.clientY, doc, deps.editorCanvas.getBoundingClientRect());
    deps.pointerState.lastDocX = x;
    deps.pointerState.lastDocY = y;
    deps.pointerState.startDocX = x;
    deps.pointerState.startDocY = y;
    deps.pointerState.startClientX = event.clientX;
    deps.pointerState.startClientY = event.clientY;
    deps.pointerState.startPanX = doc.panX;
    deps.pointerState.startPanY = doc.panY;

    if (deps.getSpacePressed() || event.button === 1) {
      deps.pointerState.mode = "pan";
      deps.canvasWrap.classList.add("is-panning");
      deps.log("Canvas pan started", "INFO");
      return;
    }

    if (deps.getTransformDraft() && !toolOwnsTransformDraft(activeTool, deps.getTransformDraft()) && shouldCommitPendingTransformBeforePointerAction(activeTool)) {
      deps.commitTransformDraft();
    }

    let layer = deps.getActiveLayer(doc);
    if (event.altKey && shouldAltPickLayer(activeTool)) {
      const hitLayer = findTopmostPixelBackedLayerAtPoint(doc, x, y);
      if (hitLayer) {
        if (hitLayer.id !== layer?.id) {
          selectLayer(doc, hitLayer.id);
          deps.log(`Alt-picked layer '${hitLayer.name}'`, "INFO");
        }
        deps.renderEditorState();
        return;
      }
    }
    if (activeTool === "move" || activeTool === "transform" || activeTool === "text") {
      const hitShapeLayer = findTopmostShapeLayerAtPoint(doc, x, y);
      if (hitShapeLayer && hitShapeLayer.id !== layer?.id) {
        selectLayer(doc, hitShapeLayer.id);
        layer = hitShapeLayer;
      }
    }
    deps.pointerState.startLayerX = layer?.x ?? 0;
    deps.pointerState.startLayerY = layer?.y ?? 0;
    deps.pointerState.startSelectionRect = doc.selectionRect ? { ...doc.selectionRect } : null;
    deps.pointerState.startSelectionInverted = doc.selectionInverted;

    if (activeTool === "marquee") {
      deps.pointerState.mode = "marquee";
      doc.selectionRect = buildCropRect(x, y, x, y, doc);
      deps.log(`Selection started at ${Math.round(x)},${Math.round(y)} (sides=${deps.getMarqueeShape()})`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (activeTool === "lasso") {
      deps.pointerState.mode = "lasso";
      doc.selectionPath = { points: [{ x, y }], closed: false };
      deps.log(`Lasso started at ${Math.round(x)},${Math.round(y)}`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (activeTool === "polygon-lasso") {
      if (!doc.selectionPath || doc.selectionPath.closed) {
        doc.selectionPath = { points: [{ x, y }], closed: false };
        polygonLastClickTime = performance.now();
      } else {
        const now = performance.now();
        const isDoubleClick = (now - polygonLastClickTime) < 400;
        polygonLastClickTime = now;
        if (isDoubleClick && doc.selectionPath.points.length >= 3) {
          // Double-click closes the polygon lasso
          deps.onLassoComplete();
          return;
        }
        deps.onLassoPoint(x, y);
      }
      deps.renderEditorState();
      return;
    }

    if (activeTool === "magic-wand") {
      deps.onLassoComplete();
      return;
    }

    if (activeTool === "text") {
      if (deps.isTextEditingActive()) {
        return;
      }

      if (layer?.type === "text") {
        const activeTextLayoutDraft = (() => {
          const draft = deps.getTransformDraft();
          return draft?.layerId === layer.id && draft.intent === "text-layout" ? draft : null;
        })();
        const previewBounds = activeTextLayoutDraft?.previewOverride ?? undefined;
        const handle = getTransformHandle(layer, x, y, deps.getTransformMode(), previewBounds, "text-layout");
        if (handle || isPointInsideLayerFrame(layer, x, y, previewBounds)) {
          const draft = activeTextLayoutDraft ?? deps.ensureTransformDraft(doc, layer, "text-layout");
          if (draft) {
            deps.pointerState.mode = "move-layer";
            deps.pointerState.transformHandle = handle;
            deps.pointerState.startLayerX = layer.x;
            deps.pointerState.startLayerY = layer.y;
            deps.pointerState.startLayerWidth = (previewBounds?.width ?? layer.canvas.width);
            deps.pointerState.startLayerHeight = (previewBounds?.height ?? layer.canvas.height);
            deps.pointerState.startScaleX = draft.scaleX;
            deps.pointerState.startScaleY = draft.scaleY;
            deps.pointerState.startCenterX = draft.centerX;
            deps.pointerState.startCenterY = draft.centerY;
            deps.pointerState.startPivotX = draft.pivotX;
            deps.pointerState.startPivotY = draft.pivotY;
            deps.pointerState.startRotateDeg = draft.rotateDeg;
            deps.pointerState.startSkewXDeg = draft.skewXDeg;
            deps.pointerState.startSkewYDeg = draft.skewYDeg;
            deps.pointerState.startTextBoxWidth = Math.max(
              1,
              Math.round(draft.textBoxWidth ?? layer.textData.boxWidth ?? measureTextBoxBounds(layer.textData).width),
            );
            deps.pointerState.startTextBoxHeight = Math.max(
              1,
              Math.round(draft.textBoxHeight ?? layer.textData.boxHeight ?? measureTextBoxBounds(layer.textData).height),
            );
            deps.canvasWrap.classList.add("is-dragging");
            deps.log(handle ? `Text layout transform started on layer '${layer.name}'` : `Text layout move started on layer '${layer.name}'`, "INFO");
            return;
          }
        }
        if (activeTextLayoutDraft) {
          deps.cancelTransformDraft(false);
          return;
        }
      }
      beginDocumentOperation(snapshotDocument(doc));
      const created = deps.onCreateTextLayer(x, y);
      if (created) {
        deps.pointerState.mode = "create-layer";
        deps.pointerState.creationLayerId = created.id;
        deps.pointerState.startLayerX = created.x;
        deps.pointerState.startLayerY = created.y;
        deps.pointerState.startLayerWidth = created.canvas.width;
        deps.pointerState.startLayerHeight = created.canvas.height;
        markDocumentOperationChanged();
        deps.renderEditorState();
      }
      return;
    }

    if (activeTool === "shape") {
      beginDocumentOperation(snapshotDocument(doc));
      const created = deps.onCreateShapeLayer(x, y);
      if (created) {
        deps.pointerState.mode = "create-layer";
        deps.pointerState.creationLayerId = created.id;
        deps.pointerState.startLayerX = created.x;
        deps.pointerState.startLayerY = created.y;
        deps.pointerState.startLayerWidth = created.canvas.width;
        deps.pointerState.startLayerHeight = created.canvas.height;
        markDocumentOperationChanged();
        deps.renderEditorState();
      }
      return;
    }

    if (activeTool === "fill") {
      const targetError = getFillGradientTargetError("fill", layer);
      if (targetError) {
        deps.showToast(targetError, "error");
        if (!layer) {
          deps.log("Fill aborted because there was no active layer", "WARN");
        } else if (layer.locked) {
          deps.log(`Fill aborted because layer '${layer.name}' is locked`, "WARN");
        } else {
          deps.log(`Fill aborted because layer '${layer.name}' is ${layer.type}`, "WARN");
        }
        return;
      }
      if (!layer || layer.locked || layer.type !== "raster") {
        return;
      }

      beginDocumentOperation(snapshotDocument(doc));
      const brush = deps.getBrushState();
      const result = applyFillToSelection(doc, layer, brush.activeColour);
      if (!result.ok) {
        cancelDocumentOperation();
        deps.showToast(result.message, result.variant);
        deps.log(`Fill aborted: ${result.message}`, "WARN");
        return;
      }

      markDocumentOperationChanged();
      commitDocumentOperation(doc, "Filled selection");
      deps.showToast(result.message, "success");
      deps.log(`Filled selection on layer '${layer.name}'`, "INFO");
      deps.renderEditorState();
      return;
    }

    const customPaintTarget = (activeTool === "brush" || activeTool === "eraser")
      ? deps.getCustomPaintTarget()
      : null;
    if (customPaintTarget) {
      if (customPaintTarget.historyMode === "document") {
        beginDocumentOperation(snapshotDocument(doc));
        markDocumentOperationChanged();
      }
      deps.pointerState.mode = "paint";
      const brush = deps.getBrushState();
      const maskMode = activeTool === "brush" ? "reveal" : "hide";
      if (maskMode === "reveal" && customPaintTarget.exclusiveCanvas) {
        drawEphemeralMaskStroke(customPaintTarget.exclusiveCanvas, x, y, x, y, brush.brushSize, brush.brushOpacity, "hide");
      }
      drawEphemeralMaskStroke(customPaintTarget.canvas, x, y, x, y, brush.brushSize, brush.brushOpacity, maskMode);
      deps.log(`${customPaintTarget.logLabel} ${maskMode} stroke started`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (!layer || layer.locked) {
      if (activeTool === "crop") {
        deps.pointerState.mode = "crop";
        doc.cropRect = buildCropRect(x, y, x, y, doc);
        deps.log(`Crop gesture started at ${Math.round(x)},${Math.round(y)}`, "INFO");
        deps.renderEditorState();
      }
      return;
    }

    if (activeTool === "crop") {
      deps.pointerState.mode = "crop";
      doc.cropRect = buildCropRect(x, y, x, y, doc);
      deps.log(`Crop gesture started at ${Math.round(x)},${Math.round(y)}`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (activeTool === "move") {
      beginDocumentOperation(snapshotDocument(doc));
      deps.pointerState.mode = "move-layer";
      deps.canvasWrap.classList.add("is-dragging");
      deps.log(`Move gesture started on layer '${layer.name}'`, "INFO");
      return;
    }

    if (activeTool === "transform") {
      const draft = deps.ensureTransformDraft(doc, layer);
      if (!draft) {
        return;
      }
      if (event.button === 2) {
        deps.pointerState.mode = "pivot-drag";
        deps.canvasWrap.classList.add("is-dragging");
        deps.log("Pivot drag started", "INFO");
        return;
      }
      const draftHasTransform = Math.abs(draft.scaleX - 1) > 0.001 || Math.abs(draft.scaleY - 1) > 0.001 || Math.abs(draft.rotateDeg) > 0.001 || Math.abs(draft.skewXDeg) > 0.001 || Math.abs(draft.skewYDeg) > 0.001;
      const previewBounds = draftHasTransform ? buildTransformPreview(draft as TransformDraft) : undefined;
      const frameBounds = previewBounds ?? getDraftFrameBounds(draft, layer);
      const handle = getTransformHandle(layer, x, y, deps.getTransformMode(), frameBounds, draft.intent);
      deps.pointerState.mode = "move-layer";
      deps.pointerState.transformHandle = handle;
      deps.pointerState.startLayerX = frameBounds.x;
      deps.pointerState.startLayerY = frameBounds.y;
      deps.pointerState.startLayerWidth = frameBounds.width;
      deps.pointerState.startLayerHeight = frameBounds.height;
      deps.pointerState.startScaleX = draft.scaleX;
      deps.pointerState.startScaleY = draft.scaleY;
      deps.pointerState.startCenterX = draft.centerX;
      deps.pointerState.startCenterY = draft.centerY;
      deps.pointerState.startPivotX = draft.pivotX;
      deps.pointerState.startPivotY = draft.pivotY;
      deps.pointerState.startRotateDeg = draft.rotateDeg;
      deps.pointerState.startSkewXDeg = draft.skewXDeg;
      deps.pointerState.startSkewYDeg = draft.skewYDeg;
      deps.canvasWrap.classList.add("is-dragging");
      deps.log(handle ? `Transform started on layer '${layer.name}'` : `Transform move started on layer '${layer.name}'`, "INFO");
      return;
    }

    if (activeTool === "brush" || activeTool === "eraser") {
      // Quick mask painting: redirect brush/eraser to the quick mask canvas
      const qmCanvas = deps.getQuickMaskCanvas();
      if (qmCanvas) {
        beginDocumentOperation(snapshotDocument(doc));
        deps.pointerState.mode = "paint";
        const brush = deps.getBrushState();
        const maskMode = activeTool === "brush" ? "reveal" : "hide";
        drawMaskStroke(qmCanvas, x, y, x, y, brush.brushSize, brush.brushOpacity, maskMode);
        markDocumentOperationChanged();
        deps.log(`Quick mask ${maskMode} stroke started`, "INFO");
        deps.renderEditorState();
        return;
      }
      // Mask painting: when mask editing is active on the current layer
      const maskTarget = deps.getMaskEditTarget();
      if (maskTarget && layer.id === maskTarget && layer.mask) {
        beginDocumentOperation(snapshotDocument(doc));
        deps.pointerState.mode = "paint";
        const brush = deps.getBrushState();
        const maskMode = activeTool === "brush" ? "reveal" : "hide";
        drawMaskStroke(layer.mask, x, y, x, y, brush.brushSize, brush.brushOpacity, maskMode);
        markDocumentOperationChanged();
        deps.log(`Mask ${maskMode} stroke started on layer '${layer.name}'`, "INFO");
        deps.renderEditorState();
        return;
      }
      // Normal raster painting
      if (layer.type === "smart-object" || layer.type === "text" || layer.type === "shape") {
        deps.log(`Cannot paint on ${layer.type} layer \u2014 rasterize first`, "WARN");
        return;
      }
      if (layer.type === "raster") {
        beginDocumentOperation(snapshotDocument(doc));
        deps.pointerState.mode = "paint";
        const brush = deps.getBrushState();
         drawStroke(layer, x, y, x, y, activeTool === "brush" ? "brush" : "eraser", brush.brushSize, brush.brushOpacity, brush.activeColour, doc.selectionRect, doc.selectionInverted, doc.selectionShape, doc.selectionPath, doc.selectionMask);
        markDocumentOperationChanged();
        deps.log(`${activeTool} stroke started on layer '${layer.name}'`, "INFO");
        deps.renderEditorState();
        return;
      }
    }

    if (activeTool === "smudge") {
      if (layer.type === "smart-object" || layer.type === "text" || layer.type === "shape") {
        deps.log(`Cannot smudge on ${layer.type} layer \u2014 rasterize first`, "WARN");
        return;
      }
      if (layer.type === "raster") {
        beginDocumentOperation(snapshotDocument(doc));
        deps.pointerState.mode = "paint";
        deps.log(`Smudge stroke started on layer '${layer.name}'`, "INFO");
        deps.renderEditorState();
        return;
      }
    }

    if (activeTool === "clone-stamp") {
      if (layer.type === "smart-object" || layer.type === "text" || layer.type === "shape") {
        deps.log(`Cannot clone-stamp on ${layer.type} layer \u2014 rasterize first`, "WARN");
        return;
      }
      if (layer.type === "raster") {
        if (event.altKey) {
          // Set clone source
          deps.setCloneSource({ x, y });
          deps.log(`Clone source set at ${Math.round(x)},${Math.round(y)}`, "INFO");
          return;
        }
        const cloneSrc = deps.getCloneSource();
        if (!cloneSrc) {
          deps.log("Alt-click to set clone source first", "WARN");
          return;
        }
        // Calculate offset from current pos to clone source
        deps.pointerState.cloneOffsetX = cloneSrc.x - x;
        deps.pointerState.cloneOffsetY = cloneSrc.y - y;
        beginDocumentOperation(snapshotDocument(doc));
        deps.pointerState.mode = "paint";
        const brush = deps.getBrushState();
        cloneStampStroke(layer, x, y, deps.pointerState.cloneOffsetX, deps.pointerState.cloneOffsetY, brush.brushSize, brush.brushOpacity, doc.selectionRect, doc.selectionInverted, doc.selectionShape);
        markDocumentOperationChanged();
        deps.log(`Clone stamp stroke started on layer '${layer.name}'`, "INFO");
        deps.renderEditorState();
        return;
      }
    }

    if (activeTool === "healing-brush") {
      if (layer.type === "smart-object" || layer.type === "text" || layer.type === "shape") {
        deps.log(`Cannot heal on ${layer.type} layer \u2014 rasterize first`, "WARN");
        return;
      }
      if (layer.type === "raster") {
        beginDocumentOperation(snapshotDocument(doc));
        deps.pointerState.mode = "paint";
        const brush = deps.getBrushState();
        healingSession = createHealingStrokeSession();
        healingStroke(layer, {
          x,
          y,
          brushSize: brush.brushSize,
          strength: brush.brushOpacity,
          sampleSpread: brush.healingSampleSpread,
          blend: brush.healingBlend,
          selectionRect: doc.selectionRect,
          selectionInverted: doc.selectionInverted,
          selectionShape: doc.selectionShape,
          selectionPath: doc.selectionPath,
          selectionMask: doc.selectionMask,
        }, healingSession);
        markDocumentOperationChanged();
        deps.log(`Healing stroke started on layer '${layer.name}'`, "INFO");
        deps.renderEditorState();
        return;
      }
    }

    if (activeTool === "eyedropper") {
      const colour = pickColourAt(doc, x, y);
      if (colour) {
        deps.log(`Sampled colour ${colour} at ${Math.round(x)},${Math.round(y)}`, "INFO");
        deps.onColourPicked(colour);
      }
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = deps.getActiveLayer(doc);
    const coords = getDocCoordinates(event.clientX, event.clientY, doc, deps.editorCanvas.getBoundingClientRect());

    if (deps.pointerState.mode === "pan") {
      doc.panX = deps.pointerState.startPanX + (event.clientX - deps.pointerState.startClientX);
      doc.panY = deps.pointerState.startPanY + (event.clientY - deps.pointerState.startClientY);
      deps.scheduleCanvasRender();
      return;
    }

    if (deps.pointerState.mode === "pivot-drag") {
      const draft = deps.getTransformDraft();
      if (draft) {
        draft.pivotX = coords.x;
        draft.pivotY = coords.y;
        deps.scheduleCanvasRender();
      }
      return;
    }

    if (deps.pointerState.mode === "move-layer" && layer) {
      const activeTool = deps.getActiveTool();
      if (isTransformInteractiveTool(activeTool) && toolOwnsTransformDraft(activeTool, deps.getTransformDraft())) {
        const draft = deps.getTransformDraft();
        if (!draft) {
          return;
        }
        const transformLayer = doc.layers.find((item) => item.id === draft.layerId) ?? layer;
        if (deps.pointerState.transformHandle) {
          if (draft.intent === "layer" && deps.getTransformMode() === "rotate") {
            rotateDraft(
              draft,
              coords.x,
              coords.y,
              deps.pointerState.startDocX,
              deps.pointerState.startDocY,
              deps.pointerState.startRotateDeg,
              event.shiftKey
            );
            draft.previewOverride = null;
          } else if (draft.intent === "text-layout" && transformLayer.type === "text" && isTextHorizontalResizeHandle(deps.pointerState.transformHandle)) {
            updateTextDraftFromSideHandle(
              draft,
              transformLayer,
              deps.pointerState.transformHandle,
              coords.x,
              deps.pointerState.startLayerX,
              deps.pointerState.startLayerY,
              deps.pointerState.startLayerWidth,
              deps.pointerState.startLayerHeight,
              deps.pointerState.startTextBoxWidth,
            );
          } else if (draft.intent === "text-layout" && transformLayer.type === "text" && isTextBoxResizeHandle(deps.pointerState.transformHandle)) {
            updateTextDraftFromVerticalHandle(
              draft,
              transformLayer,
              deps.pointerState.transformHandle,
              coords.y,
              deps.pointerState.startLayerX,
              deps.pointerState.startLayerY,
              deps.pointerState.startLayerWidth,
              deps.pointerState.startLayerHeight,
              deps.pointerState.startTextBoxHeight,
            );
          } else if (draft.intent === "text-layout" && transformLayer.type === "text" && isTextCornerResizeHandle(deps.pointerState.transformHandle)) {
            updateTextDraftFromCornerHandle(
              draft,
              transformLayer,
              deps.pointerState.transformHandle,
              coords.x,
              coords.y,
              deps.pointerState.startLayerX,
              deps.pointerState.startLayerY,
              deps.pointerState.startLayerWidth,
              deps.pointerState.startLayerHeight,
              deps.pointerState.startTextBoxWidth,
              deps.pointerState.startTextBoxHeight,
            );
          } else if (transformLayer.type === "shape" && ["n", "e", "s", "w"].includes(deps.pointerState.transformHandle)) {
            const centerX = draft.centerX;
            const centerY = draft.centerY;
            draft.scaleX = deps.pointerState.transformHandle === "e" || deps.pointerState.transformHandle === "w"
              ? Math.max(0.01, Math.abs(coords.x - centerX) / Math.max(1, deps.pointerState.startLayerWidth / 2))
              : 1;
            draft.scaleY = deps.pointerState.transformHandle === "n" || deps.pointerState.transformHandle === "s"
              ? Math.max(0.01, Math.abs(coords.y - centerY) / Math.max(1, deps.pointerState.startLayerHeight / 2))
              : 1;
            draft.skewXDeg = 0;
            draft.skewYDeg = 0;
            draft.previewOverride = null;
          } else if (["n", "e", "s", "w"].includes(deps.pointerState.transformHandle)) {
            draft.previewOverride = null;
            skewDraft(
              draft,
              deps.pointerState.transformHandle,
              coords.x,
              coords.y,
              deps.pointerState.startLayerX,
              deps.pointerState.startLayerY,
              deps.pointerState.startLayerWidth,
              deps.pointerState.startLayerHeight,
              deps.pointerState.startSkewXDeg,
              deps.pointerState.startSkewYDeg
            );
          } else {
            const centerX = draft.centerX;
            const centerY = draft.centerY;
            let scaleX = Math.max(0.01, Math.abs(coords.x - centerX) / Math.max(1, deps.pointerState.startLayerWidth / 2));
            let scaleY = Math.max(0.01, Math.abs(coords.y - centerY) / Math.max(1, deps.pointerState.startLayerHeight / 2));
            if (event.ctrlKey || event.metaKey) {
                const uniform = Math.max(scaleX, scaleY);
                scaleX = uniform;
                scaleY = uniform;
              }
              draft.scaleX = scaleX;
              draft.scaleY = scaleY;
              draft.previewOverride = null;
            }
          deps.syncTransformInputs();
          deps.scheduleCanvasRender();
          return;
        }
        const rawX = Math.round(deps.pointerState.startLayerX + (event.clientX - deps.pointerState.startClientX) / coords.bounds.scale);
        const rawY = Math.round(deps.pointerState.startLayerY + (event.clientY - deps.pointerState.startClientY) / coords.bounds.scale);
        const snapped = deps.snapLayerPosition(
          createTransformProxyLayer(transformLayer, getDraftFrameBounds(draft, transformLayer)),
          rawX,
          rawY
        );
        const dx = snapped.x - deps.pointerState.startLayerX;
        const dy = snapped.y - deps.pointerState.startLayerY;
        draft.centerX = deps.pointerState.startCenterX + dx;
        draft.centerY = deps.pointerState.startCenterY + dy;
        draft.pivotX = deps.pointerState.startPivotX + dx;
        draft.pivotY = deps.pointerState.startPivotY + dy;
        markDocumentOperationChanged();
        doc.dirty = true;
        deps.scheduleCanvasRender();
        return;
      }
      const rawX = Math.round(deps.pointerState.startLayerX + (event.clientX - deps.pointerState.startClientX) / coords.bounds.scale);
      const rawY = Math.round(deps.pointerState.startLayerY + (event.clientY - deps.pointerState.startClientY) / coords.bounds.scale);
      const snapped = deps.snapLayerPosition(layer, rawX, rawY);
      layer.x = snapped.x;
      layer.y = snapped.y;
      markDocumentOperationChanged();
      doc.dirty = true;
      deps.scheduleCanvasRender();
      return;
    }

    if (deps.pointerState.mode === "create-layer" && doc) {
      const created = doc.layers.find((item) => item.id === deps.pointerState.creationLayerId);
      if (!created) {
        return;
      }
      deps.pointerState.lastDocX = coords.x;
      deps.pointerState.lastDocY = coords.y;
      const left = Math.min(deps.pointerState.startDocX, coords.x);
      const top = Math.min(deps.pointerState.startDocY, coords.y);
      const width = Math.max(1, Math.abs(coords.x - deps.pointerState.startDocX));
      const height = Math.max(1, Math.abs(coords.y - deps.pointerState.startDocY));
      if (created.type === "shape") {
        created.x = Math.round(left);
        created.y = Math.round(top);
        created.shapeData.width = Math.round(width);
        created.shapeData.height = Math.round(height);
        if (created.shapeData.kind === "line") {
          created.shapeData.width = Math.round(width);
          created.shapeData.height = Math.round(height);
        }
        refreshLayerCanvas(created);
      } else if (created.type === "text") {
        const draggedFarEnough = Math.abs(coords.x - deps.pointerState.startDocX) > 8 || Math.abs(coords.y - deps.pointerState.startDocY) > 8;
        created.x = Math.round(left);
        created.y = Math.round(top);
        created.textData.boxWidth = draggedFarEnough ? Math.max(40, Math.round(width)) : null;
        created.textData.boxHeight = draggedFarEnough ? Math.max(24, Math.round(height)) : null;
        refreshLayerCanvas(created);
      }
      if (created.type === "shape") {
        deps.scheduleCanvasRender();
      } else {
        deps.renderEditorState();
      }
      return;
    }

    if (deps.pointerState.mode === "paint") {
      const customPaintTarget = deps.getCustomPaintTarget();
      if (customPaintTarget) {
        const brush = deps.getBrushState();
        const maskMode = deps.getActiveTool() === "brush" ? "reveal" : "hide";
        if (maskMode === "reveal" && customPaintTarget.exclusiveCanvas) {
          drawEphemeralMaskStroke(
            customPaintTarget.exclusiveCanvas,
            deps.pointerState.lastDocX,
            deps.pointerState.lastDocY,
            coords.x,
            coords.y,
            brush.brushSize,
            brush.brushOpacity,
            "hide",
          );
        }
        drawEphemeralMaskStroke(customPaintTarget.canvas, deps.pointerState.lastDocX, deps.pointerState.lastDocY, coords.x, coords.y, brush.brushSize, brush.brushOpacity, maskMode);
        deps.pointerState.lastDocX = coords.x;
        deps.pointerState.lastDocY = coords.y;
        if (customPaintTarget.historyMode === "document") {
          markDocumentOperationChanged();
        }
        deps.scheduleCanvasRender();
        return;
      }
      if (!layer) {
        return;
      }
      // Quick mask painting path
      const qmCanvas = deps.getQuickMaskCanvas();
      if (qmCanvas) {
        const brush = deps.getBrushState();
        const maskMode = deps.getActiveTool() === "brush" ? "reveal" : "hide";
        drawMaskStroke(qmCanvas, deps.pointerState.lastDocX, deps.pointerState.lastDocY, coords.x, coords.y, brush.brushSize, brush.brushOpacity, maskMode);
        deps.pointerState.lastDocX = coords.x;
        deps.pointerState.lastDocY = coords.y;
        markDocumentOperationChanged();
        deps.scheduleCanvasRender();
        return;
      }
      // Mask painting path
      const maskTarget = deps.getMaskEditTarget();
      if (maskTarget && layer.id === maskTarget && layer.mask) {
        const brush = deps.getBrushState();
        const maskMode = deps.getActiveTool() === "brush" ? "reveal" : "hide";
        drawMaskStroke(layer.mask, deps.pointerState.lastDocX, deps.pointerState.lastDocY, coords.x, coords.y, brush.brushSize, brush.brushOpacity, maskMode);
        deps.pointerState.lastDocX = coords.x;
        deps.pointerState.lastDocY = coords.y;
        markDocumentOperationChanged();
        deps.scheduleCanvasRender();
        return;
      }
      // Normal raster painting (smart objects blocked at pointer-down)
      if (layer.type === "raster") {
        if (deps.getActiveTool() === "clone-stamp") {
          const brush = deps.getBrushState();
          cloneStampStroke(layer, coords.x, coords.y, deps.pointerState.cloneOffsetX, deps.pointerState.cloneOffsetY, brush.brushSize, brush.brushOpacity, doc.selectionRect, doc.selectionInverted, doc.selectionShape);
        } else if (deps.getActiveTool() === "smudge") {
          const brush = deps.getBrushState();
          smudgeStroke(layer, deps.pointerState.lastDocX, deps.pointerState.lastDocY, coords.x, coords.y, brush.brushSize, brush.brushOpacity, doc.selectionRect, doc.selectionInverted, doc.selectionShape);
        } else if (deps.getActiveTool() === "healing-brush") {
          const brush = deps.getBrushState();
          healingSession ??= createHealingStrokeSession();
          healingStroke(layer, {
            x: coords.x,
            y: coords.y,
            brushSize: brush.brushSize,
            strength: brush.brushOpacity,
            sampleSpread: brush.healingSampleSpread,
            blend: brush.healingBlend,
            selectionRect: doc.selectionRect,
            selectionInverted: doc.selectionInverted,
            selectionShape: doc.selectionShape,
            selectionPath: doc.selectionPath,
            selectionMask: doc.selectionMask,
          }, healingSession);
        } else {
          const brush = deps.getBrushState();
          drawStroke(layer, deps.pointerState.lastDocX, deps.pointerState.lastDocY, coords.x, coords.y, deps.getActiveTool() === "eraser" ? "eraser" : "brush", brush.brushSize, brush.brushOpacity, brush.activeColour, doc.selectionRect, doc.selectionInverted, doc.selectionShape, doc.selectionPath, doc.selectionMask);
        }
        deps.pointerState.lastDocX = coords.x;
        deps.pointerState.lastDocY = coords.y;
        markDocumentOperationChanged();
        deps.scheduleCanvasRender();
      }
      return;
    }

    if (deps.pointerState.mode === "crop") {
      doc.cropRect = buildCropRect(deps.pointerState.startDocX, deps.pointerState.startDocY, coords.x, coords.y, doc);
      deps.scheduleCanvasRender();
      return;
    }

    if (deps.pointerState.mode === "marquee") {
      const cx = deps.pointerState.startDocX;
      const cy = deps.pointerState.startDocY;
      const mods = deps.getMarqueeModifiers();

      if (mods.rotate) {
        // Rotate mode keeps the drag origin at the center so the cursor can orbit
        // around the marquee while preserving its size.
        const dist = Math.hypot(coords.x - cx, coords.y - cy);
        const x0 = Math.max(0, cx - dist);
        const y0 = Math.max(0, cy - dist);
        const x1 = Math.min(doc.width, cx + dist);
        const y1 = Math.min(doc.height, cy + dist);
        doc.selectionRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      } else {
        doc.selectionRect = buildCornerMarqueeRect(cx, cy, coords.x, coords.y, doc, mods.perfect);
      }

      deps.pointerState.lastDocX = coords.x;
      deps.pointerState.lastDocY = coords.y;
      deps.scheduleCanvasRender();
    }

    if (deps.pointerState.mode === "lasso" && doc.selectionPath && !doc.selectionPath.closed) {
      deps.onLassoPoint(coords.x, coords.y);
      deps.scheduleCanvasRender();
    }
  }

  function handlePointerUp() {
    const doc = deps.getActiveDocument();
    const hadActiveMode = deps.pointerState.mode !== "none";
    if (doc && deps.pointerState.mode === "pivot-drag") {
      deps.log("Pivot repositioned", "INFO");
    } else if (doc && deps.pointerState.mode === "move-layer") {
      if (toolOwnsTransformDraft(deps.getActiveTool(), deps.getTransformDraft())) {
        deps.log("Transform gesture updated", "INFO");
      } else {
        const entry = "Moved active layer";
        commitDocumentOperation(doc, entry);
        deps.log("Move gesture committed", "INFO");
      }
    } else if (doc && deps.pointerState.mode === "paint") {
      const layer = deps.getActiveLayer(doc);
      const customPaintTarget = deps.getCustomPaintTarget();
      const qmCanvas = deps.getQuickMaskCanvas();
      const maskTarget = deps.getMaskEditTarget();
      const isCustomPaint = !!customPaintTarget;
      const isMaskPaint = maskTarget && layer && layer.id === maskTarget && layer.mask;
      const isQuickMaskPaint = !!qmCanvas;
      if (layer && !isCustomPaint && !isMaskPaint && !isQuickMaskPaint) {
        syncLayerSource(layer);
      }
      const paintLabel = isCustomPaint
        ? customPaintTarget.paintLabel
        : isQuickMaskPaint
        ? "Painted quick mask"
        : isMaskPaint
          ? "Painted mask"
          : deps.getActiveTool() === "clone-stamp"
            ? "Cloned pixels"
            : deps.getActiveTool() === "smudge"
              ? "Smudged pixels"
              : deps.getActiveTool() === "healing-brush"
                ? "Healed pixels"
                : deps.getActiveTool() === "brush"
                  ? "Painted stroke"
                  : "Erased pixels";
      if (isCustomPaint) {
        cancelDocumentOperation();
      } else {
        commitDocumentOperation(doc, paintLabel);
      }
      deps.log(`${isCustomPaint ? customPaintTarget.logLabel : isQuickMaskPaint ? "Quick mask paint" : isMaskPaint ? "Mask paint" : deps.getActiveTool()} stroke committed`, "INFO");
    } else if (doc && deps.pointerState.mode === "create-layer") {
      const created = doc.layers.find((item) => item.id === deps.pointerState.creationLayerId);
      if (created) {
        const draggedFarEnough = Math.abs(deps.pointerState.lastDocX - deps.pointerState.startDocX) > 8 || Math.abs(deps.pointerState.lastDocY - deps.pointerState.startDocY) > 8;
        if (created.type === "text" && !draggedFarEnough) {
          created.x = Math.round(deps.pointerState.startDocX);
          created.y = Math.round(deps.pointerState.startDocY);
          created.textData.boxWidth = null;
          created.textData.boxHeight = null;
          refreshLayerCanvas(created);
        }
        if (created.type === "shape" && !draggedFarEnough && created.shapeData.kind !== "line") {
          created.shapeData.width = Math.max(created.shapeData.width, 140);
          created.shapeData.height = Math.max(created.shapeData.height, 100);
          refreshLayerCanvas(created);
        }
        commitDocumentOperation(doc, created.type === "text" ? "Created text layer" : "Created shape layer");
        deps.onLayerCreationCommitted?.(created);
        deps.log(`${created.type} creation committed`, "INFO");
      } else {
        cancelDocumentOperation();
      }
    } else if (doc && deps.pointerState.mode === "crop") {
      if (!doc.cropRect || doc.cropRect.width < 2 || doc.cropRect.height < 2) {
        doc.cropRect = null;
        deps.log("Crop gesture cancelled because selection was too small", "WARN");
      } else {
        doc.undoStack.push(snapshotDocument(doc));
        doc.redoStack = [];
        const nextCrop = { ...doc.cropRect };
        applyCropToDocument(doc, nextCrop);
        doc.dirty = true;
        pushHistory(doc, `Cropped canvas to ${Math.round(nextCrop.width)}×${Math.round(nextCrop.height)}`);
        deps.log(`Crop applied ${nextCrop.width}x${nextCrop.height}`, "INFO");
      }
      cancelDocumentOperation();
    } else if (doc && deps.pointerState.mode === "lasso") {
      deps.onLassoComplete();
      cancelDocumentOperation();
    } else if (doc && deps.pointerState.mode === "marquee") {
      const sessionTarget = deps.getSelectionMaskTarget();
      if (!doc.selectionRect || doc.selectionRect.width < 2 || doc.selectionRect.height < 2) {
        if (sessionTarget) {
          // During AI mask session, ignore tiny/click marquees — don't clear the session mask
          doc.selectionRect = null;
        } else {
          const mode = deps.getSelectionMode();
          if (mode === "replace") {
            // Click without drag in replace mode clears the selection
            const hadSelection = !!(doc.selectionRect || doc.selectionMask);
            if (hadSelection) {
              doc.undoStack.push(snapshotDocument(doc));
              doc.redoStack = [];
            }
            doc.selectionRect = null;
            doc.selectionMask = null;
            doc.selectionPath = null;
            doc.selectionInverted = false;
            deps.log("Selection cleared (click)", "INFO");
            if (hadSelection) {
              pushHistory(doc, "Deselected");
            }
          } else if (doc.selectionMask) {
            // Non-replace mode: restore bounding rect, ignore the tiny marquee
            doc.selectionRect = maskBoundingRect(doc.selectionMask);
          } else {
            doc.selectionRect = null;
            doc.selectionPath = null;
          }
        }
      } else {
        const mode = deps.getSelectionMode();
        const newRect = doc.selectionRect;
        const sides = deps.getMarqueeShape();
        const mods = deps.getMarqueeModifiers();
        const axisAlignedRect = isAxisAlignedRectMarquee(sides) && !mods.rotate;

        // Compute rotation: default orientation per polygon; Ctrl+Shift rotates toward cursor
        let rotation = defaultPolygonRotation(sides);
        if (mods.rotate && sides <= 10) {
          const dx = deps.pointerState.lastDocX - deps.pointerState.startDocX;
          const dy = deps.pointerState.lastDocY - deps.pointerState.startDocY;
          rotation = Math.atan2(dy, dx);
        }

        // Rasterize the new marquee shape into a temp mask
        const tmpMask = createMaskCanvas(doc.width, doc.height);
        rasterizeRectToMask(tmpMask, newRect, sides, rotation, mods.perfect, axisAlignedRect);

        if (sessionTarget) {
          // Write to AI mask session canvas instead of doc.selectionMask
          if (mode === "replace") {
            const ctx = sessionTarget.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, sessionTarget.width, sessionTarget.height);
              ctx.drawImage(tmpMask, 0, 0);
            }
          } else {
            combineMasks(sessionTarget, tmpMask, mode);
          }
          deps.log("Marquee applied to AI mask session", "INFO");
          // Reset the selection rect visual but don't touch doc.selectionMask
          doc.selectionRect = null;
          deps.renderCanvas();
        } else {
          // Snapshot before mutating selection state
          doc.undoStack.push(snapshotDocument(doc));
          doc.redoStack = [];

          if (mode === "replace" || !doc.selectionMask) {
            doc.selectionMask = tmpMask;
          } else {
            combineMasks(doc.selectionMask, tmpMask, mode);
          }

          // Keep the dragged marquee bounds when they still contain selected pixels so
          // the committed selection does not visually jump away from the marquee the
          // user just drew. Fall back to mask bounds for compound operations that move
          // or shrink the actual selected area outside the live drag rect.
          const maskBounds = maskBoundingRect(doc.selectionMask);
          const committedRect = mode === "replace" && maskContainsRect(doc.selectionMask, newRect)
            ? newRect
            : maskBounds;
          doc.selectionRect = committedRect;
          doc.selectionInverted = false;
          doc.selectionPath = null;
          doc.selectionShape = sides > 10 ? "ellipse" : "rect";

          if (committedRect) {
            deps.log(`Selection committed ${committedRect.width}x${committedRect.height}`, "INFO");
          } else {
            doc.selectionMask = null;
            deps.log("Selection cleared after marquee operation", "INFO");
          }

          const historyLabel = mode === "replace" ? "Marquee selection" : `Marquee selection (${mode})`;
          pushHistory(doc, historyLabel);
        }
      }
      cancelDocumentOperation();
    } else {
      cancelDocumentOperation();
    }
    deps.pointerState.mode = "none";
    deps.pointerState.transformHandle = null;
    deps.pointerState.creationLayerId = null;
    clearHealingSession();
    deps.canvasWrap.classList.remove("is-dragging", "is-panning");
    if (hadActiveMode) deps.renderEditorState();
  }

  return { handlePointerDown, handlePointerMove, handlePointerUp };
}
