import { closeModal, confirmModal, openModal } from "@goblin-systems/goblin-design-system";
import { byId } from "./dom";
import { renderLayerList } from "../editor/layerList";
import { renderHistory as renderHistoryView } from "../editor/render";
import {
  deleteLayer as deleteLayerAction,
  duplicateLayer as duplicateLayerAction,
  moveLayer as moveLayerAction,
  rangeSelectLayers,
  renameLayer as renameLayerAction,
  selectLayer,
  toggleLayerLock,
  toggleLayerMultiSelect,
  toggleLayerVisibility,
} from "../editor/layers";
import type { DocumentState } from "../editor/types";

export function isLayerDeletionBlocked(doc: DocumentState, layerId: string) {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) {
    return { blocked: true, reason: "missing" as const, layer: null };
  }
  if (layer.isBackground || doc.layers.length <= 1) {
    return { blocked: true, reason: "protected" as const, layer };
  }
  return { blocked: false, reason: null, layer };
}

export function shouldCancelTransformAfterVisibilityToggle(layerVisible: boolean, activeTransformLayerId: string | null, toggledLayerId: string) {
  return activeTransformLayerId === toggledLayerId && !layerVisible;
}

interface LayerNamePromptDeps {
  modalId: string;
  inputId: string;
  submitButtonId: string;
  entityName: string;
  currentName: string;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

function requestName(deps: LayerNamePromptDeps): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = byId<HTMLElement>(deps.modalId);
    const input = byId<HTMLInputElement>(deps.inputId);
    const submitBtn = byId<HTMLButtonElement>(deps.submitButtonId);

    input.value = deps.currentName;

    let settled = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
    };
    const cleanup = () => {
      submitBtn.removeEventListener("click", onSubmit);
      input.removeEventListener("keydown", onKeyDown);
    };
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onSubmit = () => {
      const nextName = input.value.trim();
      if (!nextName) {
        deps.showToast(`${deps.entityName} name cannot be empty`, "error");
        input.focus();
        return;
      }
      closeModal({ backdrop });
      finish(nextName);
    };

    submitBtn.addEventListener("click", onSubmit);
    input.addEventListener("keydown", onKeyDown);
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(null),
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

