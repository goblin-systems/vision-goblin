/**
 * Pixel-level image adjustment functions.
 * Each function takes source ImageData and returns new ImageData with the adjustment applied.
 */

export interface BrightnessContrastParams {
  brightness: number; // -100 to 100
  contrast: number;   // -100 to 100
}

export interface HueSaturationParams {
  hue: number;        // -180 to 180 degrees
  saturation: number; // -100 to 100
  lightness: number;  // -100 to 100
}

export interface GaussianBlurParams {
  radius: number; // 0 to 100
}

export interface SharpenParams {
  amount: number; // 0 to 200 (percentage)
  radius: number; // 0.1 to 10
}

export interface ColorBalanceParams {
  shadowsCyanRed: number;    // -100 to 100
  shadowsMagentaGreen: number; // -100 to 100
  shadowsYellowBlue: number;  // -100 to 100
  midtonesCyanRed: number;
  midtonesMagentaGreen: number;
  midtonesYellowBlue: number;
  highlightsCyanRed: number;
  highlightsMagentaGreen: number;
  highlightsYellowBlue: number;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function applyBrightnessContrast(source: ImageData, params: BrightnessContrastParams): ImageData {
  const { brightness, contrast } = params;
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;
  const b = brightness * 2.55; // map -100..100 to -255..255
  const c = contrast / 100;
  const factor = (1 + c) / (1.0001 - c); // contrast factor

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = clampByte(factor * (data[i]     - 128 + b) + 128);
    data[i + 1] = clampByte(factor * (data[i + 1] - 128 + b) + 128);
    data[i + 2] = clampByte(factor * (data[i + 2] - 128 + b) + 128);
    // alpha unchanged
  }
  return result;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, h) * 255),
    clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

export function applyHueSaturation(source: ImageData, params: HueSaturationParams): ImageData {
  const { hue, saturation, lightness } = params;
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;
  const hueShift = hue / 360;
  const satShift = saturation / 100;
  const lightShift = lightness / 100;

  for (let i = 0; i < data.length; i += 4) {
    let [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    h = ((h + hueShift) % 1 + 1) % 1;
    s = Math.max(0, Math.min(1, s + satShift));
    l = Math.max(0, Math.min(1, l + lightShift));
    const [r, g, b] = hslToRgb(h, s, l);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return result;
}

/**
 * Box blur approximation of Gaussian blur (3-pass for quality).
 * Much faster than true Gaussian and visually indistinguishable for most use cases.
 */
export function applyGaussianBlur(source: ImageData, params: GaussianBlurParams): ImageData {
  const { radius } = params;
  if (radius < 1) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const w = source.width;
  const h = source.height;
  const src = new Uint8ClampedArray(source.data);
  const dst = new Uint8ClampedArray(src.length);

  // Compute box sizes for 3-pass approximation
  const boxes = boxesForGauss(radius, 3);

  let input = src;
  let output = dst;
  for (let pass = 0; pass < 3; pass++) {
    const r = Math.floor((boxes[pass] - 1) / 2);
    boxBlur(input, output, w, h, r);
    // swap
    const tmp = input;
    input = output;
    output = tmp;
  }

  return new ImageData(input, w, h);
}

function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    sizes.push(i < m ? wl : wu);
  }
  return sizes;
}

