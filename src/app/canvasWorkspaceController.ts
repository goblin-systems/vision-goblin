import { getCanvasBounds } from "../editor/geometry";
import { pushHistory } from "../editor/history";
import { defaultPolygonRotation, isAxisAlignedRectMarquee } from "../editor/selection";
import { renderCanvas as renderCanvasView } from "../editor/render";
import { buildTransformPreview } from "../editor/documents";
import { formatLargeImageMetrics, getLargeImagePolicy, getRenderDegradationPolicy } from "../editor/largeImagePolicy";
import type { BrushState, DocumentState, Guide, Layer, PointerState } from "../editor/types";
import type { VisionSettings } from "../settings";
import type { SelectionMode } from "../editor/selection";
import type { TransformDraft } from "../editor/types";
import { clamp, nextId } from "../editor/utils";
import { isBrushCursorTool } from "./editorInteractionController";

const RULER_SIZE = 20;
export const SNAP_THRESHOLD = 6;

type SnapLine = { orientation: "horizontal" | "vertical"; position: number };
type CanvasBounds = { originX: number; originY: number; scale: number };

export interface SnapPositionParams {
  doc: DocumentState | null;
  layer: Layer;
  rawX: number;
  rawY: number;
  snapEnabled: boolean;
  showGrid: boolean;
  gridSize: number;
}

export function snapLayerPositionForDocument(params: SnapPositionParams): { x: number; y: number; lines: SnapLine[] } {
  const { doc, layer, rawX, rawY, snapEnabled, showGrid, gridSize } = params;
  if (!doc || !snapEnabled) {
    return { x: rawX, y: rawY, lines: [] };
  }

  const layerW = layer.canvas.width;
  const layerH = layer.canvas.height;
  const snapTargetsX: number[] = [0, doc.width];
  const snapTargetsY: number[] = [0, doc.height];
  for (const guide of doc.guides) {
    if (guide.orientation === "vertical") snapTargetsX.push(guide.position);
    else snapTargetsY.push(guide.position);
  }
  if (showGrid && gridSize > 0) {
    const edgesX = [rawX, rawX + layerW / 2, rawX + layerW];
    const edgesY = [rawY, rawY + layerH / 2, rawY + layerH];
    for (const edge of edgesX) {
      const nearest = Math.round(edge / gridSize) * gridSize;
      snapTargetsX.push(nearest);
      if (nearest - gridSize >= 0) snapTargetsX.push(nearest - gridSize);
      if (nearest + gridSize <= doc.width) snapTargetsX.push(nearest + gridSize);
    }
    for (const edge of edgesY) {
      const nearest = Math.round(edge / gridSize) * gridSize;
      snapTargetsY.push(nearest);
      if (nearest - gridSize >= 0) snapTargetsY.push(nearest - gridSize);
      if (nearest + gridSize <= doc.height) snapTargetsY.push(nearest + gridSize);
    }
  }

  let bestX = rawX;
  let bestDx = Infinity;
  const lines: SnapLine[] = [];
  const edgesX = [rawX, rawX + layerW / 2, rawX + layerW];
  for (const target of snapTargetsX) {
    for (const edge of edgesX) {
      const distance = Math.abs(edge - target);
      if (distance < SNAP_THRESHOLD && distance < bestDx) {
        bestDx = distance;
        bestX = rawX + (target - edge);
      }
    }
  }
  if (bestDx < SNAP_THRESHOLD) {
    for (const target of snapTargetsX) {
      for (const edge of [bestX, bestX + layerW / 2, bestX + layerW]) {
        if (Math.abs(edge - target) < 1) {
          lines.push({ orientation: "vertical", position: target });
        }
      }
    }
  }

  let bestY = rawY;
  let bestDy = Infinity;
  const edgesY = [rawY, rawY + layerH / 2, rawY + layerH];
  for (const target of snapTargetsY) {
    for (const edge of edgesY) {
      const distance = Math.abs(edge - target);
      if (distance < SNAP_THRESHOLD && distance < bestDy) {
        bestDy = distance;
        bestY = rawY + (target - edge);
      }
    }
  }
  if (bestDy < SNAP_THRESHOLD) {
    for (const target of snapTargetsY) {
      for (const edge of [bestY, bestY + layerH / 2, bestY + layerH]) {
        if (Math.abs(edge - target) < 1) {
          lines.push({ orientation: "horizontal", position: target });
        }
      }
    }
  }

  return { x: bestX, y: bestY, lines };
}

