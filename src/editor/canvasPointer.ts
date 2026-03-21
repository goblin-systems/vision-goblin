import { beginDocumentOperation, cancelDocumentOperation, commitDocumentOperation, markDocumentOperationChanged } from "./history";
import { buildCropRect, getDocCoordinates } from "./geometry";
import type { DocumentState, PointerState, RasterLayer, Rect, TransformHandle } from "./types";
import { applyCropToDocument, snapshotDocument, createLayerCanvas, compositeDocumentOnto, getLayerContext, syncLayerSource } from "./documents";
import { clamp } from "./utils";

type TransformMode = "scale" | "rotate";

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

function applySelectionMode(current: Rect | null, next: Rect | null, mode: "replace" | "add" | "subtract" | "intersect") {
  if (!next) return current;
  if (mode === "replace" || !current) return next;
  if (mode === "add") return unionRects(current, next);
  if (mode === "intersect") return intersectRects(current, next);
  return subtractRect(current, next);
}

function getTransformHandle(layer: RasterLayer, x: number, y: number, mode: TransformMode): TransformHandle | null {
  const right = layer.x + layer.canvas.width;
  const bottom = layer.y + layer.canvas.height;
  const centerX = layer.x + layer.canvas.width / 2;
  const centerY = layer.y + layer.canvas.height / 2;
  const handles: Array<[TransformHandle, number, number]> = mode === "rotate"
    ? [["nw", layer.x, layer.y], ["ne", right, layer.y], ["sw", layer.x, bottom], ["se", right, bottom]]
    : [["nw", layer.x, layer.y], ["ne", right, layer.y], ["sw", layer.x, bottom], ["se", right, bottom], ["n", centerX, layer.y], ["e", right, centerY], ["s", centerX, bottom], ["w", layer.x, centerY]];
  return handles.find(([, cx, cy]) => Math.abs(x - cx) <= 12 && Math.abs(y - cy) <= 12)?.[0] ?? null;
}

function applyTransformedCanvas(
  layer: RasterLayer,
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
  }
  layer.canvas = nextCanvas;
  layer.x = Math.round(anchorWorldX + minX);
  layer.y = Math.round(anchorWorldY + minY);
}

