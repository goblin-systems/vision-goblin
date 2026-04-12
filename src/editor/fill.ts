import { parseHexColour, blendChannel } from "./colorUtils";
import { getLayerContext, syncLayerSource } from "./documents";
import { getFillGradientNoOverlapMessage, getFillGradientSelectionRequiredMessage, resolveEffectiveSelectionMask } from "./fillGradientValidation";
import type { DocumentState, RasterLayer } from "./types";

export type FillSelectionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; variant: "error" | "info" };

export function applyFillToSelection(
  doc: Pick<DocumentState, "width" | "height" | "selectionRect" | "selectionShape" | "selectionPath" | "selectionMask" | "selectionInverted">,
  layer: RasterLayer,
  colour: string,
): FillSelectionResult {
  const effectiveMask = resolveEffectiveSelectionMask(doc);
  if (!effectiveMask) {
    return { ok: false, message: getFillGradientSelectionRequiredMessage("fill"), variant: "info" };
  }

  const rgba = parseHexColour(colour);
  if (!rgba) {
    return { ok: false, message: "Active colour is invalid", variant: "error" };
  }

  const left = Math.max(0, -layer.x);
  const top = Math.max(0, -layer.y);
  const right = Math.min(layer.canvas.width, doc.width - layer.x);
  const bottom = Math.min(layer.canvas.height, doc.height - layer.y);
  if (right <= left || bottom <= top) {
    return { ok: false, message: getFillGradientNoOverlapMessage(), variant: "info" };
  }

  const width = right - left;
  const height = bottom - top;
  const layerCtx = getLayerContext(layer);
  const maskCtx = effectiveMask.getContext("2d");
  if (!maskCtx) {
    return { ok: false, message: "Selection mask is unavailable", variant: "error" };
  }

  const layerImage = layerCtx.getImageData(left, top, width, height);
  const maskImage = maskCtx.getImageData(left + layer.x, top + layer.y, width, height);
  const pixels = layerImage.data;
  const maskPixels = maskImage.data;
  let hasSelectedOverlap = false;
  let changed = false;

  for (let index = 0; index < pixels.length; index += 4) {
    const maskAlpha = maskPixels[index + 3] / 255;
    if (maskAlpha === 0) {
      continue;
    }
    hasSelectedOverlap = true;
    const sourceAlpha = (rgba.a / 255) * maskAlpha;
    const destinationAlpha = pixels[index + 3] / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    const nextR = blendChannel(rgba.r, pixels[index], sourceAlpha, destinationAlpha, outAlpha);
    const nextG = blendChannel(rgba.g, pixels[index + 1], sourceAlpha, destinationAlpha, outAlpha);
    const nextB = blendChannel(rgba.b, pixels[index + 2], sourceAlpha, destinationAlpha, outAlpha);
    const nextA = Math.round(outAlpha * 255);
    if (
      pixels[index] === nextR &&
      pixels[index + 1] === nextG &&
      pixels[index + 2] === nextB &&
      pixels[index + 3] === nextA
    ) {
      continue;
    }
    pixels[index] = nextR;
    pixels[index + 1] = nextG;
    pixels[index + 2] = nextB;
    pixels[index + 3] = nextA;
    changed = true;
  }

  if (!hasSelectedOverlap) {
    return { ok: false, message: getFillGradientNoOverlapMessage(), variant: "info" };
  }

  if (!changed) {
    return { ok: false, message: "Selection already matches the active colour", variant: "info" };
  }

  layerCtx.putImageData(layerImage, left, top);
  layer.fillColor = colour;
  syncLayerSource(layer);
  return { ok: true, message: "Filled selection" };
}
