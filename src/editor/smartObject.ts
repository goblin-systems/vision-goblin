/**
 * Smart object layer support — embedded assets that can be non-destructively
 * transformed (scale, rotate) without degrading the original source pixels.
 *
 * Each smart object stores its original source image as a data URL and a
 * runtime sourceCanvas.  The display `layer.canvas` is re-rendered from the
 * source whenever the accumulated transform changes.
 */

import { createLayerCanvas, cloneCanvas, syncLayerSource, buildTransformMatrix } from "./documents";
import type { Layer, RasterLayer, SmartObjectLayer, SmartObjectLayerData } from "./types";
import { nextId } from "./utils";

// ---------------------------------------------------------------------------
// Create smart object layer from a source canvas
// ---------------------------------------------------------------------------

/**
 * Create a new SmartObjectLayer from a source canvas.
 * The source is cloned so the caller's canvas is not mutated.
 */
export function createSmartObjectLayer(
  name: string,
  source: HTMLCanvasElement,
  x = 0,
  y = 0,
): SmartObjectLayer {
  const sourceCanvas = cloneCanvas(source);
  const layer: SmartObjectLayer = {
    id: nextId("layer"),
    type: "smart-object",
    name,
    canvas: cloneCanvas(sourceCanvas), // display canvas — initially identical to source
    sourceCanvas: cloneCanvas(sourceCanvas),
    x,
    y,
    visible: true,
    opacity: 1,
    locked: false,
    effects: [],
    smartObjectData: {
      sourceDataUrl: sourceCanvas.toDataURL("image/png"),
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      sourceCanvas,
    },
  };
  return layer;
}

// ---------------------------------------------------------------------------
// Render — rebuild layer.canvas from source + accumulated transform
// ---------------------------------------------------------------------------

/** Re-render the smart object's display canvas from its source and transform. */
export function renderSmartObjectLayer(layer: SmartObjectLayer): void {
  const data = layer.smartObjectData;
  const source = data.sourceCanvas;
  if (!source) return;

  // Identity transform — just clone the source directly
  if (
    Math.abs(data.scaleX - 1) < 0.001 &&
    Math.abs(data.scaleY - 1) < 0.001 &&
    Math.abs(data.rotateDeg) < 0.001
  ) {
    layer.canvas = cloneCanvas(source);
    syncLayerSource(layer);
    return;
  }

  // Build transform matrix using the same utility as the transform tool
  const matrix = buildTransformMatrix({
    scaleX: data.scaleX,
    scaleY: data.scaleY,
    rotateDeg: data.rotateDeg,
    skewXDeg: 0,
    skewYDeg: 0,
  });

  const sw = source.width;
  const sh = source.height;
  const halfW = sw / 2;
  const halfH = sh / 2;

  // Compute bounding box of the four rotated/scaled corners (centred at origin)
  const corners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: -halfW, y: halfH },
    { x: halfW, y: halfH },
  ].map((p) => ({
    x: matrix.a * p.x + matrix.c * p.y,
    y: matrix.b * p.x + matrix.d * p.y,
  }));

  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));

  const outW = Math.max(1, Math.ceil(maxX - minX));
  const outH = Math.max(1, Math.ceil(maxY - minY));

  const canvas = createLayerCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, outW / 2, outH / 2);
    ctx.drawImage(source, -halfW, -halfH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  layer.canvas = canvas;
  syncLayerSource(layer);
}

// ---------------------------------------------------------------------------
// Convert raster → smart object
// ---------------------------------------------------------------------------

/**
 * Convert a raster layer into a smart object layer in-place (replaces the
 * layer in `doc.layers`).  Returns the new smart object layer.
 */
export function convertToSmartObject(
  layers: Layer[],
  layerId: string,
): SmartObjectLayer | null {
  const index = layers.findIndex((l) => l.id === layerId);
  if (index === -1) return null;
  const old = layers[index];
  if (old.type !== "raster") return null;

  const source = cloneCanvas(old.canvas);
  const smartLayer: SmartObjectLayer = {
    id: old.id, // keep same ID so references stay valid
    type: "smart-object",
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
    smartObjectData: {
      sourceDataUrl: source.toDataURL("image/png"),
      sourceWidth: source.width,
      sourceHeight: source.height,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      sourceCanvas: source,
    },
  };
  layers[index] = smartLayer;
  return smartLayer;
}

// ---------------------------------------------------------------------------
// Rasterize smart object → raster
// ---------------------------------------------------------------------------

/**
 * Rasterize a smart object back into a plain raster layer (destructive).
 * The current display canvas becomes the raster content.
 */
export function rasterizeSmartObject(
  layers: Layer[],
  layerId: string,
): RasterLayer | null {
  const index = layers.findIndex((l) => l.id === layerId);
  if (index === -1) return null;
  const old = layers[index];
  if (old.type !== "smart-object") return null;

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

// ---------------------------------------------------------------------------
// Replace source
// ---------------------------------------------------------------------------

/**
 * Replace the source image of a smart object layer with a new canvas.
 * The display canvas is re-rendered with the current transform applied to
 * the new source.
 */
export function replaceSmartObjectSource(
  layer: SmartObjectLayer,
  newSource: HTMLCanvasElement,
): void {
  const source = cloneCanvas(newSource);
  layer.smartObjectData.sourceCanvas = source;
  layer.smartObjectData.sourceDataUrl = source.toDataURL("image/png");
  layer.smartObjectData.sourceWidth = source.width;
  layer.smartObjectData.sourceHeight = source.height;
  renderSmartObjectLayer(layer);
}