export interface LayerPanelControllerDeps {
  getActiveDocument: () => DocumentState | null;
  clearMaskEditTarget: () => void;
  getConfirmLayerDeletion: () => boolean;
  getActiveTransformLayerId: () => string | null;
  cancelTransformDraft: (showMessage?: boolean) => void;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export interface LayerPanelController {
  renderLayers: (doc: DocumentState) => void;
  renderHistory: (doc: DocumentState) => void;
  requestCanvasName: (currentName: string) => Promise<string | null>;
}

export function createLayerPanelController(deps: LayerPanelControllerDeps): LayerPanelController {
  function moveLayer(doc: DocumentState, layerId: string, direction: -1 | 1) {
    if (moveLayerAction(doc, layerId, direction)) {
      deps.log(`Moved layer '${layerId}' ${direction > 0 ? "up" : "down"}`, "INFO");
      deps.renderEditorState();
    } else {
      deps.log(`Failed to move layer '${layerId}'`, "WARN");
    }
  }

  function duplicateLayer(doc: DocumentState, layerId: string) {
    if (duplicateLayerAction(doc, layerId)) {
      deps.renderEditorState();
    }
  }

  async function renameLayer(doc: DocumentState, layerId: string) {
    const layer = doc.layers.find((item) => item.id === layerId);
    if (!layer) return;
    const nextName = await requestName({
      modalId: "rename-layer-modal",
      inputId: "rename-layer-input",
      submitButtonId: "rename-layer-submit-btn",
      entityName: "Layer",
      currentName: layer.name,
      showToast: deps.showToast,
    });
    if (!nextName) return;
    if (renameLayerAction(doc, layerId, nextName)) {
      deps.log(`Renamed layer '${layerId}' to '${nextName}'`, "INFO");
      deps.showToast(`Renamed layer to ${nextName}`);
      deps.renderEditorState();
    } else {
      deps.log(`Failed to rename layer '${layerId}'`, "WARN");
    }
  }

  async function deleteLayer(doc: DocumentState, layerId: string) {
    const blocked = isLayerDeletionBlocked(doc, layerId);
    if (blocked.blocked) {
      if (blocked.reason === "protected") {
        deps.log(`Failed to delete layer '${layerId}' (protected)`, "WARN");
        deps.showToast("Background layer cannot be deleted", "error");
      }
      return;
    }
    if (deps.getConfirmLayerDeletion()) {
      const layer = blocked.layer;
      if (!layer) {
        return;
      }
      const confirmed = await confirmModal({
        title: `Delete ${layer.name}?`,
        message: "This permanently removes the layer from the current document.",
        acceptLabel: "Delete layer",
        rejectLabel: "Cancel",
        variant: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    const result = deleteLayerAction(doc, layerId);
    if (!result.ok) {
      deps.log(`Failed to delete layer '${layerId}' (${result.reason ?? "unknown"})`, "WARN");
      deps.showToast("Could not delete layer", "error");
      return;
    }
    deps.renderEditorState();
    deps.log(`Deleted layer '${layerId}' (${result.deletedName})`, "INFO");
    deps.showToast(`Deleted ${result.deletedName}`);
  }

  function renderLayers(doc: DocumentState) {
    renderLayerList(byId<HTMLElement>("layer-list"), doc, {
      onSelect: (layerId, event) => {
        const activeDoc = deps.getActiveDocument() ?? doc;
        if (event.ctrlKey) {
          if (toggleLayerMultiSelect(activeDoc, layerId)) {
            deps.clearMaskEditTarget();
            deps.log(`Multi-toggled layer '${layerId}'`, "INFO");
            deps.renderEditorState();
          }
          return;
        }
        if (event.shiftKey) {
          if (rangeSelectLayers(activeDoc, layerId)) {
            deps.clearMaskEditTarget();
            deps.log(`Range-selected to layer '${layerId}'`, "INFO");
            deps.renderEditorState();
          }
          return;
        }
        if (selectLayer(activeDoc, layerId)) {
          deps.clearMaskEditTarget();
          deps.log(`Selected layer '${layerId}'`, "INFO");
          deps.renderEditorState();
        } else {
          deps.log(`Failed to select layer '${layerId}'`, "WARN");
        }
      },
      onToggleVisibility: (layerId) => {
        const activeDoc = deps.getActiveDocument() ?? doc;
        if (toggleLayerVisibility(activeDoc, layerId)) {
          const toggledLayer = activeDoc.layers.find((item) => item.id === layerId);
          if (toggledLayer && shouldCancelTransformAfterVisibilityToggle(toggledLayer.visible, deps.getActiveTransformLayerId(), layerId)) {
            deps.cancelTransformDraft(false);
          }
          deps.log(`Toggled visibility for layer '${layerId}'`, "INFO");
          deps.renderEditorState();
        } else {
          deps.log(`Failed to toggle visibility for layer '${layerId}'`, "WARN");
        }
      },
      onMoveUp: (layerId) => {
        moveLayer(deps.getActiveDocument() ?? doc, layerId, 1);
      },
      onMoveDown: (layerId) => {
        moveLayer(deps.getActiveDocument() ?? doc, layerId, -1);
      },
      onToggleLock: (layerId) => {
        const activeDoc = deps.getActiveDocument() ?? doc;
        if (toggleLayerLock(activeDoc, layerId)) {
          deps.log(`Toggled lock for layer '${layerId}'`, "INFO");
          deps.renderEditorState();
        } else {
          deps.log(`Failed to toggle lock for layer '${layerId}'`, "WARN");
        }
      },
      onRename: (layerId) => {
        void renameLayer(deps.getActiveDocument() ?? doc, layerId);
      },
      onDuplicate: (layerId) => {
        duplicateLayer(deps.getActiveDocument() ?? doc, layerId);
      },
      onDelete: (layerId) => {
        void deleteLayer(deps.getActiveDocument() ?? doc, layerId);
      },
      onDebug: (message) => {
        deps.log(message, "INFO");
      },
    });
  }

  function renderHistory(doc: DocumentState) {
    renderHistoryView(byId<HTMLElement>("history-list"), doc);
  }

  function requestCanvasName(currentName: string) {
    return requestName({
      modalId: "rename-canvas-modal",
      inputId: "rename-canvas-input",
      submitButtonId: "rename-canvas-submit-btn",
      entityName: "Canvas",
      currentName,
      showToast: deps.showToast,
    });
  }

  return {
    renderLayers,
    renderHistory,
    requestCanvasName,
  };
}
