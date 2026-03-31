import { pushHistory } from "./history";
import { buildTransformMatrix, buildTransformPreview, refreshLayerCanvas, snapshotDocument, syncLayerSource } from "./documents";
import { isMaskEmpty, maskBoundingRect, normalizeSelectionToMask, transformMaskInDocumentSpace } from "./selection";
import { renderSmartObjectLayer } from "./smartObject";
import type { DocumentState, Layer, TransformDraft } from "./types";

export type TransformMode = "scale" | "rotate";

interface TransformControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  getInput: (id: string) => HTMLInputElement;
}

export function createTransformController(deps: TransformControllerDeps) {
  let transformMode: TransformMode = "scale";
  let transformDraft: TransformDraft | null = null;

  function getDraft() {
    return transformDraft;
  }

  function getMode() {
    return transformMode;
  }

  function setMode(nextMode: TransformMode, announce = true) {
    transformMode = nextMode;
    deps.renderEditorState();
    if (announce) {
      deps.showToast(`Transform mode: ${nextMode}`, "info");
    }
  }

  function syncInputs() {
    const scaleX = deps.getInput("transform-scale-x-input");
    const scaleY = deps.getInput("transform-scale-y-input");
    const rotate = deps.getInput("transform-rotate-input");
    const skewX = deps.getInput("transform-skew-x-input");
    const skewY = deps.getInput("transform-skew-y-input");
    scaleX.value = transformDraft ? String(Math.round(transformDraft.scaleX * 100)) : "100";
    scaleY.value = transformDraft ? String(Math.round(transformDraft.scaleY * 100)) : "100";
    rotate.value = transformDraft ? String(Math.round(transformDraft.rotateDeg)) : "0";
    skewX.value = transformDraft ? String(Math.round(transformDraft.skewXDeg)) : "0";
    skewY.value = transformDraft ? String(Math.round(transformDraft.skewYDeg)) : "0";
  }

  function ensureDraft(doc: DocumentState, layer: Layer) {
    if (transformDraft && transformDraft.layerId === layer.id) {
      return transformDraft;
    }
    const cx = layer.x + layer.canvas.width / 2;
    const cy = layer.y + layer.canvas.height / 2;
    transformDraft = {
      layerId: layer.id,
      sourceCanvas: layer.sourceCanvas ?? layer.canvas,
      centerX: cx,
      centerY: cy,
      pivotX: cx,
      pivotY: cy,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      snapshot: snapshotDocument(doc),
    };
    syncInputs();
    return transformDraft;
  }

  function ensureDraftForActiveLayer() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer || layer.isBackground || layer.locked) {
      return null;
    }
    return ensureDraft(doc, layer);
  }

  function cancel(showMessage = true) {
    if (!transformDraft) return;
    transformDraft = null;
    syncInputs();
    deps.renderEditorState();
    if (showMessage) {
      deps.showToast("Transform cancelled", "info");
    }
  }

  function commit() {
    const doc = deps.getActiveDocument();
    const draft = transformDraft;
    if (!doc || !draft) return;
    const layer = doc.layers.find((item) => item.id === draft.layerId);
    if (!layer) return;
    const preview = buildTransformPreview(draft);
    const normalizedSelectionMask = normalizeSelectionToMask(
      doc.width,
      doc.height,
      doc.selectionRect,
      doc.selectionShape,
      doc.selectionPath,
      doc.selectionMask,
    );
    doc.undoStack.push(draft.snapshot);
    doc.redoStack = [];
    const isPureRotation = Math.abs(draft.scaleX - 1) < 0.001
      && Math.abs(draft.scaleY - 1) < 0.001
      && Math.abs(draft.skewXDeg) < 0.001
      && Math.abs(draft.skewYDeg) < 0.001;

    if (isPureRotation && layer.type === "text") {
      layer.textData.rotationDeg += draft.rotateDeg;
      layer.x = Math.round(preview.x);
      layer.y = Math.round(preview.y);
      refreshLayerCanvas(layer);
    } else if (isPureRotation && layer.type === "shape") {
      layer.shapeData.rotationDeg += draft.rotateDeg;
      layer.x = Math.round(preview.x);
      layer.y = Math.round(preview.y);
      refreshLayerCanvas(layer);
    } else if (layer.type === "smart-object") {
      layer.smartObjectData.scaleX *= draft.scaleX;
      layer.smartObjectData.scaleY *= draft.scaleY;
      layer.smartObjectData.rotateDeg += draft.rotateDeg;
      layer.x = Math.round(preview.x);
      layer.y = Math.round(preview.y);
      renderSmartObjectLayer(layer);
    } else {
      layer.canvas = preview.canvas;
      layer.x = Math.round(preview.x);
      layer.y = Math.round(preview.y);
      syncLayerSource(layer);
    }
    if (normalizedSelectionMask) {
      const transformedSelectionMask = transformMaskInDocumentSpace(
        normalizedSelectionMask,
        doc.width,
        doc.height,
        buildTransformMatrix(draft),
        draft.pivotX,
        draft.pivotY,
      );
      if (isMaskEmpty(transformedSelectionMask)) {
        doc.selectionMask = null;
        doc.selectionRect = null;
      } else {
        doc.selectionMask = transformedSelectionMask;
        doc.selectionRect = maskBoundingRect(transformedSelectionMask);
      }
      doc.selectionPath = null;
    }
    doc.dirty = true;
    pushHistory(doc, "Applied transform");
    transformDraft = null;
    syncInputs();
    deps.renderEditorState();
    deps.showToast("Transform applied", "success");
  }

  function updateDraftFromInputs() {
    if (!transformDraft) return;
    transformDraft.scaleX = Math.max(0.01, Number(deps.getInput("transform-scale-x-input").value) / 100);
    transformDraft.scaleY = Math.max(0.01, Number(deps.getInput("transform-scale-y-input").value) / 100);
    transformDraft.rotateDeg = Number(deps.getInput("transform-rotate-input").value) || 0;
    transformDraft.skewXDeg = Number(deps.getInput("transform-skew-x-input").value) || 0;
    transformDraft.skewYDeg = Number(deps.getInput("transform-skew-y-input").value) || 0;
  }

  return {
    getDraft,
    getMode,
    setMode,
    syncInputs,
    ensureDraft,
    ensureDraftForActiveLayer,
    cancel,
    commit,
    updateDraftFromInputs,
  };
}
