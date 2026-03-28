/**
 * Color Range Selection — builds a selection mask by sampling colors from
 * a flattened composite and comparing each pixel via a fuzziness/tolerance
 * threshold in CIE Lab colour space.
 *
 * The module is pure computation — no DOM access — so it can be tested easily.
 */

// ---------------------------------------------------------------------------
// CIE Lab conversion helpers (sRGB → XYZ → Lab)
// ---------------------------------------------------------------------------

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function xyzToLabF(t: number): number {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

export interface LabColor {
  L: number;
  a: number;
  b: number;
}

export function rgbToLab(r: number, g: number, b: number): LabColor {
  // sRGB → linear
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // linear RGB → XYZ (D65)
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  // D65 reference white
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const fx = xyzToLabF(x / xn);
  const fy = xyzToLabF(y / yn);
  const fz = xyzToLabF(z / zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function labDistance(a: LabColor, b: LabColor): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ---------------------------------------------------------------------------
// Color Range mask builder
// ---------------------------------------------------------------------------

export interface ColorRangeOptions {
  /** Sampled colors (sRGB). Each entry is [r, g, b]. */
  samples: Array<[number, number, number]>;
  /** Fuzziness 0–200 (maps to Lab distance). Default 40. */
  fuzziness: number;
}

/**
 * Build a selection mask from sampled colors.
 * `imageData` should be the flattened (composited) image.
 * Returns a `Uint8ClampedArray` where each pixel is 0 (not selected) or 255 (selected).
 * The caller wraps this into a mask canvas.
 */
export function buildColorRangeMask(
  imageData: ImageData,
  options: ColorRangeOptions,
): Uint8ClampedArray {
  const { samples, fuzziness } = options;
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const result = new Uint8ClampedArray(pixelCount);

  if (samples.length === 0) return result;

  // Pre-compute Lab values for sampled colors
  const sampleLabs = samples.map(([r, g, b]) => rgbToLab(r, g, b));

  // The fuzziness value (0–200) maps directly to a Lab distance threshold.
  // At 0 → only exact matches. At 200 → very wide range.
  const threshold = fuzziness;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];

    // Skip fully transparent pixels
    if (a === 0) continue;

    const lab = rgbToLab(r, g, b);

    // Check if this pixel matches any sampled color within threshold
    let minDist = Infinity;
    for (const sLab of sampleLabs) {
      const d = labDistance(lab, sLab);
      if (d < minDist) minDist = d;
    }

    if (minDist <= threshold) {
      // Soft falloff: full selection at 0 distance, fade at edges
      if (threshold > 0 && minDist > threshold * 0.7) {
        // Smooth falloff in the outer 30%
        const t = (minDist - threshold * 0.7) / (threshold * 0.3);
        result[i] = Math.round(255 * (1 - t));
      } else {
        result[i] = 255;
      }
    }
  }
  return result;
}

/**
 * Convert a flat alpha mask (Uint8ClampedArray with one value per pixel)
 * into a full RGBA ImageData suitable for drawing onto a mask canvas.
 */
export function alphaToMaskImageData(mask: Uint8ClampedArray, width: number, height: number): ImageData {
  const imgData = new ImageData(width, height);
  const d = imgData.data;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v > 0) {
      const p = i * 4;
      d[p] = 255;
      d[p + 1] = 255;
      d[p + 2] = 255;
      d[p + 3] = v;
    }
  }
  return imgData;
}

/**
 * Sample a pixel color from ImageData at document coordinates.
 * Returns [r, g, b] or null if out of bounds.
 */
export function samplePixel(imageData: ImageData, x: number, y: number): [number, number, number] | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) return null;
  const offset = (py * imageData.width + px) * 4;
  return [imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]];
}