function boxBlur(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  // Copy src to dst for horizontal pass
  dst.set(src);
  boxBlurH(dst, src, w, h, r);
  boxBlurV(src, dst, w, h, r);
}

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let row = 0; row < h; row++) {
    let ti = row * w * 4;
    let li = ti;
    let ri = ti + r * 4;
    const fv = [src[ti], src[ti + 1], src[ti + 2], src[ti + 3]];
    const lv = [src[ti + (w - 1) * 4], src[ti + (w - 1) * 4 + 1], src[ti + (w - 1) * 4 + 2], src[ti + (w - 1) * 4 + 3]];
    let valR = (r + 1) * fv[0];
    let valG = (r + 1) * fv[1];
    let valB = (r + 1) * fv[2];
    let valA = (r + 1) * fv[3];

    for (let j = 0; j < r; j++) {
      const idx = ti + Math.min(j, w - 1) * 4;
      valR += src[idx];
      valG += src[idx + 1];
      valB += src[idx + 2];
      valA += src[idx + 3];
    }

    for (let j = 0; j <= r; j++) {
      const riIdx = ti + Math.min(j + r, w - 1) * 4;
      valR += src[riIdx] - fv[0]; valG += src[riIdx + 1] - fv[1]; valB += src[riIdx + 2] - fv[2]; valA += src[riIdx + 3] - fv[3];
      dst[ti] = Math.round(valR * iarr); dst[ti + 1] = Math.round(valG * iarr); dst[ti + 2] = Math.round(valB * iarr); dst[ti + 3] = Math.round(valA * iarr);
      ti += 4;
    }

    for (let j = r + 1; j < w - r; j++) {
      valR += src[ri] - src[li]; valG += src[ri + 1] - src[li + 1]; valB += src[ri + 2] - src[li + 2]; valA += src[ri + 3] - src[li + 3];
      dst[ti] = Math.round(valR * iarr); dst[ti + 1] = Math.round(valG * iarr); dst[ti + 2] = Math.round(valB * iarr); dst[ti + 3] = Math.round(valA * iarr);
      ri += 4; li += 4; ti += 4;
    }

    for (let j = w - r; j < w; j++) {
      valR += lv[0] - src[li]; valG += lv[1] - src[li + 1]; valB += lv[2] - src[li + 2]; valA += lv[3] - src[li + 3];
      dst[ti] = Math.round(valR * iarr); dst[ti + 1] = Math.round(valG * iarr); dst[ti + 2] = Math.round(valB * iarr); dst[ti + 3] = Math.round(valA * iarr);
      li += 4; ti += 4;
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let col = 0; col < w; col++) {
    let ti = col * 4;
    let li = ti;
    let ri = ti + r * w * 4;
    const fv = [src[ti], src[ti + 1], src[ti + 2], src[ti + 3]];
    const lv = [src[ti + (h - 1) * w * 4], src[ti + (h - 1) * w * 4 + 1], src[ti + (h - 1) * w * 4 + 2], src[ti + (h - 1) * w * 4 + 3]];
    let valR = (r + 1) * fv[0];
    let valG = (r + 1) * fv[1];
    let valB = (r + 1) * fv[2];
    let valA = (r + 1) * fv[3];

    for (let j = 0; j < r; j++) {
      const idx = ti + Math.min(j, h - 1) * w * 4;
      valR += src[idx];
      valG += src[idx + 1];
      valB += src[idx + 2];
      valA += src[idx + 3];
    }

    for (let j = 0; j <= r; j++) {
      const riIdx = ti + Math.min(j + r, h - 1) * w * 4;
      valR += src[riIdx] - fv[0]; valG += src[riIdx + 1] - fv[1]; valB += src[riIdx + 2] - fv[2]; valA += src[riIdx + 3] - fv[3];
      dst[ti] = Math.round(valR * iarr); dst[ti + 1] = Math.round(valG * iarr); dst[ti + 2] = Math.round(valB * iarr); dst[ti + 3] = Math.round(valA * iarr);
      ti += w * 4;
    }

    for (let j = r + 1; j < h - r; j++) {
      valR += src[ri] - src[li]; valG += src[ri + 1] - src[li + 1]; valB += src[ri + 2] - src[li + 2]; valA += src[ri + 3] - src[li + 3];
      dst[ti] = Math.round(valR * iarr); dst[ti + 1] = Math.round(valG * iarr); dst[ti + 2] = Math.round(valB * iarr); dst[ti + 3] = Math.round(valA * iarr);
      ri += w * 4; li += w * 4; ti += w * 4;
    }

    for (let j = h - r; j < h; j++) {
      valR += lv[0] - src[li]; valG += lv[1] - src[li + 1]; valB += lv[2] - src[li + 2]; valA += lv[3] - src[li + 3];
      dst[ti] = Math.round(valR * iarr); dst[ti + 1] = Math.round(valG * iarr); dst[ti + 2] = Math.round(valB * iarr); dst[ti + 3] = Math.round(valA * iarr);
      li += w * 4; ti += w * 4;
    }
  }
}

