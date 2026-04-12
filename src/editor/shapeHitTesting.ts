import type { DocumentState, Layer, RasterLayer, ShapeLayer, SmartObjectLayer, TextLayer } from "./types";

type PixelBackedLayer = RasterLayer | TextLayer | ShapeLayer | SmartObjectLayer;

function isPointInsideLayerBounds(layer: PixelBackedLayer, docX: number, docY: number) {
  return docX >= layer.x
    && docY >= layer.y
    && docX < layer.x + layer.canvas.width
    && docY < layer.y + layer.canvas.height;
}

export function isPixelBackedLayer(layer: Layer): layer is PixelBackedLayer {
  return layer.type === "raster"
    || layer.type === "text"
    || layer.type === "shape"
    || layer.type === "smart-object";
}

export function hitTestPixelBackedLayer(layer: PixelBackedLayer, docX: number, docY: number, alphaThreshold = 1) {
  if (!isPointInsideLayerBounds(layer, docX, docY)) {
    return false;
  }
  const ctx = layer.canvas.getContext("2d");
  if (!ctx) {
    return false;
  }
  const localX = Math.floor(docX - layer.x);
  const localY = Math.floor(docY - layer.y);
  return ctx.getImageData(localX, localY, 1, 1).data[3] >= alphaThreshold;
}

export function hitTestShapeLayer(layer: ShapeLayer, docX: number, docY: number, alphaThreshold = 1) {
  return hitTestPixelBackedLayer(layer, docX, docY, alphaThreshold);
}

export function findTopmostShapeLayerAtPoint(
  doc: DocumentState,
  docX: number,
  docY: number,
) {
  for (let index = doc.layers.length - 1; index >= 0; index -= 1) {
    const layer = doc.layers[index];
    if (!layer || layer.type !== "shape" || !layer.visible || layer.locked) {
      continue;
    }
    if (hitTestShapeLayer(layer, docX, docY)) {
      return layer;
    }
  }
  return null;
}

export function findTopmostPixelBackedLayerAtPoint(
  doc: DocumentState,
  docX: number,
  docY: number,
) {
  for (let index = doc.layers.length - 1; index >= 0; index -= 1) {
    const layer = doc.layers[index];
    if (!layer || !layer.visible || layer.locked || !isPixelBackedLayer(layer)) {
      continue;
    }
    if (hitTestPixelBackedLayer(layer, docX, docY)) {
      return layer;
    }
  }
  return null;
}
