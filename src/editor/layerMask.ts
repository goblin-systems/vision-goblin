/**
 * Layer mask support — grayscale masks that control where a layer's content
 * (or adjustment) is visible.  White = fully visible, black = fully hidden,
 * grey = partial.
 *
 * Masks live on LayerBase.mask as an HTMLCanvasElement matching the document
 * dimensions.  For adjustment layers the mask controls how much of the
 * adjustment is blended in at each pixel.
 */

import { createLayerCanvas, cloneCanvas } from "./documents";
import type { Layer } from "./types";

// ---------------------------------------------------------------------------
// Create / remove
// ---------------------------------------------------------------------------

/** Create a fully-white (reveal-all) mask for the given layer. */
export function addLayerMask(layer: Layer, docWidth: number, docHeight: number): HTMLCanvasElement {
  const mask = createLayerCanvas(docWidth, docHeight);
  const ctx = mask.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, docWidth, docHeight);
  layer.mask = mask;
  return mask;
}

/** Remove the mask from a layer, returning the old mask or null. */
export function removeLayerMask(layer: Layer): HTMLCanvasElement | null {
  const old = layer.mask ?? null;
  layer.mask = undefined;
  return old;
}

// ---------------------------------------------------------------------------
// Invert
// ---------------------------------------------------------------------------

/** Invert a mask in-place (white ↔ black). */
export function invertLayerMask(layer: Layer): void {
  if (!layer.mask) return;
  const ctx = layer.mask.getContext("2d")!;
  const imgData = ctx.getImageData(0, 0, layer.mask.width, layer.mask.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = 255 - d[i];     // R
    d[i + 1] = 255 - d[i + 1]; // G
    d[i + 2] = 255 - d[i + 2]; // B
    // alpha stays at 255
  }
  ctx.putImageData(imgData, 0, 0);
}

/** Reset a mask to fully white (reveal-all). */
export function clearLayerMask(layer: Layer): void {
  if (!layer.mask) return;
  const ctx = layer.mask.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layer.mask.width, layer.mask.height);
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export function cloneLayerMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  return cloneCanvas(mask);
}

// ---------------------------------------------------------------------------
// Mask stroke — paint white (reveal) or black (hide) onto the mask
// ---------------------------------------------------------------------------

/**
 * Draw a brush stroke on a layer mask.
 * `mode` "reveal" paints white, "hide" paints black.
 */
export function drawMaskStroke(
  mask: HTMLCanvasElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  brushSize: number,
  brushOpacity: number,
  mode: "reveal" | "hide"
): void {
  const ctx = mask.getContext("2d")!;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = brushSize;
  ctx.globalAlpha = brushOpacity;
  ctx.strokeStyle = mode === "reveal" ? "#ffffff" : "#000000";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Masked adjustment compositing
// ---------------------------------------------------------------------------

/**
 * Blend between `original` and `adjusted` ImageData per-pixel using the
 * mask's red channel as the blend factor.
 *
 * Returns a new ImageData with the blended result.  The inputs are not
 * mutated.
 */
export function blendWithMask(
  original: ImageData,
  adjusted: ImageData,
  mask: HTMLCanvasElement
): ImageData {
  const w = original.width;
  const h = original.height;
  const maskCtx = mask.getContext("2d")!;
  const maskData = maskCtx.getImageData(0, 0, w, h).data;
  const src = original.data;
  const adj = adjusted.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  for (let i = 0; i < src.length; i += 4) {
    const t = maskData[i] / 255; // red channel as blend factor (0=hide, 1=reveal)
    dst[i]     = Math.round(src[i]     + (adj[i]     - src[i])     * t);
    dst[i + 1] = Math.round(src[i + 1] + (adj[i + 1] - src[i + 1]) * t);
    dst[i + 2] = Math.round(src[i + 2] + (adj[i + 2] - src[i + 2]) * t);
    dst[i + 3] = Math.round(src[i + 3] + (adj[i + 3] - src[i + 3]) * t);
  }

  return out;
}