/**
 * Unsharp mask sharpening: blur, then amplify the difference between original and blur.
 */
export function applySharpen(source: ImageData, params: SharpenParams): ImageData {
  const { amount, radius } = params;
  if (amount <= 0 || radius < 0.1) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const blurred = applyGaussianBlur(source, { radius });
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;
  const blurData = blurred.data;
  const factor = amount / 100;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = clampByte(data[i]     + (data[i]     - blurData[i])     * factor);
    data[i + 1] = clampByte(data[i + 1] + (data[i + 1] - blurData[i + 1]) * factor);
    data[i + 2] = clampByte(data[i + 2] + (data[i + 2] - blurData[i + 2]) * factor);
    // alpha unchanged
  }
  return result;
}

/**
 * Color balance adjustment: shift shadows, midtones, and highlights independently.
 */
export function applyColorBalance(source: ImageData, params: ColorBalanceParams): ImageData {
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Calculate luminance to determine tonal range weights
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    // Smooth weighting: shadows peak at 0, midtones at 0.5, highlights at 1
    const shadowWeight = 1 - lum;
    const highlightWeight = lum;
    const midtoneWeight = 1 - Math.abs(lum - 0.5) * 2;

    const shiftR = (params.shadowsCyanRed * shadowWeight + params.midtonesCyanRed * midtoneWeight + params.highlightsCyanRed * highlightWeight) * 2.55 / 100;
    const shiftG = (params.shadowsMagentaGreen * shadowWeight + params.midtonesMagentaGreen * midtoneWeight + params.highlightsMagentaGreen * highlightWeight) * 2.55 / 100;
    const shiftB = (params.shadowsYellowBlue * shadowWeight + params.midtonesYellowBlue * midtoneWeight + params.highlightsYellowBlue * highlightWeight) * 2.55 / 100;

    data[i]     = clampByte(r + shiftR);
    data[i + 1] = clampByte(g + shiftG);
    data[i + 2] = clampByte(b + shiftB);
  }
  return result;
}

export interface MotionBlurParams {
  angle: number;    // 0 to 360 degrees
  distance: number; // 1 to 100 pixels
}

/**
 * Motion blur: averages pixels along a line at the given angle.
 */
export function applyMotionBlur(source: ImageData, params: MotionBlurParams): ImageData {
  const { angle, distance } = params;
  if (distance < 1) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const w = source.width;
  const h = source.height;
  const src = source.data;
  const result = new ImageData(new Uint8ClampedArray(src.length), w, h);
  const dst = result.data;

  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const samples = Math.max(1, Math.round(distance));
  const halfSamples = samples / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
      let count = 0;

      for (let s = 0; s < samples; s++) {
        const offset = s - halfSamples;
        const sx = Math.round(x + dx * offset);
        const sy = Math.round(y + dy * offset);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const idx = (sy * w + sx) * 4;
          sumR += src[idx];
          sumG += src[idx + 1];
          sumB += src[idx + 2];
          sumA += src[idx + 3];
          count++;
        }
      }

      const i = (y * w + x) * 4;
      dst[i]     = Math.round(sumR / count);
      dst[i + 1] = Math.round(sumG / count);
      dst[i + 2] = Math.round(sumB / count);
      dst[i + 3] = Math.round(sumA / count);
    }
  }
  return result;
}

export interface AddNoiseParams {
  amount: number;      // 0 to 100
  monochrome: boolean; // true = grayscale noise, false = color noise
}

/**
 * Adds random noise to the image.
 */
export function applyAddNoise(source: ImageData, params: AddNoiseParams): ImageData {
  const { amount, monochrome } = params;
  if (amount <= 0) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;
  const strength = (amount / 100) * 255;

  for (let i = 0; i < data.length; i += 4) {
    if (monochrome) {
      const noise = (Math.random() - 0.5) * 2 * strength;
      data[i]     = clampByte(data[i]     + noise);
      data[i + 1] = clampByte(data[i + 1] + noise);
      data[i + 2] = clampByte(data[i + 2] + noise);
    } else {
      data[i]     = clampByte(data[i]     + (Math.random() - 0.5) * 2 * strength);
      data[i + 1] = clampByte(data[i + 1] + (Math.random() - 0.5) * 2 * strength);
      data[i + 2] = clampByte(data[i + 2] + (Math.random() - 0.5) * 2 * strength);
    }
    // alpha unchanged
  }
  return result;
}

