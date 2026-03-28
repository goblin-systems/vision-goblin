import { closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { alphaToMaskImageData, buildColorRangeMask, samplePixel } from "../editor/colorRange";
import { cloneCanvas, compositeDocumentOnto, snapshotDocument } from "../editor/documents";
import { refineMask } from "../editor/edgeRefinement";
import { pushHistory } from "../editor/history";
import { addLayer } from "../editor/layers";
import { createMaskCanvas, isMaskEmpty, maskBoundingRect } from "../editor/selection";
import type { DocumentState } from "../editor/types";
import { byId } from "./dom";

type ToastVariant = "success" | "error" | "info";
type RefineEdgeOutputMode = "selection" | "mask" | "new-layer";

export interface SelectionToolsControllerDeps {
  getActiveDocument: () => DocumentState | null;
  renderEditorState: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
  toggleQuickMaskSession: () => void;
}

export interface SelectionToolsController {
  openColorRangeModal(): void;
  openRefineEdgeModal(): void;
  toggleQuickMask(): void;
}

export function commitSelectionMask(doc: DocumentState, selectionMask: HTMLCanvasElement, historyLabel: string) {
  if (isMaskEmpty(selectionMask)) {
    return false;
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  doc.selectionRect = maskBoundingRect(selectionMask);
  doc.selectionShape = "rect";
  doc.selectionInverted = false;
  doc.selectionPath = null;
  doc.selectionMask = selectionMask;
  doc.dirty = true;
  pushHistory(doc, historyLabel);
  return true;
}

export function applyRefineEdgeOutput(
  doc: DocumentState,
  refinedMask: HTMLCanvasElement,
  outputMode: RefineEdgeOutputMode,
) {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  if (outputMode === "selection") {
    doc.selectionMask = refinedMask;
    doc.selectionRect = maskBoundingRect(refinedMask);
  } else if (outputMode === "mask") {
    const activeLayer = doc.layers.find((layer) => layer.id === doc.activeLayerId);
    if (activeLayer) {
      activeLayer.mask = refinedMask;
    }
  } else {
    const layer = addLayer(doc, "Refined selection");
    const layerContext = layer.canvas.getContext("2d");
    if (layerContext) {
      const flatCanvas = document.createElement("canvas");
      flatCanvas.width = doc.width;
      flatCanvas.height = doc.height;
      const flatContext = flatCanvas.getContext("2d");
      if (flatContext) {
        compositeDocumentOnto(flatContext, doc, 0, 0, 1);
        layerContext.drawImage(flatCanvas, 0, 0);
      }
    }
    layer.mask = refinedMask;
  }

  doc.dirty = true;
  pushHistory(doc, "Refine Edge");
}

export function createSelectionToolsController(deps: SelectionToolsControllerDeps): SelectionToolsController {
  function openColorRangeModal() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("No document open", "error");
      return;
    }

    const backdrop = byId<HTMLElement>("color-range-modal");
    const fuzzinessRange = byId<HTMLInputElement>("cr-fuzziness-range");
    const fuzzinessOutput = byId<HTMLElement>("cr-fuzziness-value");
    const previewCanvas = byId<HTMLCanvasElement>("cr-preview-canvas");
    const samplesList = byId<HTMLElement>("cr-samples-list");
    const clearBtn = byId<HTMLButtonElement>("cr-clear-samples-btn");
    const applyBtn = byId<HTMLButtonElement>("cr-apply-btn");

    const flatCanvas = document.createElement("canvas");
    flatCanvas.width = doc.width;
    flatCanvas.height = doc.height;
    const flatContext = flatCanvas.getContext("2d");
    if (!flatContext) {
      deps.showToast("Could not build color range preview", "error");
      return;
    }
    compositeDocumentOnto(flatContext, doc, 0, 0, 1);
    const flatImageData = flatContext.getImageData(0, 0, doc.width, doc.height);

    const previewScale = Math.min(300 / doc.width, 200 / doc.height, 1);
    previewCanvas.width = Math.round(doc.width * previewScale);
    previewCanvas.height = Math.round(doc.height * previewScale);

    let samples: Array<[number, number, number]> = [];
    let fuzziness = Number(fuzzinessRange.value);
    let previewRaf = 0;

    fuzzinessRange.value = String(fuzziness);
    fuzzinessOutput.textContent = String(fuzziness);
    samplesList.innerHTML = "";

    const renderSamples = () => {
      samplesList.innerHTML = "";
      for (const [r, g, b] of samples) {
        const swatch = document.createElement("div");
        swatch.style.cssText = `width:20px;height:20px;background:rgb(${r},${g},${b});border:1px solid var(--border);cursor:default;`;
        swatch.title = `rgb(${r}, ${g}, ${b})`;
        samplesList.appendChild(swatch);
      }
    };

    const updatePreview = () => {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(() => {
        const previewContext = previewCanvas.getContext("2d");
        if (!previewContext) {
          return;
        }
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewContext.drawImage(flatCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
        if (samples.length === 0) {
          return;
        }

        const mask = buildColorRangeMask(flatImageData, { samples, fuzziness });
        const maskImageData = alphaToMaskImageData(mask, doc.width, doc.height);
        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.width = doc.width;
        overlayCanvas.height = doc.height;
        const overlayContext = overlayCanvas.getContext("2d");
        if (!overlayContext) {
          return;
        }
        overlayContext.drawImage(flatCanvas, 0, 0);
        overlayContext.fillStyle = "rgba(0,0,0,0.6)";
        overlayContext.fillRect(0, 0, doc.width, doc.height);

        const selectedCanvas = document.createElement("canvas");
        selectedCanvas.width = doc.width;
        selectedCanvas.height = doc.height;
        const selectedContext = selectedCanvas.getContext("2d");
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = doc.width;
        maskCanvas.height = doc.height;
        const maskContext = maskCanvas.getContext("2d");
        if (!selectedContext || !maskContext) {
          return;
        }

        selectedContext.drawImage(flatCanvas, 0, 0);
        maskContext.putImageData(maskImageData, 0, 0);
        selectedContext.globalCompositeOperation = "destination-in";
        selectedContext.drawImage(maskCanvas, 0, 0);
        selectedContext.globalCompositeOperation = "source-over";
        overlayContext.drawImage(selectedCanvas, 0, 0);
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewContext.drawImage(overlayCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
      });
    };

    const onPreviewClick = (event: MouseEvent) => {
      const rect = previewCanvas.getBoundingClientRect();
      const docX = ((event.clientX - rect.left) / rect.width) * doc.width;
      const docY = ((event.clientY - rect.top) / rect.height) * doc.height;
      const colour = samplePixel(flatImageData, docX, docY);
      if (!colour) {
        return;
      }
      if (!event.shiftKey) {
        samples = [];
      }
      samples.push(colour);
      renderSamples();
      updatePreview();
    };

    const onFuzzinessInput = () => {
      fuzziness = Number(fuzzinessRange.value);
      fuzzinessOutput.textContent = String(fuzziness);
      updatePreview();
    };

    const onClearSamples = () => {
      samples = [];
      renderSamples();
      updatePreview();
    };

    let settled = false;
    const cleanup = () => {
      cancelAnimationFrame(previewRaf);
      previewCanvas.removeEventListener("click", onPreviewClick);
      fuzzinessRange.removeEventListener("input", onFuzzinessInput);
      clearBtn.removeEventListener("click", onClearSamples);
      applyBtn.removeEventListener("click", onApply);
    };

    const finish = (applied: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!applied) return;
      if (samples.length === 0) {
        deps.showToast("No colors sampled", "info");
        return;
      }

      const mask = buildColorRangeMask(flatImageData, { samples, fuzziness });
      const maskImageData = alphaToMaskImageData(mask, doc.width, doc.height);
      const selectionMask = createMaskCanvas(doc.width, doc.height);
      selectionMask.getContext("2d")?.putImageData(maskImageData, 0, 0);
      if (!commitSelectionMask(doc, selectionMask, "Select by Color Range")) {
        deps.showToast("No pixels matched", "info");
        return;
      }
      deps.renderEditorState();
      deps.showToast("Color range selection applied", "success");
    };

    const onApply = () => {
      closeModal({ backdrop });
      finish(true);
    };

    previewCanvas.addEventListener("click", onPreviewClick);
    fuzzinessRange.addEventListener("input", onFuzzinessInput);
    clearBtn.addEventListener("click", onClearSamples);
    applyBtn.addEventListener("click", onApply);
    updatePreview();
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(false),
    });
  }

  function openRefineEdgeModal() {
    const doc = deps.getActiveDocument();
    if (!doc?.selectionMask) {
      deps.showToast("No active selection to refine", "error");
      return;
    }

    const backdrop = byId<HTMLElement>("edge-refine-modal");
    const featherRange = byId<HTMLInputElement>("er-feather-range");
    const featherOutput = byId<HTMLElement>("er-feather-value");
    const smoothRange = byId<HTMLInputElement>("er-smooth-range");
    const smoothOutput = byId<HTMLElement>("er-smooth-value");
    const expandRange = byId<HTMLInputElement>("er-expand-range");
    const expandOutput = byId<HTMLElement>("er-expand-value");
    const previewBg = byId<HTMLSelectElement>("er-preview-bg");
    const outputMode = byId<HTMLSelectElement>("er-output-mode");
    const previewCanvas = byId<HTMLCanvasElement>("er-preview-canvas");
    const applyBtn = byId<HTMLButtonElement>("er-apply-btn");
    const originalMask = cloneCanvas(doc.selectionMask);
    const previewScale = Math.min(300 / doc.width, 200 / doc.height, 1);
    let previewRaf = 0;

    previewCanvas.width = Math.round(doc.width * previewScale);
    previewCanvas.height = Math.round(doc.height * previewScale);
    featherRange.value = "0";
    featherOutput.textContent = "0";
    smoothRange.value = "0";
    smoothOutput.textContent = "0";
    expandRange.value = "0";
    expandOutput.textContent = "0";

    const updatePreview = () => {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(() => {
        const previewContext = previewCanvas.getContext("2d");
        if (!previewContext) {
          return;
        }
        const feather = Number(featherRange.value);
        const smooth = Number(smoothRange.value);
        const expand = Number(expandRange.value);
        const refined = refineMask(originalMask, { feather, smooth, expand });
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        if (previewBg.value === "black") {
          previewContext.fillStyle = "#000";
          previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
        } else if (previewBg.value === "white") {
          previewContext.fillStyle = "#fff";
          previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
        } else if (previewBg.value === "checkerboard") {
          const size = 8;
          for (let y = 0; y < previewCanvas.height; y += size) {
            for (let x = 0; x < previewCanvas.width; x += size) {
              previewContext.fillStyle = ((x / size + y / size) & 1) ? "#ccc" : "#fff";
              previewContext.fillRect(x, y, size, size);
            }
          }
        }
        previewContext.drawImage(refined, 0, 0, previewCanvas.width, previewCanvas.height);
      });
    };

    const onSliderInput = () => {
      featherOutput.textContent = featherRange.value;
      smoothOutput.textContent = smoothRange.value;
      expandOutput.textContent = expandRange.value;
      updatePreview();
    };

    let settled = false;
    const cleanup = () => {
      cancelAnimationFrame(previewRaf);
      featherRange.removeEventListener("input", onSliderInput);
      smoothRange.removeEventListener("input", onSliderInput);
      expandRange.removeEventListener("input", onSliderInput);
      previewBg.removeEventListener("change", updatePreview);
      applyBtn.removeEventListener("click", onApply);
    };

    const finish = (applied: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!applied) return;

      const refined = refineMask(originalMask, {
        feather: Number(featherRange.value),
        smooth: Number(smoothRange.value),
        expand: Number(expandRange.value),
      });
      applyRefineEdgeOutput(doc, refined, outputMode.value as RefineEdgeOutputMode);
      deps.renderEditorState();
      deps.showToast("Edge refinement applied", "success");
    };

    const onApply = () => {
      closeModal({ backdrop });
      finish(true);
    };

    featherRange.addEventListener("input", onSliderInput);
    smoothRange.addEventListener("input", onSliderInput);
    expandRange.addEventListener("input", onSliderInput);
    previewBg.addEventListener("change", updatePreview);
    applyBtn.addEventListener("click", onApply);
    updatePreview();
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(false),
    });
  }

  function toggleQuickMask() {
    deps.toggleQuickMaskSession();
  }

  return {
    openColorRangeModal,
    openRefineEdgeModal,
    toggleQuickMask,
  };
}
