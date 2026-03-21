import { pushHistory } from "./history";
import type { DocumentState, RasterLayer } from "./types";
import { cloneLayer, createLayerCanvas, fillLayer, snapshotDocument } from "./documents";
import { nextId } from "./utils";

export function canDeleteLayer(doc: DocumentState, layer: RasterLayer): boolean {
  return !layer.isBackground && doc.layers.length > 1;
}

export function addLayer(doc: DocumentState, name?: string): RasterLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  const layer: RasterLayer = {
    id: nextId("layer"),
    name: name ?? `Layer ${doc.layers.length + 1}`,
    canvas: createLayerCanvas(doc.width, doc.height),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
  };

  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function moveLayer(doc: DocumentState, layerId: string, direction: -1 | 1): boolean {
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return false;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= doc.layers.length) return false;
  if (doc.layers[index].isBackground || doc.layers[nextIndex].isBackground) return false;

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const [layer] = doc.layers.splice(index, 1);
  doc.layers.splice(nextIndex, 0, layer);
  pushHistory(doc, `Reordered ${layer.name}`);
  return true;
}

export function duplicateLayer(doc: DocumentState, layerId: string): RasterLayer | null {
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return null;

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const duplicate = cloneLayer(doc.layers[index]);
  duplicate.name = `${doc.layers[index].name} Copy`;
  doc.layers.splice(index + 1, 0, duplicate);
  doc.activeLayerId = duplicate.id;
  pushHistory(doc, `Duplicated ${doc.layers[index].name}`);
  return duplicate;
}

export function renameLayer(doc: DocumentState, layerId: string, nextName: string): boolean {
  const layer = doc.layers.find((item) => item.id === layerId);
  const normalized = nextName.trim();
  if (!layer || !normalized || normalized === layer.name) return false;

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.name = normalized;
  pushHistory(doc, `Renamed layer to ${normalized}`);
  return true;
}

export function deleteLayer(doc: DocumentState, layerId: string): { ok: boolean; deletedName?: string; reason?: string } {
  const index = doc.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return { ok: false, reason: "not-found" };
  const layer = doc.layers[index];
  if (!canDeleteLayer(doc, layer)) {
    return { ok: false, reason: "protected" };
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  doc.layers.splice(index, 1);
  doc.activeLayerId = doc.layers[Math.max(0, index - 1)]?.id ?? doc.layers[0].id;
  pushHistory(doc, `Deleted ${layer.name}`);
  return { ok: true, deletedName: layer.name };
}

export function toggleLayerVisibility(doc: DocumentState, layerId: string): boolean {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) return false;
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.visible = !layer.visible;
  pushHistory(doc, `${layer.visible ? "Showed" : "Hid"} ${layer.name}`);
  return true;
}

export function toggleLayerLock(doc: DocumentState, layerId: string): boolean {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) return false;
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.locked = !layer.locked;
  pushHistory(doc, `${layer.locked ? "Locked" : "Unlocked"} ${layer.name}`);
  return true;
}

export function setBackgroundLayerColor(doc: DocumentState, color: string): boolean {
  const backgroundLayer = doc.layers[0];
  if (!backgroundLayer?.isBackground) return false;
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  fillLayer(backgroundLayer, color);
  pushHistory(doc, "Changed background colour");
  return true;
}

export function selectLayer(doc: DocumentState, layerId: string): boolean {
  const exists = doc.layers.some((layer) => layer.id === layerId);
  if (!exists) return false;
  doc.activeLayerId = layerId;
  return true;
}