export interface ReduceNoiseParams {
  strength: number; // 0 to 100
}

/**
 * Basic noise reduction via selective averaging with neighbors.
 * Uses a 3x3 median-like approach: averages neighbors that are within
 * a threshold of the center pixel, preserving edges.
 */
export function applyReduceNoise(source: ImageData, params: ReduceNoiseParams): ImageData {
  const { strength } = params;
  if (strength <= 0) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const w = source.width;
  const h = source.height;
  const src = source.data;
  const result = new ImageData(new Uint8ClampedArray(src.length), w, h);
  const dst = result.data;
  const threshold = (strength / 100) * 80; // max threshold of 80 levels

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4;
      const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
      let sumR = 0, sumG = 0, sumB = 0, count = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ny = y + ky;
          const nx = x + kx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            const ni = (ny * w + nx) * 4;
            const nr = src[ni], ng = src[ni + 1], nb = src[ni + 2];
            const diff = Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb);
            if (diff <= threshold * 3) {
              sumR += nr; sumG += ng; sumB += nb;
              count++;
            }
          }
        }
      }

      dst[ci]     = Math.round(sumR / count);
      dst[ci + 1] = Math.round(sumG / count);
      dst[ci + 2] = Math.round(sumB / count);
      dst[ci + 3] = src[ci + 3]; // preserve alpha
    }
  }
  return result;
}

/**
 * Compute luminance histogram (256 bins) from ImageData.
 */
export function computeHistogram(source: ImageData): Uint32Array {
  const hist = new Uint32Array(256);
  const data = source.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    hist[lum]++;
  }
  return hist;
}

export interface LevelsParams {
  inputBlack: number;  // 0 to 255
  gamma: number;       // 0.1 to 10 (midtone)
  inputWhite: number;  // 0 to 255
}

/**
 * Levels adjustment: remaps input range [inputBlack..inputWhite] to [0..255]
 * with gamma correction for midtones.
 */
export function applyLevels(source: ImageData, params: LevelsParams): ImageData {
  const { inputBlack, gamma, inputWhite } = params;
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;

  const range = Math.max(1, inputWhite - inputBlack);
  const invGamma = 1 / gamma;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = (data[i + c] - inputBlack) / range;
      v = Math.max(0, Math.min(1, v));
      v = Math.pow(v, invGamma);
      data[i + c] = clampByte(v * 255);
    }
    // alpha unchanged
  }
  return result;
}

export interface CurvePoint {
  x: number; // 0-255 input
  y: number; // 0-255 output
}

/**
 * Build a 256-entry lookup table from sorted curve control points using monotone cubic interpolation.
 */
export function buildCurveLUT(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  if (points.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (points.length === 1) {
    for (let i = 0; i < 256; i++) lut[i] = clampByte(points[0].y);
    return lut;
  }

  // Sort points by x
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const n = sorted.length;

  // For 2 points, use linear interpolation
  if (n === 2) {
    for (let i = 0; i < 256; i++) {
      if (i <= sorted[0].x) {
        lut[i] = clampByte(sorted[0].y);
      } else if (i >= sorted[n - 1].x) {
        lut[i] = clampByte(sorted[n - 1].y);
      } else {
        const t = (i - sorted[0].x) / (sorted[1].x - sorted[0].x);
        lut[i] = clampByte(sorted[0].y + t * (sorted[1].y - sorted[0].y));
      }
    }
    return lut;
  }

  // Monotone cubic (Fritsch-Carlson) for 3+ points
  const xs = sorted.map(p => p.x);
  const ys = sorted.map(p => p.y);
  const deltas: number[] = [];
  const m: number[] = new Array(n).fill(0);

  for (let i = 0; i < n - 1; i++) {
    deltas[i] = (ys[i + 1] - ys[i]) / Math.max(1, xs[i + 1] - xs[i]);
  }

  m[0] = deltas[0];
  m[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (deltas[i - 1] + deltas[i]) / 2;
    }
  }

  // Fritsch-Carlson monotonicity constraint
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(deltas[i]) < 1e-10) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / deltas[i];
      const beta = m[i + 1] / deltas[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * alpha * deltas[i];
        m[i + 1] = tau * beta * deltas[i];
      }
    }
  }

  // Evaluate spline for each x
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) {
      lut[x] = clampByte(ys[0]);
    } else if (x >= xs[n - 1]) {
      lut[x] = clampByte(ys[n - 1]);
    } else {
      // Find interval
      let seg = 0;
      for (let j = 0; j < n - 1; j++) {
        if (x >= xs[j] && x < xs[j + 1]) { seg = j; break; }
      }
      const h = xs[seg + 1] - xs[seg];
      const t = (x - xs[seg]) / Math.max(1, h);
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      lut[x] = clampByte(h00 * ys[seg] + h10 * h * m[seg] + h01 * ys[seg + 1] + h11 * h * m[seg + 1]);
    }
  }
  return lut;
}

