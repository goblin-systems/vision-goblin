import type { ToolName } from "../settings";
import { getLayerContext } from "./documents";
import { pushHistory } from "./history";
import { combineMasks, createMaskCanvas, fillMask, invertMask, isMaskEmpty, maskBoundingRect, pathBoundingRect, rasterizeFloodFillToMask, rasterizePathToMask, simplifyPath, type SelectionMode } from "./selection";
import type { DocumentState, Layer } from "./types";

interface ModifierState {
  ctrlPressed: boolean;
  shiftPressed: boolean;
  altPressed: boolean;
}

interface SelectionControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getActiveTool: () => ToolName;
  setActiveTool: (tool: ToolName) => void;
  renderEditorState: () => void;
  renderToolState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  snapshotDocument: (doc: DocumentState) => string;
}

export function createSelectionController(deps: SelectionControllerDeps) {
  let marqueeMode: SelectionMode = "replace";
  let marqueeModeOverride: SelectionMode | null = null;
  let capturedSelectionMode: SelectionMode | null = null;
  let marqueeSides = 4;
  let magicWandTolerance = 32;
  let magicWandContiguous = true;
  let quickMaskActive = false;
  let quickMaskOverlayColor = "rgba(255,0,0,0.5)";
  let quickMaskSavedTool: ToolName | null = null;
  let quickMaskCanvas: HTMLCanvasElement | null = null;

  function getEffectiveMarqueeMode() {
    return marqueeModeOverride ?? marqueeMode;
  }

  function getCapturedOrEffectiveMode() {
    return capturedSelectionMode ?? getEffectiveMarqueeMode();
  }

  function getMarqueeModifiers(modifiers: ModifierState) {
    const rotate = modifiers.ctrlPressed && modifiers.shiftPressed;
    const nonPerfect = modifiers.altPressed && modifiers.shiftPressed;
    return { rotate, perfect: !nonPerfect };
  }

  function setMarqueeMode(nextMode: SelectionMode) {
    marqueeMode = nextMode;
    deps.renderToolState();
    deps.showToast(`Selection mode: ${nextMode}`, "info");
  }

  function setMarqueeSides(sides: number) {
    marqueeSides = Math.max(3, Math.min(11, sides));
    deps.renderToolState();
    deps.showToast(`Marquee shape: ${marqueeSides === 11 ? "Ellipse" : marqueeSides}`, "info");
  }

  function getMarqueeSides() {
    return marqueeSides;
  }

  function updateMarqueeModeFromModifiers(ctrlKey: boolean, shiftKey: boolean, altKey: boolean) {
    const multiKey = [ctrlKey, shiftKey, altKey].filter(Boolean).length > 1;
    const nextOverride = multiKey ? null : altKey ? "intersect" : shiftKey ? "add" : ctrlKey ? "subtract" : null;
    if (marqueeModeOverride === nextOverride) {
      return;
    }
    marqueeModeOverride = nextOverride;
    deps.renderToolState();
  }

  function captureSelectionMode() {
    capturedSelectionMode = getEffectiveMarqueeMode();
  }

  function clearCapturedSelectionMode() {
    capturedSelectionMode = null;
  }

  function getMagicWandTolerance() {
    return magicWandTolerance;
  }

  function setMagicWandTolerance(value: number) {
    magicWandTolerance = value;
  }

  function isMagicWandContiguous() {
    return magicWandContiguous;
  }

  function setMagicWandContiguous(value: boolean) {
    magicWandContiguous = value;
  }

  function isQuickMaskActive() {
    return quickMaskActive;
  }

  function getQuickMaskCanvas() {
    return quickMaskCanvas;
  }

  function getQuickMaskOverlay() {
    return quickMaskActive && quickMaskCanvas
      ? { canvas: quickMaskCanvas, color: quickMaskOverlayColor }
      : null;
  }

  function clearSelection(showMessage = false) {
    const doc = deps.getActiveDocument();
    if (!doc?.selectionRect && !doc?.selectionMask) {
      return;
    }
    doc.selectionRect = null;
    doc.selectionInverted = false;
    doc.selectionPath = null;
    doc.selectionMask = null;
    deps.log(`Cleared selection for '${doc.name}'`, "INFO");
    deps.renderEditorState();
    if (showMessage) {
      deps.showToast("Selection cleared", "info");
    }
  }

  function selectEntireCanvas() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("No document to select", "error");
      return;
    }
    doc.selectionRect = { x: 0, y: 0, width: doc.width, height: doc.height };
    doc.selectionShape = "rect";
    doc.selectionInverted = false;
    doc.selectionPath = null;
    const mask = createMaskCanvas(doc.width, doc.height);
    fillMask(mask);
    doc.selectionMask = mask;
    deps.log(`Selected entire canvas for '${doc.name}'`, "INFO");
    deps.renderEditorState();
    deps.showToast("Selected full canvas", "info");
  }

  function invertSelection() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("No document to invert", "error");
      return;
    }
    if (doc.selectionMask) {
      invertMask(doc.selectionMask);
      doc.selectionInverted = false;
      const bounds = maskBoundingRect(doc.selectionMask);
      doc.selectionRect = bounds;
      if (!bounds) {
        doc.selectionMask = null;
      }
    } else if (!doc.selectionRect) {
      doc.selectionRect = { x: 0, y: 0, width: doc.width, height: doc.height };
      doc.selectionInverted = true;
    } else {
      doc.selectionInverted = !doc.selectionInverted;
    }
    deps.log(`Inverted selection for '${doc.name}'`, "INFO");
    deps.renderEditorState();
    deps.showToast("Selection inverted", "info");
  }

  function magicWandSelect(docX: number, docY: number) {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = deps.getActiveLayer(doc);
    if (!layer) return;

    const ctx = getLayerContext(layer);
    const lx = Math.round(docX - layer.x);
    const ly = Math.round(docY - layer.y);
    if (lx < 0 || ly < 0 || lx >= layer.canvas.width || ly >= layer.canvas.height) return;

    const imageData = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const { data, width, height } = imageData;
    const idx = (ly * width + lx) * 4;
    const tr = data[idx];
    const tg = data[idx + 1];
    const tb = data[idx + 2];
    const ta = data[idx + 3];
    const tol = magicWandTolerance;

    function colorMatch(i: number) {
      return Math.abs(data[i] - tr) + Math.abs(data[i + 1] - tg) + Math.abs(data[i + 2] - tb) + Math.abs(data[i + 3] - ta) <= tol * 4;
    }

    const mask = new Uint8Array(width * height);
    if (magicWandContiguous) {
      const stack = [lx, ly];
      mask[ly * width + lx] = 1;
      while (stack.length > 0) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const mi = ny * width + nx;
          if (mask[mi]) continue;
          if (colorMatch(mi * 4)) {
            mask[mi] = 1;
            stack.push(nx, ny);
          }
        }
      }
    } else {
      for (let i = 0; i < width * height; i++) {
        if (colorMatch(i * 4)) mask[i] = 1;
      }
    }

    const mode = getCapturedOrEffectiveMode();
    const tmpMask = createMaskCanvas(doc.width, doc.height);
    rasterizeFloodFillToMask(tmpMask, mask, width, height, layer.x, layer.y);

    if (mode === "replace" || !doc.selectionMask) {
      doc.selectionMask = tmpMask;
    } else {
      combineMasks(doc.selectionMask, tmpMask, mode);
    }

    const bounds = maskBoundingRect(doc.selectionMask);
    if (!bounds) {
      deps.showToast("No matching pixels found", "info");
      doc.selectionMask = null;
      doc.selectionRect = null;
      return;
    }

    doc.selectionRect = bounds;
    doc.selectionShape = "rect";
    doc.selectionInverted = false;
    doc.selectionPath = null;
    doc.dirty = true;
    clearCapturedSelectionMode();
    deps.log(`Magic wand selected ${bounds.width}x${bounds.height} at tolerance ${tol}`, "INFO");
    deps.showToast(`Selected ${bounds.width}x${bounds.height}`, "info");
    deps.renderEditorState();
  }

  function completeLassoSelection(docX: number, docY: number) {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    if (deps.getActiveTool() === "magic-wand") {
      magicWandSelect(docX, docY);
      return;
    }
    if (!doc.selectionPath || doc.selectionPath.points.length < 3) {
      doc.selectionPath = null;
      deps.log("Lasso cancelled: too few points", "WARN");
      deps.renderEditorState();
      return;
    }
    doc.selectionPath.points = simplifyPath(doc.selectionPath.points);
    doc.selectionPath.closed = true;
    const bounds = pathBoundingRect(doc.selectionPath);
    if (bounds.width < 2 || bounds.height < 2) {
      doc.selectionPath = null;
      deps.log("Lasso cancelled: selection too small", "WARN");
      deps.renderEditorState();
      return;
    }
    const mode = getCapturedOrEffectiveMode();
    const tmpMask = createMaskCanvas(doc.width, doc.height);
    rasterizePathToMask(tmpMask, doc.selectionPath);
    if (mode === "replace" || !doc.selectionMask) {
      doc.selectionMask = tmpMask;
    } else {
      combineMasks(doc.selectionMask, tmpMask, mode);
    }
    const maskBounds = maskBoundingRect(doc.selectionMask);
    doc.selectionRect = maskBounds;
    doc.selectionPath = null;
    doc.selectionShape = "rect";
    if (!maskBounds) {
      doc.selectionMask = null;
    }
    clearCapturedSelectionMode();
    deps.log("Lasso selection committed", "INFO");
    deps.showToast(`Lasso selection ${maskBounds?.width ?? 0}x${maskBounds?.height ?? 0}`, "info");
    deps.renderEditorState();
  }

  function toggleQuickMask() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("No document open", "error");
      return;
    }

    if (quickMaskActive) {
      if (quickMaskCanvas && !isMaskEmpty(quickMaskCanvas)) {
        doc.undoStack.push(deps.snapshotDocument(doc));
        doc.redoStack = [];
        doc.selectionMask = quickMaskCanvas;
        const bounds = maskBoundingRect(quickMaskCanvas);
        doc.selectionRect = bounds;
        doc.selectionShape = "rect";
        doc.selectionInverted = false;
        doc.selectionPath = null;
        doc.dirty = true;
        pushHistory(doc, "Quick mask to selection");
      }
      quickMaskCanvas = null;
      quickMaskActive = false;
      if (quickMaskSavedTool) {
        deps.setActiveTool(quickMaskSavedTool);
        quickMaskSavedTool = null;
      }
      deps.showToast("Quick mask off");
    } else {
      quickMaskCanvas = createMaskCanvas(doc.width, doc.height);
      if (doc.selectionMask) {
        quickMaskCanvas.getContext("2d")!.drawImage(doc.selectionMask, 0, 0);
      }
      quickMaskActive = true;
      quickMaskSavedTool = deps.getActiveTool();
      deps.setActiveTool("brush");
      deps.showToast("Quick mask on — paint to add/remove selection. Press Q to exit.");
    }
    deps.renderEditorState();
  }

  return {
    getEffectiveMarqueeMode,
    getCapturedOrEffectiveMode,
    getMarqueeModifiers,
    setMarqueeMode,
    setMarqueeSides,
    getMarqueeSides,
    updateMarqueeModeFromModifiers,
    captureSelectionMode,
    clearCapturedSelectionMode,
    getMagicWandTolerance,
    setMagicWandTolerance,
    isMagicWandContiguous,
    setMagicWandContiguous,
    isQuickMaskActive,
    getQuickMaskCanvas,
    getQuickMaskOverlay,
    clearSelection,
    selectEntireCanvas,
    invertSelection,
    magicWandSelect,
    completeLassoSelection,
    toggleQuickMask,
  };
}
