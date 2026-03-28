/**
 * Edge refinement — processes a selection mask with morphological expand/contract,
 * box blur smoothing, and Gaussian feathering.
 *
 * The mask is an HTMLCanvasElement where white (alpha=255) = selected,
 * transparent (alpha=0) = deselected.
 */

import { createMaskCanvas } from "./selection";

export interface RefineEdgeParams {
  /** Gaussian blur radius for feathering (0 = no feather). */
  feather: number;
  /** Smoothing strength — controls box blur iterations and radius. 0 = none. */
  smooth: number;
  /** Expand (+) or contract (-) the mask edge by this many pixels. 0 = none. */
  expand: number;
}

/**
 * Read the alpha channel of a mask canvas into a 0–1 Float32Array.
 */
export function readMaskAlpha(source: HTMLCanvasElement): Float32Array {
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext("2d")!;
  const data = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = data[i * 4 + 3] / 255;
  }
  return alpha;
}

/**
 * Morphological expand (positive) or contract (negative) of an alpha buffer.
 * Uses a brute-force circular structuring element.
 *
 * Expand: unselected/partial pixels (val < 1) adopt the max of their neighbours.
 * Contract: selected/partial pixels (val > 0) adopt the min of their neighbours.
 */
export function morphExpand(alpha: Float32Array, w: number, h: number, amount: number): Float32Array {
  if (amount === 0) return alpha;
  const result = new Float32Array(w * h);
  const radius = Math.abs(amount);
  const isExpand = amount > 0;
  const r = Math.ceil(radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const val = alpha[idx];
      // For expand: process pixels that are NOT fully selected (could gain value)
      // For contract: process pixels that are NOT fully deselected (could lose value)
      if (isExpand ? val < 1 : val > 0) {
        let best = val;
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > radius) continue;
            // Out-of-bounds: treat as 0 for expand (no effect on max),
            // and 0 for contract (pulls min down = erosion at boundaries)
            const nv = (ny < 0 || ny >= h || nx < 0 || nx >= w)
              ? 0
              : alpha[ny * w + nx];
            if (isExpand) {
              if (nv > best) best = nv;
            } else {
              if (nv < best) best = nv;
            }
          }
        }
        result[idx] = best;
      } else {
        result[idx] = val;
      }
    }
  }
  return result;
}

/**
 * Box blur smoothing — repeated separable box blur passes.
 * Mutates the `alpha` array in-place.
 */
export function boxBlurSmooth(alpha: Float32Array, w: number, h: number, smooth: number): void {
  if (smooth <= 0) return;
  const iterations = Math.ceil(smooth / 10);
  const radius = Math.max(1, Math.round(smooth / 20));
  const tmp = new Float32Array(w * h);
  for (let iter = 0; iter < iterations; iter++) {
    // Horizontal pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) { sum += alpha[y * w + nx]; count++; }
        }
        tmp[y * w + x] = sum / count;
      }
    }
    alpha.set(tmp);
    // Vertical pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < h) { sum += alpha[ny * w + x]; count++; }
        }
        tmp[y * w + x] = sum / count;
      }
    }
    alpha.set(tmp);
  }
}

/**
 * Gaussian feather — separable 2-pass Gaussian blur on the alpha buffer.
 * Mutates the `alpha` array in-place.
 */
export function gaussianFeather(alpha: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0) return;
  const kernelRadius = Math.ceil(sigma * 3);
  const kernelSize = kernelRadius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  let kernelSum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - kernelRadius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernelSum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= kernelSum;

  const tmp = new Float32Array(w * h);
  // Horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k++) {
        const nx = Math.min(w - 1, Math.max(0, x + k));
        sum += alpha[y * w + nx] * kernel[k + kernelRadius];
      }
      tmp[y * w + x] = sum;
    }
  }
  // Vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k++) {
        const ny = Math.min(h - 1, Math.max(0, y + k));
        sum += tmp[ny * w + x] * kernel[k + kernelRadius];
      }
      alpha[y * w + x] = sum;
    }
  }
}

/**
 * Convert a float alpha buffer (0–1) into a mask canvas (white pixels with
 * varying alpha).
 */
export function alphaToMaskCanvas(alpha: Float32Array, w: number, h: number): HTMLCanvasElement {
  const result = createMaskCanvas(w, h);
  const ctx = result.getContext("2d")!;
  const imgData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.min(1, Math.max(0, alpha[i])) * 255);
    if (v > 0) {
      imgData.data[i * 4] = 255;
      imgData.data[i * 4 + 1] = 255;
      imgData.data[i * 4 + 2] = 255;
      imgData.data[i * 4 + 3] = v;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return result;
}

/**
 * Refine a selection mask with expand/contract, smoothing, and feathering.
 * Returns a new mask canvas.
 */
export function refineMask(source: HTMLCanvasElement, params: RefineEdgeParams): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  let alpha = readMaskAlpha(source);

  // 1. Expand / contract
  if (params.expand !== 0) {
    alpha = morphExpand(alpha, w, h, params.expand);
  }

  // 2. Smooth (box blur)
  boxBlurSmooth(alpha, w, h, params.smooth);

  // 3. Feather (Gaussian blur)
  gaussianFeather(alpha, w, h, params.feather);

  return alphaToMaskCanvas(alpha, w, h);
}