export interface CurvesParams {
  points: CurvePoint[];
}

/**
 * Apply a tone curve to all channels equally.
 */
export function applyCurves(source: ImageData, params: CurvesParams): ImageData {
  const lut = buildCurveLUT(params.points);
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  return result;
}

export interface GradientStop {
  position: number; // 0 to 1
  r: number;
  g: number;
  b: number;
}

export interface GradientMapParams {
  stops: GradientStop[];
}

/**
 * Interpolate gradient color at position t (0-1).
 */
function sampleGradient(stops: GradientStop[], t: number): [number, number, number] {
  if (stops.length === 0) return [0, 0, 0];
  if (stops.length === 1) return [stops[0].r, stops[0].g, stops[0].b];
  if (t <= stops[0].position) return [stops[0].r, stops[0].g, stops[0].b];
  if (t >= stops[stops.length - 1].position) {
    const last = stops[stops.length - 1];
    return [last.r, last.g, last.b];
  }
  // Find segment
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].position && t <= stops[i + 1].position) {
      const range = stops[i + 1].position - stops[i].position;
      const f = range < 1e-10 ? 0 : (t - stops[i].position) / range;
      return [
        Math.round(stops[i].r + (stops[i + 1].r - stops[i].r) * f),
        Math.round(stops[i].g + (stops[i + 1].g - stops[i].g) * f),
        Math.round(stops[i].b + (stops[i + 1].b - stops[i].b) * f),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

/**
 * Maps image luminance to gradient colors.
 */
export function applyGradientMap(source: ImageData, params: GradientMapParams): ImageData {
  const { stops } = params;
  if (stops.length === 0) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const sorted = [...stops].sort((a, b) => a.position - b.position);
  // Build 256-entry LUT for speed
  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = sampleGradient(sorted, i / 255);
    lutR[i] = clampByte(r);
    lutG[i] = clampByte(g);
    lutB[i] = clampByte(b);
  }

  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;

  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i]     = lutR[lum];
    data[i + 1] = lutG[lum];
    data[i + 2] = lutB[lum];
  }
  return result;
}

/** Built-in gradient presets for the gradient map dialog. */
export const GRADIENT_PRESETS: { name: string; stops: GradientStop[] }[] = [
  {
    name: "Black & White",
    stops: [
      { position: 0, r: 0, g: 0, b: 0 },
      { position: 1, r: 255, g: 255, b: 255 },
    ],
  },
  {
    name: "Sepia",
    stops: [
      { position: 0, r: 30, g: 10, b: 0 },
      { position: 0.5, r: 160, g: 110, b: 60 },
      { position: 1, r: 255, g: 230, b: 180 },
    ],
  },
  {
    name: "Cool Duotone",
    stops: [
      { position: 0, r: 10, g: 10, b: 40 },
      { position: 1, r: 180, g: 220, b: 255 },
    ],
  },
  {
    name: "Warm Duotone",
    stops: [
      { position: 0, r: 40, g: 10, b: 10 },
      { position: 1, r: 255, g: 200, b: 120 },
    ],
  },
  {
    name: "Sunset",
    stops: [
      { position: 0, r: 20, g: 0, b: 40 },
      { position: 0.33, r: 180, g: 40, b: 80 },
      { position: 0.66, r: 255, g: 160, b: 50 },
      { position: 1, r: 255, g: 240, b: 180 },
    ],
  },
  {
    name: "Infrared",
    stops: [
      { position: 0, r: 0, g: 0, b: 0 },
      { position: 0.3, r: 80, g: 0, b: 120 },
      { position: 0.6, r: 200, g: 50, b: 50 },
      { position: 1, r: 255, g: 255, b: 200 },
    ],
  },
];

