import { createLayerThumb } from "./documents";
import { canDeleteLayer } from "./layers";
import type { DocumentState } from "./types";

interface LayerListActions {
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onMoveUp: (layerId: string) => void;
  onMoveDown: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onRename: (layerId: string) => void;
  onDuplicate: (layerId: string) => void;
  onDelete: (layerId: string) => void;
  onDebug?: (message: string) => void;
}

function bindLayerAction(button: HTMLButtonElement, handler: () => void) {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
}

function createActionButton(icon: string, label: string, handler: () => void, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn icon-btn-sm layer-action-btn";
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.actionLabel = label;
  button.disabled = disabled;
  bindLayerAction(button, handler);
  return button;
}

export function renderLayerList(layerList: HTMLElement, doc: DocumentState, actions: LayerListActions) {
  layerList.innerHTML = "";

  [...doc.layers].reverse().forEach((layer) => {
    const row = document.createElement("div");
    row.className = `layer-row${layer.id === doc.activeLayerId ? " is-active" : ""}`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.dataset.layerId = layer.id;
    row.addEventListener("click", () => actions.onSelect(layer.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        actions.onSelect(layer.id);
      }
    });

    const top = document.createElement("div");
    top.className = "layer-row-top";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "layer-thumb";
    thumbWrap.appendChild(createLayerThumb(layer));
    top.appendChild(thumbWrap);

    const label = document.createElement("strong");
    label.className = "layer-name";
    label.textContent = layer.name;
    top.appendChild(label);

    const flags = document.createElement("span");
    flags.className = `badge ${layer.isBackground ? "default" : layer.locked ? "beta" : "success"}`;
    flags.textContent = layer.isBackground ? "base" : layer.locked ? "locked" : "layer";
    top.appendChild(flags);
    row.appendChild(top);

    const meta = document.createElement("span");
    meta.className = "layer-meta";
    meta.textContent = `${Math.round(layer.opacity * 100)}% opacity - ${layer.x}, ${layer.y}`;
    row.appendChild(meta);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "layer-row-actions";
    actionsWrap.addEventListener("click", (event) => event.stopPropagation());

    const visibility = createActionButton(layer.visible ? "eye-off" : "eye", layer.visible ? "Hide layer" : "Show layer", () => {
      actions.onDebug?.(`layer button clicked: visibility ${layer.id}`);
      actions.onToggleVisibility(layer.id);
    });
    actionsWrap.appendChild(visibility);

    const up = createActionButton(
      "arrow-up",
      "Move layer up",
      () => {
      actions.onDebug?.(`layer button clicked: up ${layer.id}`);
      actions.onMoveUp(layer.id);
      },
      doc.layers.findIndex((item) => item.id === layer.id) === doc.layers.length - 1 || !!layer.isBackground
    );
    actionsWrap.appendChild(up);

    const down = createActionButton(
      "arrow-down",
      "Move layer down",
      () => {
      actions.onDebug?.(`layer button clicked: down ${layer.id}`);
      actions.onMoveDown(layer.id);
      },
      doc.layers.findIndex((item) => item.id === layer.id) <= 1 || !!layer.isBackground
    );
    actionsWrap.appendChild(down);

    const lock = createActionButton(layer.locked ? "lock-open" : "lock", layer.locked ? "Unlock layer" : "Lock layer", () => {
      actions.onDebug?.(`layer button clicked: lock ${layer.id}`);
      actions.onToggleLock(layer.id);
    });
    actionsWrap.appendChild(lock);

    const rename = createActionButton("pencil", "Rename layer", () => {
      actions.onDebug?.(`layer button clicked: rename ${layer.id}`);
      actions.onRename(layer.id);
    });
    actionsWrap.appendChild(rename);

    const duplicate = createActionButton("copy", "Duplicate layer", () => {
      actions.onDebug?.(`layer button clicked: duplicate ${layer.id}`);
      actions.onDuplicate(layer.id);
    });
    actionsWrap.appendChild(duplicate);

    const remove = createActionButton("trash-2", "Delete layer", () => {
      actions.onDebug?.(`layer button clicked: delete ${layer.id}`);
      actions.onDelete(layer.id);
    }, !canDeleteLayer(doc, layer));
    actionsWrap.appendChild(remove);

    row.appendChild(actionsWrap);
    layerList.appendChild(row);
  });
}
