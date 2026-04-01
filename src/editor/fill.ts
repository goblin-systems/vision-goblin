import { getLayerContext, syncLayerSource } from "./documents";
import { invertMask, isMaskEmpty, normalizeSelectionToMask } from "./selection";
import type { DocumentState, RasterLayer } from "./types";

export type FillSelectionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; variant: "error" | "info" };

function parseHexColour(colour: string) {
  const normalized = colour.trim();
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
    if ([r, g, b, a].some((value) => Number.isNaN(value))) {
      return null;
    }
    return { r, g, b, a };
  }
  return null;
}

function blendChannel(source: number, destination: number, sourceAlpha: number, destinationAlpha: number, outAlpha: number) {
  if (outAlpha <= 0) {
    return 0;
  }
  return Math.round(((source * sourceAlpha) + (destination * destinationAlpha * (1 - sourceAlpha))) / outAlpha);
}

export function resolveEffectiveSelectionMask(
  doc: Pick<DocumentState, "width" | "height" | "selectionRect" | "selectionShape" | "selectionPath" | "selectionMask" | "selectionInverted">
) {
  const mask = normalizeSelectionToMask(doc.width, doc.height, doc.selectionRect, doc.selectionShape, doc.selectionPath, doc.selectionMask);
  if (!mask) {
    return null;
  }
  if (doc.selectionInverted) {
    invertMask(mask);
  }
  return isMaskEmpty(mask) ? null : mask;
}

export function applyFillToSelection(
  doc: Pick<DocumentState, "width" | "height" | "selectionRect" | "selectionShape" | "selectionPath" | "selectionMask" | "selectionInverted">,
  layer: RasterLayer,
  colour: string,
): FillSelectionResult {
  const effectiveMask = resolveEffectiveSelectionMask(doc);
  if (!effectiveMask) {
    return { ok: false, message: "Create a selection before using Fill", variant: "info" };
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
    return { ok: false, message: "Selection does not overlap the active layer", variant: "info" };
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
    return { ok: false, message: "Selection does not overlap the active layer", variant: "info" };
  }

  if (!changed) {
    return { ok: false, message: "Selection already matches the active colour", variant: "info" };
  }

  layerCtx.putImageData(layerImage, left, top);
  layer.fillColor = colour;
  syncLayerSource(layer);
  return { ok: true, message: "Filled selection" };
}