/**
 * 3D LUT representation: a cube of RGB values indexed by input RGB.
 */
export interface LUT3D {
  size: number; // grid size (e.g., 33 for a 33x33x33 LUT)
  data: Float32Array; // size^3 * 3 entries (R,G,B in 0-1 range)
}

export interface LUTParams {
  lut: LUT3D;
  intensity: number; // 0 to 100
}

/**
 * Parse a .cube LUT file (Adobe/Resolve format).
 * Supports LUT_3D_SIZE and data lines.
 */
export function parseCubeLUT(text: string): LUT3D | null {
  const lines = text.split(/\r?\n/);
  let size = 0;
  const values: number[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("TITLE")) continue;
    if (line.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (line.startsWith("DOMAIN_MIN") || line.startsWith("DOMAIN_MAX") || line.startsWith("LUT_1D_SIZE")) continue;
    // Try parsing as data line
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        values.push(r, g, b);
      }
    }
  }

  if (size < 2 || values.length < size * size * size * 3) return null;
  return { size, data: new Float32Array(values) };
}

/**
 * Apply a 3D LUT with trilinear interpolation.
 */
export function applyLUT(source: ImageData, params: LUTParams): ImageData {
  const { lut, intensity } = params;
  if (intensity <= 0) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);

  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;
  const { size, data: lutData } = lut;
  const maxIdx = size - 1;
  const blend = intensity / 100;

  for (let i = 0; i < data.length; i += 4) {
    const rIn = data[i] / 255;
    const gIn = data[i + 1] / 255;
    const bIn = data[i + 2] / 255;

    // Find grid position
    const rPos = rIn * maxIdx;
    const gPos = gIn * maxIdx;
    const bPos = bIn * maxIdx;

    const r0 = Math.floor(rPos);
    const g0 = Math.floor(gPos);
    const b0 = Math.floor(bPos);
    const r1 = Math.min(r0 + 1, maxIdx);
    const g1 = Math.min(g0 + 1, maxIdx);
    const b1 = Math.min(b0 + 1, maxIdx);

    const rf = rPos - r0;
    const gf = gPos - g0;
    const bf = bPos - b0;

    // Trilinear interpolation
    const idx = (ri: number, gi: number, bi: number) => (bi * size * size + gi * size + ri) * 3;

    const c000 = idx(r0, g0, b0);
    const c100 = idx(r1, g0, b0);
    const c010 = idx(r0, g1, b0);
    const c110 = idx(r1, g1, b0);
    const c001 = idx(r0, g0, b1);
    const c101 = idx(r1, g0, b1);
    const c011 = idx(r0, g1, b1);
    const c111 = idx(r1, g1, b1);

    for (let c = 0; c < 3; c++) {
      const v000 = lutData[c000 + c];
      const v100 = lutData[c100 + c];
      const v010 = lutData[c010 + c];
      const v110 = lutData[c110 + c];
      const v001 = lutData[c001 + c];
      const v101 = lutData[c101 + c];
      const v011 = lutData[c011 + c];
      const v111 = lutData[c111 + c];

      const v00 = v000 + (v100 - v000) * rf;
      const v01 = v001 + (v101 - v001) * rf;
      const v10 = v010 + (v110 - v010) * rf;
      const v11 = v011 + (v111 - v011) * rf;

      const v0 = v00 + (v10 - v00) * gf;
      const v1 = v01 + (v11 - v01) * gf;

      const vOut = v0 + (v1 - v0) * bf;

      const original = data[i + c] / 255;
      data[i + c] = clampByte((original + (vOut - original) * blend) * 255);
    }
  }
  return result;
}
