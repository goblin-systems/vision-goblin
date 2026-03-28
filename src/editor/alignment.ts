/**
 * Alignment & Distribution — operates on a set of layers within a document.
 *
 * All functions modify layer positions in-place and return `true` when at least
 * one layer was moved. The caller is responsible for pushing undo snapshots
 * and triggering re-renders.
 *
 * Alignment targets:
 * - "selection" (default): align relative to the bounding box of the selected layers
 * - "canvas": align relative to the document canvas (0,0 → width,height)
 */

import type { DocumentState, Layer, Rect } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type AlignTarget = "selection" | "canvas";

export interface LayerBounds {
  layer: Layer;
  x: number;
  y: number;
  w: number;
  h: number;
}

function getLayerBounds(layer: Layer): LayerBounds {
  return {
    layer,
    x: layer.x,
    y: layer.y,
    w: layer.canvas.width,
    h: layer.canvas.height,
  };
}

function resolveLayers(doc: DocumentState, layerIds: string[]): Layer[] {
  return layerIds
    .map((id) => doc.layers.find((l) => l.id === id))
    .filter((l): l is Layer => l != null && !l.locked && !l.isBackground);
}

function selectionBounds(layers: LayerBounds[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of layers) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getTargetRect(doc: DocumentState, bounds: LayerBounds[], target: AlignTarget): Rect {
  if (target === "canvas") {
    return { x: 0, y: 0, width: doc.width, height: doc.height };
  }
  return selectionBounds(bounds);
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export function alignLeft(doc: DocumentState, layerIds: string[], target: AlignTarget = "selection"): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length === 0) return false;
  const bounds = layers.map(getLayerBounds);
  const rect = getTargetRect(doc, bounds, target);
  let moved = false;
  for (const b of bounds) {
    if (b.layer.x !== rect.x) {
      b.layer.x = rect.x;
      moved = true;
    }
  }
  return moved;
}

export function alignRight(doc: DocumentState, layerIds: string[], target: AlignTarget = "selection"): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length === 0) return false;
  const bounds = layers.map(getLayerBounds);
  const rect = getTargetRect(doc, bounds, target);
  const rightEdge = rect.x + rect.width;
  let moved = false;
  for (const b of bounds) {
    const newX = rightEdge - b.w;
    if (b.layer.x !== newX) {
      b.layer.x = newX;
      moved = true;
    }
  }
  return moved;
}

export function alignTop(doc: DocumentState, layerIds: string[], target: AlignTarget = "selection"): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length === 0) return false;
  const bounds = layers.map(getLayerBounds);
  const rect = getTargetRect(doc, bounds, target);
  let moved = false;
  for (const b of bounds) {
    if (b.layer.y !== rect.y) {
      b.layer.y = rect.y;
      moved = true;
    }
  }
  return moved;
}

export function alignBottom(doc: DocumentState, layerIds: string[], target: AlignTarget = "selection"): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length === 0) return false;
  const bounds = layers.map(getLayerBounds);
  const rect = getTargetRect(doc, bounds, target);
  const bottomEdge = rect.y + rect.height;
  let moved = false;
  for (const b of bounds) {
    const newY = bottomEdge - b.h;
    if (b.layer.y !== newY) {
      b.layer.y = newY;
      moved = true;
    }
  }
  return moved;
}

export function alignCenterH(doc: DocumentState, layerIds: string[], target: AlignTarget = "selection"): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length === 0) return false;
  const bounds = layers.map(getLayerBounds);
  const rect = getTargetRect(doc, bounds, target);
  const centerX = rect.x + rect.width / 2;
  let moved = false;
  for (const b of bounds) {
    const newX = Math.round(centerX - b.w / 2);
    if (b.layer.x !== newX) {
      b.layer.x = newX;
      moved = true;
    }
  }
  return moved;
}

export function alignCenterV(doc: DocumentState, layerIds: string[], target: AlignTarget = "selection"): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length === 0) return false;
  const bounds = layers.map(getLayerBounds);
  const rect = getTargetRect(doc, bounds, target);
  const centerY = rect.y + rect.height / 2;
  let moved = false;
  for (const b of bounds) {
    const newY = Math.round(centerY - b.h / 2);
    if (b.layer.y !== newY) {
      b.layer.y = newY;
      moved = true;
    }
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Distribution — evenly spaces layers between the outermost two
// ---------------------------------------------------------------------------

export function distributeH(doc: DocumentState, layerIds: string[]): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length < 3) return false;
  const bounds = layers.map(getLayerBounds).sort((a, b) => a.x - b.x);
  const first = bounds[0];
  const last = bounds[bounds.length - 1];
  const totalSpace = (last.x + last.w) - first.x;
  const totalWidth = bounds.reduce((sum, b) => sum + b.w, 0);
  const gap = (totalSpace - totalWidth) / (bounds.length - 1);
  let cursor = first.x + first.w + gap;
  let moved = false;
  for (let i = 1; i < bounds.length - 1; i++) {
    const newX = Math.round(cursor);
    if (bounds[i].layer.x !== newX) {
      bounds[i].layer.x = newX;
      moved = true;
    }
    cursor += bounds[i].w + gap;
  }
  return moved;
}

export function distributeV(doc: DocumentState, layerIds: string[]): boolean {
  const layers = resolveLayers(doc, layerIds);
  if (layers.length < 3) return false;
  const bounds = layers.map(getLayerBounds).sort((a, b) => a.y - b.y);
  const first = bounds[0];
  const last = bounds[bounds.length - 1];
  const totalSpace = (last.y + last.h) - first.y;
  const totalHeight = bounds.reduce((sum, b) => sum + b.h, 0);
  const gap = (totalSpace - totalHeight) / (bounds.length - 1);
  let cursor = first.y + first.h + gap;
  let moved = false;
  for (let i = 1; i < bounds.length - 1; i++) {
    const newY = Math.round(cursor);
    if (bounds[i].layer.y !== newY) {
      bounds[i].layer.y = newY;
      moved = true;
    }
    cursor += bounds[i].h + gap;
  }
  return moved;
}
