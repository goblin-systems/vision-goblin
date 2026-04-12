import { invertMask, isMaskEmpty, normalizeSelectionToMask } from "./selection";
import type { DocumentState, Layer } from "./types";

export type FillGradientOperation = "fill" | "gradient";

type SelectionSource = Pick<DocumentState, "width" | "height" | "selectionRect" | "selectionShape" | "selectionPath" | "selectionMask" | "selectionInverted">;

const OPERATION_COPY: Record<FillGradientOperation, {
  toolLabel: string;
  targetAction: string;
  targetActionProgressive: string;
}> = {
  fill: {
    toolLabel: "Fill",
    targetAction: "fill",
    targetActionProgressive: "filling",
  },
  gradient: {
    toolLabel: "Gradient",
    targetAction: "apply a gradient",
    targetActionProgressive: "applying a gradient",
  },
};

export function resolveEffectiveSelectionMask(doc: SelectionSource) {
  const mask = normalizeSelectionToMask(doc.width, doc.height, doc.selectionRect, doc.selectionShape, doc.selectionPath, doc.selectionMask);
  if (!mask) {
    return null;
  }
  if (doc.selectionInverted) {
    invertMask(mask);
  }
  return isMaskEmpty(mask) ? null : mask;
}

export function getFillGradientSelectionRequiredMessage(operation: FillGradientOperation) {
  return `Create a selection before using ${OPERATION_COPY[operation].toolLabel}`;
}

export function getFillGradientNoOverlapMessage() {
  return "Selection does not overlap the active layer";
}

export function getFillGradientTargetError(operation: FillGradientOperation, layer: Layer | null) {
  const copy = OPERATION_COPY[operation];
  if (!layer || layer.type !== "raster") {
    return `Select a raster layer to ${copy.targetAction}`;
  }
  if (layer.locked) {
    return `Unlock the active layer before ${copy.targetActionProgressive}`;
  }
  return null;
}
