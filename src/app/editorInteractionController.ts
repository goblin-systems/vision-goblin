import { bindPaintControls as bindPaintControlsView } from "./bindings";
import { byId } from "./dom";
import { dispatchKeyboardEvent } from "../editor/commands";
import { clamp } from "../editor/utils";
import type { ToolName } from "../settings";
import type { BrushState, DocumentState, PointerState, ShapeKind } from "../editor/types";
import type { TransformMode } from "../editor/transformController";
import { closePalette, isPaletteOpen } from "../editor/commandPalette";

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 96;

export function isBrushCursorTool(tool: ToolName) {
  return tool === "brush"
    || tool === "eraser"
    || tool === "healing-brush"
    || tool === "clone-stamp"
    || tool === "smudge";
}

type ModifierState = {
  spacePressed: boolean;
  shiftPressed: boolean;
  ctrlPressed: boolean;
  altPressed: boolean;
};

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  return element.tagName === "INPUT"
    || element.tagName === "TEXTAREA"
    || element.tagName === "SELECT"
    || element.isContentEditable
    || element.contentEditable === "true";
}

export function shouldDispatchEditorShortcut(target: EventTarget | null, event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">) {
  void event;
  return !isEditableTarget(target);
}

export interface EditorInteractionControllerDeps {
  canvasStage: HTMLElement;
  getDocuments: () => DocumentState[];
  getActiveDocument: () => DocumentState | null;
  getActiveTool: () => ToolName;
  getPointerState: () => PointerState;
  swapPaletteColours?: () => void;
  getTransformDraft: () => object | null;
  ensureTransformDraftForActiveLayer: () => object | null;
  ensureTransformDraftForActiveLayerWithIntent?: (intent: "layer" | "text-layout") => object | null;
  updateTransformDraftInputs: () => void;
  commitTransformDraft: () => void;
  cancelTransformDraft: (showMessage?: boolean) => void;
  setTransformMode: (mode: TransformMode, announce?: boolean) => void;
  updateMarqueeModeFromModifiers: (ctrlKey: boolean, shiftKey: boolean, altKey: boolean) => void;
  clearSelection: (showMessage?: boolean) => void;
  deleteSelectedArea: () => void;
  completeLassoSelection: () => void;
  addPastedImageToActiveDocument: (name: string, blob: Blob) => Promise<void>;
  loadImageFromDrop: (file: File) => Promise<void>;
  setMagicWandTolerance: (value: number) => void;
  setMagicWandContiguous: (value: boolean) => void;
  renderEditorState: () => void;
  renderToolState: () => void;
  renderBrushUI: () => void;
  isAiMaskSessionActive?: () => boolean;
  completeAiMaskSession?: () => void;
  cancelAiMaskSession?: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export interface EditorInteractionController {
  bind: () => void;
  getBrushState: () => BrushState;
  setActiveColour: (colour: string) => void;
  adjustBrushSize: (delta: number) => number;
  getActiveShapeKind: () => ShapeKind;
  getModifierState: () => ModifierState;
}

export function createEditorInteractionController(deps: EditorInteractionControllerDeps): EditorInteractionController {
  let activeColour = "#6C63FF";
  let brushSize = 24;
  let brushOpacity = 1;
  let healingSampleSpread = 2.4;
  let healingBlend = 0.8;
  let activeShapeKind: ShapeKind = "rectangle";
  const modifierState: ModifierState = {
    spacePressed: false,
    shiftPressed: false,
    ctrlPressed: false,
    altPressed: false,
  };

  function getBrushState() {
    return { brushSize, brushOpacity, activeColour, healingSampleSpread, healingBlend };
  }

  function setActiveColour(colour: string) {
    activeColour = colour;
    deps.renderBrushUI();
  }

  function setBrushSize(value: number) {
    const nextBrushSize = clamp(Math.round(value), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
    if (nextBrushSize === brushSize) {
      return brushSize;
    }
    brushSize = nextBrushSize;
    deps.renderBrushUI();
    return brushSize;
  }

  function adjustBrushSize(delta: number) {
    return setBrushSize(brushSize + delta);
  }

  function getActiveShapeKind() {
    return activeShapeKind;
  }

  function getModifierState() {
    return { ...modifierState };
  }

  function bindClipboardAndKeyboard() {
    window.addEventListener("paste", (event) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      deps.log("Paste event received with image payload", "INFO");
      void deps.addPastedImageToActiveDocument(`Pasted ${deps.getDocuments().length + 1}.png`, file);
    });

    window.addEventListener("keydown", (event) => {
      if (isPaletteOpen() && event.key === "Escape") {
        event.preventDefault();
        closePalette();
        return;
      }
      if (isPaletteOpen()) return;

      deps.updateMarqueeModeFromModifiers(event.ctrlKey, event.shiftKey, event.altKey);
      if (deps.getActiveTool() === "transform") {
        deps.setTransformMode(event.altKey ? "rotate" : "scale", false);
      }

      if (event.code === "Space") {
        modifierState.spacePressed = true;
        deps.log("Space modifier engaged for panning", "INFO");
      }
      modifierState.shiftPressed = event.shiftKey;
      modifierState.ctrlPressed = event.ctrlKey;
      modifierState.altPressed = event.altKey;

      // Let input elements handle their own keyboard events (Delete, Enter, Escape, etc.)
      // Modified keys (Ctrl/Meta/Alt) still pass through for shortcuts like Ctrl+Z.
      const isInputFocused = isEditableTarget(event.target);
      if (isInputFocused) {
        return;
      }

      if (deps.isAiMaskSessionActive?.() && event.key === "Enter") {
        event.preventDefault();
        deps.completeAiMaskSession?.();
        return;
      }

      if (event.key === "Enter" && deps.getTransformDraft()) {
        event.preventDefault();
        deps.commitTransformDraft();
        return;
      }

      if (event.key === "Enter" && deps.getActiveTool() === "polygon-lasso") {
        const activeDoc = deps.getActiveDocument();
        if (activeDoc?.selectionPath && !activeDoc.selectionPath.closed && activeDoc.selectionPath.points.length >= 3) {
          event.preventDefault();
          deps.completeLassoSelection();
          return;
        }
      }

      if (event.key === "Escape") {
        if (deps.isAiMaskSessionActive?.()) {
          event.preventDefault();
          deps.cancelAiMaskSession?.();
          return;
        }
        if (deps.getTransformDraft()) {
          event.preventDefault();
          deps.cancelTransformDraft();
          return;
        }
        const activeDoc = deps.getActiveDocument();
        if (activeDoc?.selectionPath && !activeDoc.selectionPath.closed && (deps.getActiveTool() === "polygon-lasso" || deps.getActiveTool() === "lasso")) {
          event.preventDefault();
          activeDoc.selectionPath = null;
          activeDoc.selectionRect = null;
          deps.log("Lasso cancelled", "INFO");
          deps.showToast("Lasso cancelled", "info");
          deps.renderEditorState();
          return;
        }
        if (activeDoc?.selectionRect) {
          event.preventDefault();
          deps.clearSelection(true);
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const activeDoc = deps.getActiveDocument();
        if (activeDoc?.selectionRect) {
          event.preventDefault();
          if (deps.getTransformDraft()) {
            deps.commitTransformDraft();
          }
          deps.deleteSelectedArea();
          return;
        }
      }

      if (event.key === "x" && !event.ctrlKey && !event.metaKey && !event.altKey && shouldDispatchEditorShortcut(event.target, event)) {
        event.preventDefault();
        deps.swapPaletteColours?.();
        return;
      }

      if (shouldDispatchEditorShortcut(event.target, event)) {
        dispatchKeyboardEvent(event);
      }
    });

    window.addEventListener("keyup", (event) => {
      deps.updateMarqueeModeFromModifiers(event.ctrlKey, event.shiftKey, event.altKey);
      if (deps.getActiveTool() === "transform") {
        deps.setTransformMode(event.altKey ? "rotate" : "scale", false);
      }
      if (event.code === "Space") {
        modifierState.spacePressed = false;
        deps.log("Space modifier released", "INFO");
      }
      modifierState.shiftPressed = event.shiftKey;
      modifierState.ctrlPressed = event.ctrlKey;
      modifierState.altPressed = event.altKey;
    });

    window.addEventListener("blur", () => {
      deps.updateMarqueeModeFromModifiers(false, false, false);
      modifierState.spacePressed = false;
      modifierState.shiftPressed = false;
      modifierState.ctrlPressed = false;
      modifierState.altPressed = false;
    });
  }

  function bindDragAndDrop() {
    const prevent = (event: DragEvent) => {
      event.preventDefault();
    };

    deps.canvasStage.addEventListener("dragenter", prevent);
    deps.canvasStage.addEventListener("dragover", prevent);
    deps.canvasStage.addEventListener("drop", (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) {
        deps.log("Drag-drop rejected because payload was not an image", "WARN");
        deps.showToast("Drop an image file to open it");
        return;
      }
      deps.log(`Drag-drop image '${file.name}'`, "INFO");
      void deps.loadImageFromDrop(file);
    });
  }

  function bindToolSettingsInputs() {
    byId<HTMLInputElement>("magic-wand-tolerance-input").addEventListener("input", (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      deps.setMagicWandTolerance(value);
      byId<HTMLElement>("magic-wand-tolerance-label").textContent = `Tolerance: ${value}`;
    });
    byId<HTMLInputElement>("magic-wand-contiguous-checkbox").addEventListener("change", (event) => {
      deps.setMagicWandContiguous((event.currentTarget as HTMLInputElement).checked);
    });
  }

  function bindColourSwatches() {
    document.querySelectorAll<HTMLButtonElement>("[data-colour-swatch]").forEach((button) => {
      button.addEventListener("click", () => {
        activeColour = button.dataset.colourSwatch ?? activeColour;
        deps.renderBrushUI();
        deps.log(`Active colour set to ${activeColour}`, "INFO");
        deps.showToast(`Colour set to ${activeColour}`);
      });
    });
  }

  function bindPaintControls() {
    bindPaintControlsView(
      (value) => {
        setBrushSize(value);
      },
      (value) => {
        brushOpacity = value;
        deps.renderBrushUI();
      },
      deps.showToast,
    );

    byId<HTMLInputElement>("healing-sample-range").addEventListener("input", (event) => {
      healingSampleSpread = Number((event.currentTarget as HTMLInputElement).value) / 100;
      deps.renderBrushUI();
      deps.showToast(`Healing sample ${Math.round(healingSampleSpread * 100)}%`);
    });
    byId<HTMLInputElement>("healing-blend-range").addEventListener("input", (event) => {
      healingBlend = Number((event.currentTarget as HTMLInputElement).value) / 100;
      deps.renderBrushUI();
      deps.showToast(`Healing blend ${Math.round(healingBlend * 100)}%`);
    });
  }

  function bindTransformControls() {
    const inputIds = [
      "transform-scale-x-input",
      "transform-scale-y-input",
      "transform-rotate-input",
      "transform-skew-x-input",
      "transform-skew-y-input",
    ] as const;

    inputIds.forEach((id) => {
      byId<HTMLInputElement>(id).addEventListener("input", () => {
        const intent = deps.getActiveTool() === "text" ? "text-layout" : "layer";
        const draft = deps.ensureTransformDraftForActiveLayerWithIntent?.(intent) ?? deps.ensureTransformDraftForActiveLayer();
        if (!draft) {
          return;
        }
        deps.updateTransformDraftInputs();
        deps.renderEditorState();
      });
    });

    byId<HTMLButtonElement>("transform-apply-btn").addEventListener("click", () => {
      deps.commitTransformDraft();
    });
    byId<HTMLButtonElement>("transform-cancel-btn").addEventListener("click", () => {
      deps.cancelTransformDraft();
    });
  }

  function bindExpandedRasterEditingControls() {
    byId<HTMLSelectElement>("shape-kind-select").addEventListener("change", (event) => {
      activeShapeKind = (event.currentTarget as HTMLSelectElement).value as ShapeKind;
      deps.renderToolState();
    });
  }

  function bind() {
    bindClipboardAndKeyboard();
    bindDragAndDrop();
    bindToolSettingsInputs();
    bindColourSwatches();
    bindPaintControls();
    bindTransformControls();
    bindExpandedRasterEditingControls();
  }

  return {
    bind,
    getBrushState,
    setActiveColour,
    adjustBrushSize,
    getActiveShapeKind,
    getModifierState,
  };
}
