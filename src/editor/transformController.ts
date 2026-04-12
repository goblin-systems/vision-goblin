import { pushHistory } from "./history";
import {
  buildTransformMatrix,
  buildTransformPreview,
  extractRasterLayerContentCanvas,
  getRasterLayerContentBounds,
  getRasterLayerContentBoundsLocal,
  refreshLayerCanvas,
  snapshotDocument,
  syncLayerSource,
} from "./documents";
import { isMaskEmpty, maskBoundingRect, normalizeSelectionToMask, transformMaskInDocumentSpace } from "./selection";
import { applyShapeGroupTransform, createShapeGroupTransformDraft, getEligibleShapeTransformLayers } from "./shapeGroupTransform";
import { renderSmartObjectLayer } from "./smartObject";
import type { DocumentState, Layer, TransformDraft, TransformIntent } from "./types";

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

  function transformDraftPoint(draft: Pick<TransformDraft, "centerX" | "centerY" | "pivotX" | "pivotY" | "scaleX" | "scaleY" | "rotateDeg" | "skewXDeg" | "skewYDeg">, x: number, y: number) {
    const matrix = buildTransformMatrix(draft);
    const dx = x - draft.pivotX;
    const dy = y - draft.pivotY;
    return {
      x: draft.pivotX + matrix.a * dx + matrix.c * dy,
      y: draft.pivotY + matrix.b * dx + matrix.d * dy,
    };
  }

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

  function ensureDraft(doc: DocumentState, layer: Layer, intent: TransformIntent = "layer") {
    if (intent === "layer") {
      const eligibleShapeLayers = getEligibleShapeTransformLayers(doc, layer.id);
      if (eligibleShapeLayers.length >= 2) {
        const eligibleShapeLayerIds = eligibleShapeLayers.map((item) => item.id);
        const currentDraft = transformDraft;
        const existingGroupDraft = currentDraft?.groupMembers && currentDraft.layerId === layer.id && currentDraft.intent === intent
          && currentDraft.previewLayerIds?.length === eligibleShapeLayerIds.length
          && eligibleShapeLayerIds.every((id) => currentDraft.previewLayerIds?.includes(id))
          ? currentDraft
          : null;
        if (existingGroupDraft) {
          return existingGroupDraft;
        }
        const groupDraft = createShapeGroupTransformDraft(doc, eligibleShapeLayers, layer.id, intent);
        if (groupDraft) {
          groupDraft.snapshot = snapshotDocument(doc);
          transformDraft = groupDraft;
          syncInputs();
          return transformDraft;
        }
      }
    }
    if (transformDraft && transformDraft.layerId === layer.id && transformDraft.intent === intent) {
      return transformDraft;
    }
    const rasterContentBoundsLocal = layer.type === "raster"
      ? getRasterLayerContentBoundsLocal(layer)
      : null;
    const frameBounds = layer.type === "raster"
      ? (rasterContentBoundsLocal
        ? {
            x: layer.x + rasterContentBoundsLocal.x,
            y: layer.y + rasterContentBoundsLocal.y,
            width: rasterContentBoundsLocal.width,
            height: rasterContentBoundsLocal.height,
          }
        : getRasterLayerContentBounds(layer) ?? { x: layer.x, y: layer.y, width: layer.canvas.width, height: layer.canvas.height })
      : undefined;
    const cx = frameBounds ? frameBounds.x + frameBounds.width / 2 : layer.x + layer.canvas.width / 2;
    const cy = frameBounds ? frameBounds.y + frameBounds.height / 2 : layer.y + layer.canvas.height / 2;
    transformDraft = {
      layerId: layer.id,
      intent,
      sourceCanvas: layer.type === "raster" && rasterContentBoundsLocal
        ? extractRasterLayerContentCanvas(layer, rasterContentBoundsLocal)
        : (layer.sourceCanvas ?? layer.canvas),
      frameBounds,
      centerX: cx,
      centerY: cy,
      pivotX: cx,
      pivotY: cy,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      textBoxWidth: layer.type === "text" ? layer.textData.boxWidth : undefined,
      textBoxHeight: layer.type === "text" ? layer.textData.boxHeight : undefined,
      previewOverride: null,
      snapshot: snapshotDocument(doc),
    };
    syncInputs();
    return transformDraft;
  }

  function ensureDraftForActiveLayer() {
    return ensureDraftForActiveLayerWithIntent("layer");
  }

  function ensureDraftForActiveLayerWithIntent(intent: TransformIntent) {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer || layer.isBackground || layer.locked) {
      return null;
    }
    return ensureDraft(doc, layer, intent);
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

    if (applyShapeGroupTransform(doc, draft)) {
      doc.activeLayerId = draft.layerId;
      doc.selectedLayerIds = draft.previewLayerIds && draft.previewLayerIds.length > 1
        ? [...draft.previewLayerIds]
        : [];
    } else if (layer.type === "text" && draft.intent === "text-layout") {
      if (typeof draft.textBoxWidth === "number") {
        layer.textData.boxWidth = Math.max(1, Math.round(draft.textBoxWidth));
      }
      layer.textData.boxHeight = typeof draft.textBoxHeight === "number"
        ? Math.max(1, Math.round(draft.textBoxHeight))
        : null;
      layer.x = Math.round(preview.x);
      layer.y = Math.round(preview.y);
      refreshLayerCanvas(layer);
    } else if (layer.type === "text") {
      layer.textData.scaleX *= draft.scaleX;
      layer.textData.scaleY *= draft.scaleY;
      layer.textData.rotationDeg += draft.rotateDeg;
      layer.textData.skewXDeg += draft.skewXDeg;
      layer.textData.skewYDeg += draft.skewYDeg;
      layer.x = Math.round(preview.x);
      layer.y = Math.round(preview.y);
      refreshLayerCanvas(layer);
    } else if (layer.type === "shape" && Math.abs(draft.skewXDeg) < 0.001 && Math.abs(draft.skewYDeg) < 0.001) {
      const transformedCenter = transformDraftPoint(draft, draft.centerX, draft.centerY);
      layer.shapeData.width = Math.max(1, Math.round(layer.shapeData.width * draft.scaleX));
      layer.shapeData.height = Math.max(1, Math.round(layer.shapeData.height * draft.scaleY));
      layer.shapeData.rotationDeg += draft.rotateDeg;
      refreshLayerCanvas(layer);
      layer.x = Math.round(transformedCenter.x - layer.canvas.width / 2);
      layer.y = Math.round(transformedCenter.y - layer.canvas.height / 2);
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
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    transformDraft.scaleX = Math.max(0.01, Number(deps.getInput("transform-scale-x-input").value) / 100);
    transformDraft.scaleY = Math.max(0.01, Number(deps.getInput("transform-scale-y-input").value) / 100);
    transformDraft.rotateDeg = Number(deps.getInput("transform-rotate-input").value) || 0;
    if (transformDraft.intent === "text-layout") {
      transformDraft.scaleX = 1;
      transformDraft.scaleY = 1;
      transformDraft.rotateDeg = 0;
      transformDraft.skewXDeg = 0;
      transformDraft.skewYDeg = 0;
      transformDraft.previewOverride = null;
      deps.getInput("transform-scale-x-input").value = "100";
      deps.getInput("transform-scale-y-input").value = "100";
      deps.getInput("transform-rotate-input").value = "0";
      deps.getInput("transform-skew-x-input").value = "0";
      deps.getInput("transform-skew-y-input").value = "0";
    } else {
      transformDraft.skewXDeg = Number(deps.getInput("transform-skew-x-input").value) || 0;
      transformDraft.skewYDeg = Number(deps.getInput("transform-skew-y-input").value) || 0;
    }
  }

  return {
    getDraft,
    getMode,
    setMode,
    syncInputs,
    ensureDraft,
    ensureDraftForActiveLayer,
    ensureDraftForActiveLayerWithIntent,
    cancel,
    commit,
    updateDraftFromInputs,
  };
}