export function findGuideAtPosition(doc: DocumentState, docX: number, docY: number, bounds: CanvasBounds): Guide | null {
  const threshold = 6 / bounds.scale;
  for (const guide of doc.guides) {
    if (guide.orientation === "horizontal" && Math.abs(docY - guide.position) < threshold) return guide;
    if (guide.orientation === "vertical" && Math.abs(docX - guide.position) < threshold) return guide;
  }
  return null;
}

function isGuideOutsideDocument(doc: DocumentState, guide: Guide) {
  return guide.position < 0
    || (guide.orientation === "horizontal" && guide.position > doc.height)
    || (guide.orientation === "vertical" && guide.position > doc.width);
}

interface CanvasPointerBindings {
  handlePointerDown: (event: PointerEvent) => void;
  handlePointerMove: (event: PointerEvent) => void;
  handlePointerUp: () => void;
}

export interface CanvasWorkspaceControllerDeps {
  canvasWrap: HTMLElement;
  editorCanvas: HTMLCanvasElement;
  getEditorContext: () => CanvasRenderingContext2D;
  getSettings: () => VisionSettings;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getBrushState: () => BrushState;
  adjustBrushSize: (delta: number) => number;
  getPointerState: () => PointerState;
  getTransformDraft: () => TransformDraft | null;
  getEffectiveMarqueeMode: () => SelectionMode;
  getMarqueeSides: () => number;
  getMarqueeModifiers: () => { rotate: boolean; perfect: boolean };
  getQuickMaskOverlay: () => { canvas: HTMLCanvasElement; color: string } | null;
  getMaskOverlays?: () => Array<{
    canvas: HTMLCanvasElement;
    color: string;
    outlineColor: string;
    active: boolean;
  }>;
  renderShellState: () => void;
  renderEditorState: () => void;
  updateMarqueeModeFromModifiers: (ctrlKey: boolean, shiftKey: boolean, altKey: boolean) => void;
  captureSelectionMode: () => void;
  canvasPointer: CanvasPointerBindings;
  resetView: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  getHiddenLayerId?: () => string | null;
  onAfterCanvasRender?: () => void;
}

export interface CanvasWorkspaceController {
  renderCanvas: () => void;
  scheduleCanvasRender: () => void;
  bindZoomControls: () => void;
  bindCanvasInteractions: () => void;
  snapLayerPosition: (layer: Layer, rawX: number, rawY: number) => { x: number; y: number };
  getCanvasBoundsForDoc: (doc: DocumentState) => CanvasBounds;
}

