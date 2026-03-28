import { pushHistory } from "./history";
import type { AdjustmentKind, AdjustmentLayer, DocumentState, Layer, RasterLayer, ShapeKind, ShapeLayer, SmartObjectLayer, TextLayer, TextLayerData } from "./types";
import { cloneCanvas, cloneLayer, createAdjustmentLayer, createLayerCanvas, createShapeLayer, createTextLayer, fillLayer, snapshotDocument } from "./documents";
import { defaultParamsForKind, ADJUSTMENT_LABELS } from "./adjustmentLayers";
import { createSmartObjectLayer } from "./smartObject";
import { nextId } from "./utils";

export function canDeleteLayer(doc: DocumentState, layer: Layer): boolean {
  return !layer.isBackground && doc.layers.length > 1;
}

export function addLayer(doc: DocumentState, name?: string): RasterLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];

  const layer: RasterLayer = {
    id: nextId("layer"),
    type: "raster",
    name: name ?? `Layer ${doc.layers.length + 1}`,
    canvas: createLayerCanvas(doc.width, doc.height),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    effects: [],
  };

  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addTextLayer(doc: DocumentState, x: number, y: number, name?: string, overrides: Partial<TextLayerData> = {}): TextLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const layer = createTextLayer(name ?? `Text ${doc.layers.length}`, x, y, overrides);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addShapeLayer(doc: DocumentState, kind: ShapeKind, x: number, y: number, name?: string): ShapeLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const label = kind === "rectangle" ? "Rectangle" : kind === "ellipse" ? "Ellipse" : "Line";
  const layer = createShapeLayer(name ?? `${label} ${doc.layers.length}`, kind, x, y);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addAdjustmentLayer(doc: DocumentState, kind: AdjustmentKind, name?: string): AdjustmentLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const label = name ?? `${ADJUSTMENT_LABELS[kind]} ${doc.layers.length}`;
  const layer = createAdjustmentLayer(label, { kind, params: defaultParamsForKind(kind) });
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  pushHistory(doc, `Added ${layer.name}`);
  return layer;
}

export function addSmartObjectLayer(doc: DocumentState, source: HTMLCanvasElement, x = 0, y = 0, name?: string): SmartObjectLayer {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const layer = createSmartObjectLayer(name ?? `Smart Object ${doc.layers.length}`, source, x, y);
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

export function duplicateLayer(doc: DocumentState, layerId: string): Layer | null {
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
  doc.selectedLayerIds = [];
  return true;
}

/**
 * Toggle a layer in/out of the multi-selection (Ctrl+click).
 * The active layer always stays selected. If the toggled layer was the active
 * layer and it's being removed from multi-select, we just ignore (keep it).
 */
export function toggleLayerMultiSelect(doc: DocumentState, layerId: string): boolean {
  const exists = doc.layers.some((layer) => layer.id === layerId);
  if (!exists) return false;

  // Bootstrap: if selectedLayerIds is empty, seed it with the current active layer
  if (doc.selectedLayerIds.length === 0) {
    doc.selectedLayerIds = [doc.activeLayerId];
  }

  const idx = doc.selectedLayerIds.indexOf(layerId);
  if (idx >= 0) {
    // Deselect — but don't remove the active layer from the list
    if (layerId === doc.activeLayerId) return false;
    doc.selectedLayerIds.splice(idx, 1);
    // If only 1 left, collapse back to single-select
    if (doc.selectedLayerIds.length <= 1) {
      doc.activeLayerId = doc.selectedLayerIds[0] ?? doc.activeLayerId;
      doc.selectedLayerIds = [];
    }
  } else {
    // Add to multi-select
    doc.selectedLayerIds.push(layerId);
    doc.activeLayerId = layerId;
  }
  return true;
}

/**
 * Extend multi-selection to a range (Shift+click).
 * Selects all layers between the current active layer and the clicked layer.
 */
export function rangeSelectLayers(doc: DocumentState, layerId: string): boolean {
  const targetIdx = doc.layers.findIndex((l) => l.id === layerId);
  const activeIdx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
  if (targetIdx < 0 || activeIdx < 0) return false;

  const lo = Math.min(targetIdx, activeIdx);
  const hi = Math.max(targetIdx, activeIdx);
  doc.selectedLayerIds = doc.layers.slice(lo, hi + 1).map((l) => l.id);
  // Keep activeLayerId as the clicked layer
  doc.activeLayerId = layerId;
  return true;
}

/**
 * Return the effective set of selected layer IDs.
 * If multi-select is active returns that list, otherwise returns just the active layer.
 */
export function getSelectedLayerIds(doc: DocumentState): string[] {
  return doc.selectedLayerIds.length > 0 ? doc.selectedLayerIds : [doc.activeLayerId];
}

/**
 * Rasterize any non-raster layer (text, shape, smart-object) into a plain
 * raster layer. The current display canvas becomes the raster content.
 * Adjustment layers cannot be rasterized.
 * Returns the new raster layer, or null if the layer can't be rasterized.
 */
export function rasterizeLayer(
  layers: Layer[],
  layerId: string,
): RasterLayer | null {
  const index = layers.findIndex((l) => l.id === layerId);
  if (index === -1) return null;
  const old = layers[index];
  if (old.type === "raster" || old.type === "adjustment") return null;

  const rasterLayer: RasterLayer = {
    id: old.id,
    type: "raster",
    name: old.name,
    canvas: cloneCanvas(old.canvas),
    sourceCanvas: cloneCanvas(old.canvas),
    x: old.x,
    y: old.y,
    visible: old.visible,
    opacity: old.opacity,
    locked: old.locked,
    isBackground: old.isBackground,
    fillColor: old.fillColor,
    effects: old.effects ? [...old.effects] : [],
    mask: old.mask ? cloneCanvas(old.mask) : undefined,
  };
  layers[index] = rasterLayer;
  return rasterLayer;
}
