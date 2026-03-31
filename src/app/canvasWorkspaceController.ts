import { getCanvasBounds } from "../editor/geometry";
import { pushHistory } from "../editor/history";
import { defaultPolygonRotation, isAxisAlignedRectMarquee } from "../editor/selection";
import { renderCanvas as renderCanvasView } from "../editor/render";
import { buildTransformPreview } from "../editor/documents";
import type { DocumentState, Guide, Layer, PointerState } from "../editor/types";
import type { VisionSettings } from "../settings";
import type { SelectionMode } from "../editor/selection";
import type { TransformDraft } from "../editor/types";
import { clamp, nextId } from "../editor/utils";

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
  editorCanvas: HTMLCanvasElement;
  getEditorContext: () => CanvasRenderingContext2D;
  getSettings: () => VisionSettings;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getPointerState: () => PointerState;
  getTransformDraft: () => TransformDraft | null;
  getEffectiveMarqueeMode: () => SelectionMode;
  getMarqueeSides: () => number;
  getMarqueeModifiers: () => { rotate: boolean; perfect: boolean };
  getQuickMaskOverlay: () => { canvas: HTMLCanvasElement; color: string } | null;
  renderEditorState: () => void;
  updateMarqueeModeFromModifiers: (ctrlKey: boolean, shiftKey: boolean, altKey: boolean) => void;
  captureSelectionMode: () => void;
  canvasPointer: CanvasPointerBindings;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export interface CanvasWorkspaceController {
  renderCanvas: () => void;
  bindZoomControls: () => void;
  bindCanvasInteractions: () => void;
  snapLayerPosition: (layer: Layer, rawX: number, rawY: number) => { x: number; y: number };
  getCanvasBoundsForDoc: (doc: DocumentState) => CanvasBounds;
}

export function createCanvasWorkspaceController(deps: CanvasWorkspaceControllerDeps): CanvasWorkspaceController {
  let activeSnapLines: SnapLine[] = [];
  let draggingGuideId: string | null = null;

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

  function renderCanvas() {
    const doc = deps.getActiveDocument();
    const activeTransformDraft = deps.getTransformDraft();
    const pointerState = deps.getPointerState();
    const previewLayer = doc && activeTransformDraft ? doc.layers.find((item) => item.id === activeTransformDraft.layerId) : null;
    const transformPreview = activeTransformDraft && previewLayer?.visible
      ? { layerId: activeTransformDraft.layerId, ...buildTransformPreview(activeTransformDraft) }
      : null;
    renderCanvasView({
      editorCanvas: deps.editorCanvas,
      getEditorContext: deps.getEditorContext,
      doc,
      activeTool: deps.getSettings().activeTool,
      activeLayer: doc ? deps.getActiveLayer(doc) : null,
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
      pivotPoint: activeTransformDraft ? { x: activeTransformDraft.pivotX, y: activeTransformDraft.pivotY } : null,
      guides: doc?.guides ?? [],
      snapLines: activeSnapLines,
      showRulers: deps.getSettings().snapEnabled,
      showGrid: deps.getSettings().showGrid,
      gridSize: deps.getSettings().gridSize,
      quickMaskOverlay: deps.getQuickMaskOverlay(),
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
      event.preventDefault();
      doc.zoom = clamp(doc.zoom + (event.deltaY < 0 ? 10 : -10), 10, 800);
      deps.log(`Wheel zoom changed to ${doc.zoom}% for '${doc.name}'`, "INFO");
      deps.renderEditorState();
    }, { passive: false });
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
    deps.editorCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

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
        deps.renderEditorState();
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
  }

  return {
    renderCanvas,
    bindZoomControls,
    bindCanvasInteractions,
    snapLayerPosition,
    getCanvasBoundsForDoc,
  };
}
