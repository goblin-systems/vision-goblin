import { bindPaintControls as bindPaintControlsView } from "./bindings";
import { byId } from "./dom";
import { dispatchKeyboardEvent } from "../editor/commands";
import type { ToolName } from "../settings";
import type { DocumentState, PointerState, ShapeKind } from "../editor/types";
import type { TransformMode } from "../editor/transformController";
import { closePalette, isPaletteOpen } from "../editor/commandPalette";

type ModifierState = {
  spacePressed: boolean;
  shiftPressed: boolean;
  ctrlPressed: boolean;
  altPressed: boolean;
};

export function shouldDispatchEditorShortcut(target: EventTarget | null, event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">) {
  const element = target as HTMLElement | null;
  if (!element) {
    return true;
  }
  const isInput = element.tagName === "INPUT"
    || element.tagName === "TEXTAREA"
    || element.tagName === "SELECT"
    || element.isContentEditable;
  const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
  return !isInput || hasModifier;
}

export interface EditorInteractionControllerDeps {
  canvasStage: HTMLElement;
  getDocuments: () => DocumentState[];
  getActiveDocument: () => DocumentState | null;
  getActiveTool: () => ToolName;
  getPointerState: () => PointerState;
  getTransformDraft: () => object | null;
  ensureTransformDraftForActiveLayer: () => object | null;
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
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export interface EditorInteractionController {
  bind: () => void;
  getBrushState: () => { brushSize: number; brushOpacity: number; activeColour: string };
  setActiveColour: (colour: string) => void;
  getActiveShapeKind: () => ShapeKind;
  getModifierState: () => ModifierState;
}

export function createEditorInteractionController(deps: EditorInteractionControllerDeps): EditorInteractionController {
  let activeColour = "#6C63FF";
  let brushSize = 24;
  let brushOpacity = 1;
  let activeShapeKind: ShapeKind = "rectangle";
  const modifierState: ModifierState = {
    spacePressed: false,
    shiftPressed: false,
    ctrlPressed: false,
    altPressed: false,
  };

  function getBrushState() {
    return { brushSize, brushOpacity, activeColour };
  }

  function setActiveColour(colour: string) {
    activeColour = colour;
    deps.renderBrushUI();
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
      const el = event.target instanceof HTMLElement ? event.target : null;
      const isInputFocused = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable === true || el?.contentEditable === "true";
      if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
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
        brushSize = value;
      },
      (value) => {
        brushOpacity = value;
      },
      deps.showToast,
    );
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
        const draft = deps.ensureTransformDraftForActiveLayer();
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
    getActiveShapeKind,
    getModifierState,
  };
}