function resizeLayerFromHandle(
  layer: RasterLayer,
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
  selectionInverted = false
) {
  const ctx = getLayerContext(layer);
  ctx.save();
  if (selectionRect) {
    if (selectionInverted) {
      ctx.beginPath();
      ctx.rect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.rect(selectionRect.x - layer.x, selectionRect.y - layer.y, selectionRect.width, selectionRect.height);
      ctx.clip("evenodd");
    } else {
      ctx.beginPath();
      ctx.rect(selectionRect.x - layer.x, selectionRect.y - layer.y, selectionRect.width, selectionRect.height);
      ctx.clip();
    }
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = brushSize;
  ctx.globalAlpha = brushOpacity;
  ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = activeColour;
  ctx.beginPath();
  ctx.moveTo(fromX - layer.x, fromY - layer.y);
  ctx.lineTo(toX - layer.x, toY - layer.y);
  ctx.stroke();
  ctx.restore();
}

export function pickColourAt(doc: DocumentState, docX: number, docY: number): string | null {
  const composite = createLayerCanvas(doc.width, doc.height);
  const ctx = composite.getContext("2d");
  if (!ctx) return null;
  compositeDocumentOnto(ctx, doc, 0, 0, 1);
  const pixel = ctx.getImageData(clamp(Math.round(docX), 0, doc.width - 1), clamp(Math.round(docY), 0, doc.height - 1), 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

interface CanvasPointerDeps {
  editorCanvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => RasterLayer | null;
  getActiveTool: () => string;
  getSelectionMode: () => "replace" | "add" | "subtract" | "intersect";
  getTransformMode: () => TransformMode;
  ensureTransformDraft: (doc: DocumentState, layer: RasterLayer) => { scaleX: number; scaleY: number; rotateDeg: number; skewXDeg: number; skewYDeg: number; centerX: number; centerY: number; pivotX: number; pivotY: number; sourceCanvas: HTMLCanvasElement } | null;
  getTransformDraft: () => { scaleX: number; scaleY: number; rotateDeg: number; skewXDeg: number; skewYDeg: number; centerX: number; centerY: number; pivotX: number; pivotY: number; sourceCanvas: HTMLCanvasElement } | null;
  syncTransformInputs: () => void;
  getBrushState: () => { brushSize: number; brushOpacity: number; activeColour: string };
  getSpacePressed: () => boolean;
  snapLayerPosition: (layer: RasterLayer, x: number, y: number) => { x: number; y: number };
  pointerState: PointerState;
  renderCanvas: () => void;
  renderEditorState: () => void;
  onColourPicked: (colour: string) => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export function createCanvasPointerController(deps: CanvasPointerDeps) {
  function handlePointerDown(event: PointerEvent) {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = deps.getActiveLayer(doc);
    const { x, y } = getDocCoordinates(event.clientX, event.clientY, doc, deps.editorCanvas.getBoundingClientRect());
    deps.pointerState.lastDocX = x;
    deps.pointerState.lastDocY = y;
    deps.pointerState.startDocX = x;
    deps.pointerState.startDocY = y;
    deps.pointerState.startClientX = event.clientX;
    deps.pointerState.startClientY = event.clientY;
    deps.pointerState.startPanX = doc.panX;
    deps.pointerState.startPanY = doc.panY;
    deps.pointerState.startLayerX = layer?.x ?? 0;
    deps.pointerState.startLayerY = layer?.y ?? 0;
    deps.pointerState.startSelectionRect = doc.selectionRect ? { ...doc.selectionRect } : null;
    deps.pointerState.startSelectionInverted = doc.selectionInverted;

    if (event.button === 2 || event.button === 1 || deps.getSpacePressed()) {
      deps.pointerState.mode = "pan";
      deps.canvasWrap.classList.add("is-panning");
      deps.log("Canvas pan started", "INFO");
      return;
    }

    if (deps.getActiveTool() === "marquee") {
      deps.pointerState.mode = "marquee";
      doc.selectionRect = buildCropRect(x, y, x, y, doc);
      deps.log(`Selection started at ${Math.round(x)},${Math.round(y)}`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (!layer || layer.locked) {
      if (deps.getActiveTool() === "crop") {
        deps.pointerState.mode = "crop";
        doc.cropRect = buildCropRect(x, y, x, y, doc);
        deps.log(`Crop gesture started at ${Math.round(x)},${Math.round(y)}`, "INFO");
        deps.renderEditorState();
      }
      return;
    }

    if (deps.getActiveTool() === "crop") {
      deps.pointerState.mode = "crop";
      doc.cropRect = buildCropRect(x, y, x, y, doc);
      deps.log(`Crop gesture started at ${Math.round(x)},${Math.round(y)}`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (deps.getActiveTool() === "move") {
      beginDocumentOperation(snapshotDocument(doc));
      deps.pointerState.mode = "move-layer";
      deps.canvasWrap.classList.add("is-dragging");
      deps.log(`Move gesture started on layer '${layer.name}'`, "INFO");
      return;
    }

    if (deps.getActiveTool() === "transform") {
      const draft = deps.ensureTransformDraft(doc, layer);
      if (!draft) {
        return;
      }
      const handle = getTransformHandle(layer, x, y, deps.getTransformMode());
      if (!handle) {
        if (Math.abs(x - draft.pivotX) <= 12 && Math.abs(y - draft.pivotY) <= 12) {
          deps.pointerState.mode = "pivot-drag";
          deps.canvasWrap.classList.add("is-dragging");
          deps.log("Pivot drag started", "INFO");
        }
        return;
      }
      deps.pointerState.mode = "move-layer";
      deps.pointerState.transformHandle = handle;
      deps.pointerState.startLayerX = layer.x;
      deps.pointerState.startLayerY = layer.y;
      deps.pointerState.startLayerWidth = layer.canvas.width;
      deps.pointerState.startLayerHeight = layer.canvas.height;
      deps.pointerState.startScaleX = draft.scaleX;
      deps.pointerState.startScaleY = draft.scaleY;
      deps.pointerState.startRotateDeg = draft.rotateDeg;
      deps.pointerState.startSkewXDeg = draft.skewXDeg;
      deps.pointerState.startSkewYDeg = draft.skewYDeg;
      deps.canvasWrap.classList.add("is-dragging");
      deps.log(`Transform started on layer '${layer.name}'`, "INFO");
      return;
    }

    if (deps.getActiveTool() === "brush" || deps.getActiveTool() === "eraser") {
      beginDocumentOperation(snapshotDocument(doc));
      deps.pointerState.mode = "paint";
      const brush = deps.getBrushState();
       drawStroke(layer, x, y, x, y, deps.getActiveTool() === "brush" ? "brush" : "eraser", brush.brushSize, brush.brushOpacity, brush.activeColour, doc.selectionRect, doc.selectionInverted);
      markDocumentOperationChanged();
      deps.log(`${deps.getActiveTool()} stroke started on layer '${layer.name}'`, "INFO");
      deps.renderEditorState();
      return;
    }

    if (deps.getActiveTool() === "eyedropper") {
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
      deps.renderEditorState();
      return;
    }

    if (deps.pointerState.mode === "pivot-drag") {
      const draft = deps.getTransformDraft();
      if (draft) {
        draft.pivotX = coords.x;
        draft.pivotY = coords.y;
        deps.renderEditorState();
      }
      return;
    }

    if (deps.pointerState.mode === "move-layer" && layer) {
      if (deps.getActiveTool() === "transform" && deps.pointerState.transformHandle) {
        const draft = deps.getTransformDraft();
        if (!draft) {
          return;
        }
        if (deps.getTransformMode() === "rotate") {
          rotateDraft(
            draft,
            coords.x,
            coords.y,
            deps.pointerState.startLayerX,
            deps.pointerState.startLayerY,
            deps.pointerState.startRotateDeg,
            event.shiftKey
          );
        } else if (["n", "e", "s", "w"].includes(deps.pointerState.transformHandle)) {
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
        }
        deps.syncTransformInputs();
        deps.renderEditorState();
        return;
      }
      const rawX = Math.round(deps.pointerState.startLayerX + (event.clientX - deps.pointerState.startClientX) / coords.bounds.scale);
      const rawY = Math.round(deps.pointerState.startLayerY + (event.clientY - deps.pointerState.startClientY) / coords.bounds.scale);
      const snapped = deps.snapLayerPosition(layer, rawX, rawY);
      layer.x = snapped.x;
      layer.y = snapped.y;
      markDocumentOperationChanged();
      doc.dirty = true;
      deps.renderEditorState();
      return;
    }

    if (deps.pointerState.mode === "paint" && layer) {
      const brush = deps.getBrushState();
      drawStroke(layer, deps.pointerState.lastDocX, deps.pointerState.lastDocY, coords.x, coords.y, deps.getActiveTool() === "eraser" ? "eraser" : "brush", brush.brushSize, brush.brushOpacity, brush.activeColour, doc.selectionRect, doc.selectionInverted);
      deps.pointerState.lastDocX = coords.x;
      deps.pointerState.lastDocY = coords.y;
      markDocumentOperationChanged();
      deps.renderCanvas();
      return;
    }

    if (deps.pointerState.mode === "crop") {
      doc.cropRect = buildCropRect(deps.pointerState.startDocX, deps.pointerState.startDocY, coords.x, coords.y, doc);
      deps.renderEditorState();
      return;
    }

    if (deps.pointerState.mode === "marquee") {
      doc.selectionRect = buildCropRect(deps.pointerState.startDocX, deps.pointerState.startDocY, coords.x, coords.y, doc);
      deps.renderEditorState();
    }
  }

  function handlePointerUp() {
    const doc = deps.getActiveDocument();
    const hadActiveMode = deps.pointerState.mode !== "none";
    if (doc && deps.pointerState.mode === "pivot-drag") {
      deps.log("Pivot repositioned", "INFO");
    } else if (doc && deps.pointerState.mode === "move-layer") {
      if (deps.getActiveTool() === "transform") {
        deps.log("Transform gesture updated", "INFO");
      } else {
        const entry = "Moved active layer";
        commitDocumentOperation(doc, entry);
        deps.log("Move gesture committed", "INFO");
      }
    } else if (doc && deps.pointerState.mode === "paint") {
      const layer = deps.getActiveLayer(doc);
      if (layer) {
        syncLayerSource(layer);
      }
      commitDocumentOperation(doc, deps.getActiveTool() === "brush" ? "Painted stroke" : "Erased pixels");
      deps.log(`${deps.getActiveTool()} stroke committed`, "INFO");
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
        deps.log(`Crop applied ${nextCrop.width}x${nextCrop.height}`, "INFO");
      }
      cancelDocumentOperation();
    } else if (doc && deps.pointerState.mode === "marquee") {
      if (!doc.selectionRect || doc.selectionRect.width < 2 || doc.selectionRect.height < 2) {
        doc.selectionRect = null;
        deps.log("Selection cleared because marquee was too small", "WARN");
      } else {
        const nextSelection = applySelectionMode(
          deps.pointerState.startSelectionInverted ? null : deps.pointerState.startSelectionRect,
          doc.selectionRect,
          deps.getSelectionMode()
        );
        doc.selectionRect = nextSelection;
        doc.selectionInverted = false;
        if (nextSelection) {
          deps.log(`Selection committed ${nextSelection.width}x${nextSelection.height}`, "INFO");
        } else {
          deps.log("Selection cleared after marquee operation", "INFO");
        }
      }
      cancelDocumentOperation();
    } else {
      cancelDocumentOperation();
    }
    deps.pointerState.mode = "none";
    deps.pointerState.transformHandle = null;
    deps.canvasWrap.classList.remove("is-dragging", "is-panning");
    if (hadActiveMode) deps.renderEditorState();
  }

  return { handlePointerDown, handlePointerMove, handlePointerUp };
}
