import { closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { cloneCanvas, snapshotDocument, syncLayerSource } from "../editor/documents";
import { pushHistory } from "../editor/history";
import { applyDisplacementMapToImageData, applyLiquifyBrush, hasLiquifyDisplacement, type LiquifyBrushMode } from "../editor/liquify";
import type { Layer, DocumentState } from "../editor/types";
import { createWarpMesh, drawMeshOverlay, findNearestControlPoint, renderWarp, resetMesh, type WarpMesh } from "../editor/warp";
import { byId } from "./dom";

type ToastVariant = "success" | "error" | "info";

export interface DistortModalControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  renderEditorState: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
}

export interface DistortModalController {
  openWarpModal(): void;
  openLiquifyModal(): void;
}

export function getDistortSessionError(layer: Layer | null, action = "edit") {
  if (!layer) return "No active layer";
  if (layer.type === "adjustment") return `Cannot ${action} adjustment layers`;
  if (layer.type === "smart-object") return "Rasterize smart object first";
  return null;
}

export function isWarpMeshModified(mesh: WarpMesh, threshold = 0.5) {
  for (let i = 0; i < mesh.points.length; i += 1) {
    if (
      Math.abs(mesh.points[i].x - mesh.original[i].x) > threshold ||
      Math.abs(mesh.points[i].y - mesh.original[i].y) > threshold
    ) {
      return true;
    }
  }
  return false;
}

function commitRasterLayerEdit(doc: DocumentState, layer: Layer, historyLabel: string, canvasOrImage: HTMLCanvasElement | ImageData) {
  const context = layer.canvas.getContext("2d");
  if (!context) {
    return;
  }
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  if (canvasOrImage instanceof ImageData) {
    context.putImageData(canvasOrImage, 0, 0);
  } else {
    context.drawImage(canvasOrImage, 0, 0);
  }
  syncLayerSource(layer);
  doc.dirty = true;
  pushHistory(doc, historyLabel);
}