export function createCanvasWorkspaceController(deps: CanvasWorkspaceControllerDeps): CanvasWorkspaceController {
  let activeSnapLines: SnapLine[] = [];
  let draggingGuideId: string | null = null;
  let scheduledCanvasRender = 0;
  let lastRenderDiagnosticSignature = "";
  let paintCursorPosition: { clientX: number; clientY: number } | null = null;
  const paintCursor = document.createElement("div");
  paintCursor.className = "paint-cursor-ring";
  paintCursor.setAttribute("aria-hidden", "true");
  paintCursor.hidden = true;

  const requestRenderFrame = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16);

  function getCanvasBoundsForDoc(doc: DocumentState) {
    return getCanvasBounds(doc, deps.editorCanvas.getBoundingClientRect());
  }

  function snapLayerPosition(layer: Layer, rawX: number, rawY: number) {
    const settings = deps.getSettings();
    const result = snapLayerPositionForDocument({
      doc: deps.getActiveDocument(),
      layer,
      rawX,
      rawY,
      snapEnabled: settings.snapEnabled,
      showGrid: settings.showGrid,
      gridSize: settings.gridSize,
    });
    activeSnapLines = result.lines;
    return { x: result.x, y: result.y };
  }

  function hidePaintCursor() {
    paintCursor.hidden = true;
    if (deps.editorCanvas.style.cursor === "none") {
      deps.editorCanvas.style.cursor = "";
    }
  }

  function syncPaintCursor() {
    const doc = deps.getActiveDocument();
    const activeTool = deps.getSettings().activeTool;
    if (!doc || !paintCursorPosition || !isBrushCursorTool(activeTool)) {
      hidePaintCursor();
      return;
    }

    const rect = deps.editorCanvas.getBoundingClientRect();
    if (
      paintCursorPosition.clientX < rect.left
      || paintCursorPosition.clientX > rect.right
      || paintCursorPosition.clientY < rect.top
      || paintCursorPosition.clientY > rect.bottom
    ) {
      hidePaintCursor();
      return;
    }

    const bounds = getCanvasBoundsForDoc(doc);
    const diameter = Math.max(1, Math.round(deps.getBrushState().brushSize * bounds.scale));
    paintCursor.style.left = `${Math.round(paintCursorPosition.clientX - rect.left)}px`;
    paintCursor.style.top = `${Math.round(paintCursorPosition.clientY - rect.top)}px`;
    paintCursor.style.width = `${diameter}px`;
    paintCursor.style.height = `${diameter}px`;
    paintCursor.hidden = false;
    deps.editorCanvas.style.cursor = "none";
  }

  function updatePaintCursorPosition(clientX: number, clientY: number) {
    paintCursorPosition = { clientX, clientY };
    syncPaintCursor();
  }

  function renderCanvas() {
    const doc = deps.getActiveDocument();
    const activeTransformDraft = deps.getTransformDraft();
    const pointerState = deps.getPointerState();
    const interactiveRender = pointerState.mode !== "none" || !!activeTransformDraft;
    const previewLayer = doc && activeTransformDraft ? doc.layers.find((item) => item.id === activeTransformDraft.layerId) : null;
    const transformFrame = activeTransformDraft?.frameBounds ?? null;
    const transformPreview = activeTransformDraft && previewLayer?.visible
      ? {
        layerId: activeTransformDraft.layerId,
        layerIds: activeTransformDraft.previewLayerIds,
        ...buildTransformPreview(activeTransformDraft),
      }
      : null;
    const largeImagePolicy = doc ? getLargeImagePolicy(doc) : null;
    const degradedRendering = doc ? getRenderDegradationPolicy(doc, interactiveRender) : null;

    if (!doc || !largeImagePolicy || !degradedRendering) {
      lastRenderDiagnosticSignature = "";
    } else {
      const signature = [doc.id, interactiveRender, degradedRendering.active, degradedRendering.skipAdjustmentLayers, degradedRendering.skipSelectionOverlays].join(":");
      if (signature !== lastRenderDiagnosticSignature) {
        lastRenderDiagnosticSignature = signature;
        if (degradedRendering.active) {
          deps.log(
            `Large image degraded interactive render for '${doc.name}' (${formatLargeImageMetrics(largeImagePolicy)}): ${degradedRendering.reasons.join(", ")}`,
            "WARN"
          );
        }
      }
    }

    renderCanvasView({
      editorCanvas: deps.editorCanvas,
      getEditorContext: deps.getEditorContext,
      doc,
      activeTool: deps.getSettings().activeTool,
      activeLayer: doc ? deps.getActiveLayer(doc) : null,
      skipLayerId: deps.getHiddenLayerId?.() ?? null,
      marqueePreview: pointerState.mode === "marquee"
        ? (() => {
            const previewRect = doc?.selectionRect ?? null;
            const modifiers = deps.getMarqueeModifiers();
            const marqueeSides = deps.getMarqueeSides();
            let rotation = defaultPolygonRotation(marqueeSides);
            if (modifiers.rotate && marqueeSides <= 10) {
              rotation = Math.atan2(pointerState.lastDocY - pointerState.startDocY, pointerState.lastDocX - pointerState.startDocX);
            }
            return {
              baseRect: pointerState.startSelectionRect,
              previewRect,
              mode: deps.getEffectiveMarqueeMode(),
              sides: marqueeSides,
              rotation,
              perfect: modifiers.perfect,
              axisAlignedRect: isAxisAlignedRectMarquee(marqueeSides) && !modifiers.rotate,
            };
          })()
        : null,
      transformPreview,
      transformFrame,
      transformIntent: activeTransformDraft?.intent ?? null,
      pivotPoint: activeTransformDraft ? { x: activeTransformDraft.pivotX, y: activeTransformDraft.pivotY } : null,
      guides: doc?.guides ?? [],
      snapLines: activeSnapLines,
      showRulers: deps.getSettings().snapEnabled,
      showGrid: deps.getSettings().showGrid,
      gridSize: deps.getSettings().gridSize,
      quickMaskOverlay: deps.getQuickMaskOverlay(),
      maskOverlays: deps.getMaskOverlays?.() ?? [],
      degradedRendering,
    });
    syncPaintCursor();
    deps.onAfterCanvasRender?.();
  }

  function scheduleCanvasRender() {
    if (scheduledCanvasRender) {
      return;
    }
    scheduledCanvasRender = requestRenderFrame(() => {
      scheduledCanvasRender = 0;
      renderCanvas();
    });
  }

  function bindZoomControls() {
    document.querySelectorAll<HTMLButtonElement>("[data-zoom-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const doc = deps.getActiveDocument();
        if (!doc) return;
        const delta = button.dataset.zoomStep === "in" ? 25 : -25;
        doc.zoom = clamp(doc.zoom + delta, 10, 800);
        deps.log(`Zoom changed to ${doc.zoom}% for '${doc.name}'`, "INFO");
        deps.renderEditorState();
      });
    });

    deps.editorCanvas.addEventListener("wheel", (event) => {
      const doc = deps.getActiveDocument();
      if (!doc) return;

      if (event.altKey && isBrushCursorTool(deps.getSettings().activeTool)) {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
        if (delta !== 0) {
          deps.adjustBrushSize(delta);
        }
        updatePaintCursorPosition(event.clientX, event.clientY);
        return;
      }

      event.preventDefault();
      doc.zoom = clamp(doc.zoom + (event.deltaY < 0 ? 10 : -10), 10, 800);
      deps.log(`Wheel zoom changed to ${doc.zoom}% for '${doc.name}'`, "INFO");
      deps.renderShellState();
      scheduleCanvasRender();
    }, { passive: false });

    // Zoom readout: click to reset view, drag left/right to scrub zoom
    const readout = document.getElementById("zoom-readout") as HTMLButtonElement;
    let dragStartX = 0;
    let dragStartZoom = 0;
    let didDrag = false;

    readout.addEventListener("pointerdown", (e) => {
      const doc = deps.getActiveDocument();
      if (!doc) return;
      dragStartX = e.clientX;
      dragStartZoom = doc.zoom;
      didDrag = false;
      readout.setPointerCapture(e.pointerId);
    });

    readout.addEventListener("pointermove", (e) => {
      if (!readout.hasPointerCapture(e.pointerId)) return;
      const doc = deps.getActiveDocument();
      if (!doc) return;
      const dx = e.clientX - dragStartX;
      if (!didDrag && Math.abs(dx) < 4) return;
      didDrag = true;
      doc.zoom = clamp(dragStartZoom + Math.round(dx * 2), 10, 800);
      deps.renderShellState();
      scheduleCanvasRender();
    });

    readout.addEventListener("pointerup", (e) => {
      if (!readout.hasPointerCapture(e.pointerId)) return;
      readout.releasePointerCapture(e.pointerId);
      if (!didDrag) {
        deps.resetView();
      }
    });
  }

  function addGuide(doc: DocumentState, orientation: "horizontal" | "vertical", position: number) {
    const guide: Guide = { id: nextId("guide"), orientation, position };
    doc.guides.push(guide);
    doc.dirty = true;
    pushHistory(doc, `Added ${orientation} guide at ${Math.round(position)}`);
    return guide;
  }

  function removeGuide(doc: DocumentState, guideId: string) {
    const index = doc.guides.findIndex((guide) => guide.id === guideId);
    if (index >= 0) {
      doc.guides.splice(index, 1);
      doc.dirty = true;
      pushHistory(doc, "Removed guide");
    }
  }

  function bindCanvasInteractions() {
    if (!paintCursor.parentElement) {
      deps.canvasWrap.appendChild(paintCursor);
    }

    deps.editorCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

    deps.editorCanvas.addEventListener("pointerenter", (event) => {
      updatePaintCursorPosition(event.clientX, event.clientY);
    });

    deps.editorCanvas.addEventListener("pointermove", (event) => {
      updatePaintCursorPosition(event.clientX, event.clientY);
    });

    deps.editorCanvas.addEventListener("pointerleave", () => {
      paintCursorPosition = null;
      hidePaintCursor();
    });

    deps.editorCanvas.addEventListener("pointerdown", (event) => {
      deps.updateMarqueeModeFromModifiers(event.ctrlKey, event.shiftKey, event.altKey);
      const activeTool = deps.getSettings().activeTool;
      if (["marquee", "lasso", "polygon-lasso", "magic-wand"].includes(activeTool)) {
        deps.captureSelectionMode();
      }
      const settings = deps.getSettings();
      if (!settings.snapEnabled) {
        deps.canvasPointer.handlePointerDown(event);
        return;
      }
      const doc = deps.getActiveDocument();
      if (!doc) {
        deps.canvasPointer.handlePointerDown(event);
        return;
      }

      const rect = deps.editorCanvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      if (localY < RULER_SIZE && localX > RULER_SIZE) {
        const bounds = getCanvasBoundsForDoc(doc);
        const newGuide = addGuide(doc, "vertical", (localX - bounds.originX) / bounds.scale);
        draggingGuideId = newGuide.id;
        deps.editorCanvas.setPointerCapture(event.pointerId);
        deps.renderEditorState();
        return;
      }
      if (localX < RULER_SIZE && localY > RULER_SIZE) {
        const bounds = getCanvasBoundsForDoc(doc);
        const newGuide = addGuide(doc, "horizontal", (localY - bounds.originY) / bounds.scale);
        draggingGuideId = newGuide.id;
        deps.editorCanvas.setPointerCapture(event.pointerId);
        deps.renderEditorState();
        return;
      }

      if (activeTool === "move") {
        const bounds = getCanvasBoundsForDoc(doc);
        const docX = (localX - bounds.originX) / bounds.scale;
        const docY = (localY - bounds.originY) / bounds.scale;
        const guide = findGuideAtPosition(doc, docX, docY, bounds);
        if (guide) {
          draggingGuideId = guide.id;
          deps.editorCanvas.setPointerCapture(event.pointerId);
          return;
        }
      }

      deps.canvasPointer.handlePointerDown(event);
    });

    window.addEventListener("pointermove", (event) => {
      if (draggingGuideId) {
        const doc = deps.getActiveDocument();
        if (!doc) return;
        const guide = doc.guides.find((item) => item.id === draggingGuideId);
        if (!guide) return;
        const rect = deps.editorCanvas.getBoundingClientRect();
        const bounds = getCanvasBoundsForDoc(doc);
        guide.position = guide.orientation === "horizontal"
          ? (event.clientY - rect.top - bounds.originY) / bounds.scale
          : (event.clientX - rect.left - bounds.originX) / bounds.scale;
        scheduleCanvasRender();
        return;
      }
      deps.canvasPointer.handlePointerMove(event);
    });

    window.addEventListener("pointerup", () => {
      if (draggingGuideId) {
        const doc = deps.getActiveDocument();
        if (doc) {
          const guide = doc.guides.find((item) => item.id === draggingGuideId);
          if (guide && isGuideOutsideDocument(doc, guide)) {
            removeGuide(doc, guide.id);
            deps.log("Guide removed (dragged off canvas)", "INFO");
            deps.showToast("Guide removed", "info");
          }
        }
        draggingGuideId = null;
        deps.renderEditorState();
        return;
      }
      deps.canvasPointer.handlePointerUp();
      activeSnapLines = [];
    });

    window.addEventListener("resize", renderCanvas);
    window.addEventListener("blur", () => {
      paintCursorPosition = null;
      hidePaintCursor();
    });
  }

  return {
    renderCanvas,
    scheduleCanvasRender,
    bindZoomControls,
    bindCanvasInteractions,
    snapLayerPosition,
    getCanvasBoundsForDoc,
  };
}
