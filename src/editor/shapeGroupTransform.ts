import { buildTransformMatrix, createLayerCanvas, drawLayerOnto, refreshLayerCanvas } from "./documents";
import type { DocumentState, Rect, ShapeLayer, TransformDraft, TransformIntent } from "./types";

export function getLayerFrameBounds(layer: Pick<ShapeLayer, "x" | "y" | "canvas">): Rect {
  return {
    x: layer.x,
    y: layer.y,
    width: layer.canvas.width,
    height: layer.canvas.height,
  };
}

export function getUnionBounds(bounds: Rect[]): Rect | null {
  if (bounds.length === 0) {
    return null;
  }
  let minX = bounds[0].x;
  let minY = bounds[0].y;
  let maxX = bounds[0].x + bounds[0].width;
  let maxY = bounds[0].y + bounds[0].height;
  for (let index = 1; index < bounds.length; index += 1) {
    const bound = bounds[index];
    minX = Math.min(minX, bound.x);
    minY = Math.min(minY, bound.y);
    maxX = Math.max(maxX, bound.x + bound.width);
    maxY = Math.max(maxY, bound.y + bound.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getEligibleShapeTransformLayers(doc: DocumentState, anchorLayerId: string): ShapeLayer[] {
  const selectedIds = doc.selectedLayerIds.length > 0 ? doc.selectedLayerIds : [anchorLayerId];
  const selectedIdSet = new Set(selectedIds);
  if (!selectedIdSet.has(anchorLayerId)) {
    selectedIdSet.add(anchorLayerId);
  }
  return doc.layers.filter((layer): layer is ShapeLayer => {
    return selectedIdSet.has(layer.id)
      && layer.type === "shape"
      && layer.visible
      && !layer.locked
      && !layer.isBackground;
  });
}

export function createShapeGroupTransformDraft(
  doc: DocumentState,
  layers: ShapeLayer[],
  anchorLayerId: string,
  intent: TransformIntent = "layer"
): TransformDraft | null {
  if (layers.length < 2) {
    return null;
  }
  const frameBounds = getUnionBounds(layers.map(getLayerFrameBounds));
  if (!frameBounds) {
    return null;
  }
  const sourceCanvas = createLayerCanvas(Math.max(1, Math.ceil(frameBounds.width)), Math.max(1, Math.ceil(frameBounds.height)));
  const sourceContext = sourceCanvas.getContext("2d");
  if (sourceContext) {
    for (const layer of layers) {
      drawLayerOnto(sourceContext, layer, layer.x - frameBounds.x, layer.y - frameBounds.y);
    }
  }
  const centerX = frameBounds.x + frameBounds.width / 2;
  const centerY = frameBounds.y + frameBounds.height / 2;
  return {
    layerId: anchorLayerId,
    intent,
    sourceCanvas,
    frameBounds,
    previewLayerIds: layers.map((layer) => layer.id),
    groupMembers: layers.map((layer) => ({
      layerId: layer.id,
      centerX: layer.x + layer.canvas.width / 2,
      centerY: layer.y + layer.canvas.height / 2,
    })),
    centerX,
    centerY,
    pivotX: centerX,
    pivotY: centerY,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    previewOverride: null,
    snapshot: "",
  };
}

export function applyShapeGroupTransform(doc: DocumentState, draft: TransformDraft): boolean {
  if (!draft.groupMembers || draft.groupMembers.length < 2 || !draft.frameBounds) {
    return false;
  }
  if (Math.abs(draft.skewXDeg) > 0.001 || Math.abs(draft.skewYDeg) > 0.001) {
    return false;
  }
  const matrix = buildTransformMatrix(draft);
  const originalPivotX = draft.frameBounds.x + draft.frameBounds.width / 2;
  const originalPivotY = draft.frameBounds.y + draft.frameBounds.height / 2;
  for (const member of draft.groupMembers) {
    const layer = doc.layers.find((item): item is ShapeLayer => item.id === member.layerId && item.type === "shape");
    if (!layer || layer.locked || layer.isBackground) {
      continue;
    }
    const dx = member.centerX - originalPivotX;
    const dy = member.centerY - originalPivotY;
    const transformedCenterX = draft.pivotX + matrix.a * dx + matrix.c * dy;
    const transformedCenterY = draft.pivotY + matrix.b * dx + matrix.d * dy;
    layer.shapeData.width = Math.max(1, Math.round(layer.shapeData.width * draft.scaleX));
    layer.shapeData.height = Math.max(1, Math.round(layer.shapeData.height * draft.scaleY));
    layer.shapeData.rotationDeg += draft.rotateDeg;
    refreshLayerCanvas(layer);
    layer.x = Math.round(transformedCenterX - layer.canvas.width / 2);
    layer.y = Math.round(transformedCenterY - layer.canvas.height / 2);
  }
  return true;
}