export function createDistortModalController(deps: DistortModalControllerDeps): DistortModalController {
  function openWarpModal() {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = deps.getActiveLayer(doc);
    const error = getDistortSessionError(layer, "warp");
    if (error) {
      deps.showToast(error, "error");
      return;
    }

    const activeLayer = layer as Layer;
    const backdrop = byId<HTMLElement>("warp-modal");
    const previewCanvas = byId<HTMLCanvasElement>("warp-preview-canvas");
    const gridSelect = byId<HTMLSelectElement>("warp-grid-select");
    const resetBtn = byId<HTMLButtonElement>("warp-reset-btn");
    const applyBtn = byId<HTMLButtonElement>("warp-apply-btn");
    const previewContext = previewCanvas.getContext("2d");
    if (!previewContext) {
      return;
    }

    const sourceCanvas = cloneCanvas(activeLayer.canvas);
    const scale = Math.min(400 / sourceCanvas.width, 300 / sourceCanvas.height, 1);
    const previewWidth = Math.round(sourceCanvas.width * scale);
    const previewHeight = Math.round(sourceCanvas.height * scale);
    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;

    let gridSize = Number(gridSelect.value) || 3;
    let mesh = createWarpMesh(sourceCanvas.width, sourceCanvas.height, gridSize, gridSize);
    let dragIndex = -1;

    const redrawPreview = () => {
      const temp = document.createElement("canvas");
      temp.width = sourceCanvas.width;
      temp.height = sourceCanvas.height;
      renderWarp(sourceCanvas, temp, mesh);
      previewContext.clearRect(0, 0, previewWidth, previewHeight);
      const checkSize = 8;
      for (let y = 0; y < previewHeight; y += checkSize) {
        for (let x = 0; x < previewWidth; x += checkSize) {
          const light = ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2) === 0;
          previewContext.fillStyle = light ? "#3a3a3a" : "#2a2a2a";
          previewContext.fillRect(x, y, checkSize, checkSize);
        }
      }
      previewContext.drawImage(temp, 0, 0, previewWidth, previewHeight);
      previewContext.save();
      previewContext.scale(scale, scale);
      drawMeshOverlay(previewContext, mesh, scale, dragIndex);
      previewContext.restore();
    };

    const canvasToSource = (clientX: number, clientY: number) => {
      const rect = previewCanvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * sourceCanvas.width,
        y: ((clientY - rect.top) / rect.height) * sourceCanvas.height,
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      const point = canvasToSource(event.clientX, event.clientY);
      dragIndex = findNearestControlPoint(mesh, point.x, point.y, 12 / scale);
      if (dragIndex >= 0) {
        previewCanvas.setPointerCapture(event.pointerId);
      }
      redrawPreview();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragIndex < 0) return;
      mesh.points[dragIndex] = canvasToSource(event.clientX, event.clientY);
      redrawPreview();
    };

    const onPointerUp = () => {
      dragIndex = -1;
      redrawPreview();
    };

    const onGridChange = () => {
      gridSize = Number(gridSelect.value) || 3;
      mesh = createWarpMesh(sourceCanvas.width, sourceCanvas.height, gridSize, gridSize);
      dragIndex = -1;
      redrawPreview();
    };

    const onReset = () => {
      resetMesh(mesh);
      dragIndex = -1;
      redrawPreview();
    };

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      previewCanvas.removeEventListener("pointerdown", onPointerDown);
      previewCanvas.removeEventListener("pointermove", onPointerMove);
      previewCanvas.removeEventListener("pointerup", onPointerUp);
      gridSelect.removeEventListener("change", onGridChange);
      resetBtn.removeEventListener("click", onReset);
      applyBtn.removeEventListener("click", onApply);
    };

    const onApply = () => {
      if (!isWarpMeshModified(mesh)) {
        closeModal({ backdrop });
        finish();
        deps.showToast("No warp applied (mesh unchanged)", "info");
        return;
      }

      const result = document.createElement("canvas");
      result.width = sourceCanvas.width;
      result.height = sourceCanvas.height;
      renderWarp(sourceCanvas, result, mesh);
      commitRasterLayerEdit(doc, activeLayer, "Warp", result);
      closeModal({ backdrop });
      finish();
      deps.renderEditorState();
      deps.showToast("Warp applied");
    };

    previewCanvas.addEventListener("pointerdown", onPointerDown);
    previewCanvas.addEventListener("pointermove", onPointerMove);
    previewCanvas.addEventListener("pointerup", onPointerUp);
    gridSelect.addEventListener("change", onGridChange);
    resetBtn.addEventListener("click", onReset);
    applyBtn.addEventListener("click", onApply);
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: finish,
    });
    redrawPreview();
  }

  function openLiquifyModal() {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = deps.getActiveLayer(doc);
    const error = getDistortSessionError(layer, "liquify");
    if (error) {
      deps.showToast(error, "error");
      return;
    }

    const activeLayer = layer as Layer;
    const backdrop = byId<HTMLElement>("liquify-modal");
    const previewCanvas = byId<HTMLCanvasElement>("liq-preview-canvas");
    const sizeRange = byId<HTMLInputElement>("liq-size-range");
    const sizeValue = byId<HTMLElement>("liq-size-value");
    const strengthRange = byId<HTMLInputElement>("liq-strength-range");
    const strengthValue = byId<HTMLElement>("liq-strength-value");
    const applyBtn = byId<HTMLButtonElement>("liq-apply-btn");
    const previewContext = previewCanvas.getContext("2d");
    if (!previewContext) {
      return;
    }

    const sourceWidth = activeLayer.canvas.width;
    const sourceHeight = activeLayer.canvas.height;
    const sourceImageData = activeLayer.canvas.getContext("2d")?.getImageData(0, 0, sourceWidth, sourceHeight);
    if (!sourceImageData) {
      return;
    }
    const dispX = new Float32Array(sourceWidth * sourceHeight);
    const dispY = new Float32Array(sourceWidth * sourceHeight);
    const scale = Math.min(400 / sourceWidth, 300 / sourceHeight, 1);
    const previewWidth = Math.round(sourceWidth * scale);
    const previewHeight = Math.round(sourceHeight * scale);
    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;

    let currentBrushSize = Number(sizeRange.value);
    let currentStrength = Number(strengthRange.value) / 100;
    let dragging = false;
    let lastPoint = { x: 0, y: 0 };
    let dragMode: LiquifyBrushMode = "push";

    const redrawPreview = () => {
      const temp = document.createElement("canvas");
      temp.width = sourceWidth;
      temp.height = sourceHeight;
      temp.getContext("2d")?.putImageData(applyDisplacementMapToImageData(sourceImageData, dispX, dispY), 0, 0);
      previewContext.clearRect(0, 0, previewWidth, previewHeight);
      const checkSize = 8;
      for (let y = 0; y < previewHeight; y += checkSize) {
        for (let x = 0; x < previewWidth; x += checkSize) {
          const light = ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2) === 0;
          previewContext.fillStyle = light ? "#3a3a3a" : "#2a2a2a";
          previewContext.fillRect(x, y, checkSize, checkSize);
        }
      }
      previewContext.drawImage(temp, 0, 0, previewWidth, previewHeight);
    };

    const canvasToSource = (clientX: number, clientY: number) => {
      const rect = previewCanvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * sourceWidth,
        y: ((clientY - rect.top) / rect.height) * sourceHeight,
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastPoint = canvasToSource(event.clientX, event.clientY);
      dragMode = event.button === 2 ? "smooth" : "push";
      previewCanvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const point = canvasToSource(event.clientX, event.clientY);
      const moveX = point.x - lastPoint.x;
      const moveY = point.y - lastPoint.y;
      applyLiquifyBrush({
        dispX,
        dispY,
        width: sourceWidth,
        height: sourceHeight,
        centerX: point.x,
        centerY: point.y,
        brushSize: currentBrushSize,
        strength: currentStrength,
        moveX: event.shiftKey ? -moveX : moveX,
        moveY: event.shiftKey ? -moveY : moveY,
        mode: dragMode,
      });
      lastPoint = point;
      redrawPreview();
    };

    const onPointerUp = () => {
      dragging = false;
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    const onSizeInput = () => {
      currentBrushSize = Number(sizeRange.value);
      sizeValue.textContent = String(currentBrushSize);
    };

    const onStrengthInput = () => {
      currentStrength = Number(strengthRange.value) / 100;
      strengthValue.textContent = strengthRange.value;
    };

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      previewCanvas.removeEventListener("pointerdown", onPointerDown);
      previewCanvas.removeEventListener("pointermove", onPointerMove);
      previewCanvas.removeEventListener("pointerup", onPointerUp);
      previewCanvas.removeEventListener("contextmenu", onContextMenu);
      sizeRange.removeEventListener("input", onSizeInput);
      strengthRange.removeEventListener("input", onStrengthInput);
      applyBtn.removeEventListener("click", onApply);
    };

    const onApply = () => {
      if (!hasLiquifyDisplacement(dispX, dispY)) {
        closeModal({ backdrop });
        finish();
        deps.showToast("No liquify applied", "info");
        return;
      }

      commitRasterLayerEdit(doc, activeLayer, "Liquify", applyDisplacementMapToImageData(sourceImageData, dispX, dispY));
      closeModal({ backdrop });
      finish();
      deps.renderEditorState();
      deps.showToast("Liquify applied");
    };

    previewCanvas.addEventListener("pointerdown", onPointerDown);
    previewCanvas.addEventListener("pointermove", onPointerMove);
    previewCanvas.addEventListener("pointerup", onPointerUp);
    previewCanvas.addEventListener("contextmenu", onContextMenu);
    sizeRange.addEventListener("input", onSizeInput);
    strengthRange.addEventListener("input", onStrengthInput);
    applyBtn.addEventListener("click", onApply);
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: finish,
    });
    redrawPreview();
  }

  return {
    openWarpModal,
    openLiquifyModal,
  };
}
