import { describe, expect, it } from "vitest";
import { applyAddNoise, applyBrightnessContrast, applyColorBalance, applyCurves, applyGaussianBlur, applyGradientMap, applyHueSaturation, applyLevels, applyLUT, applyMotionBlur, applyReduceNoise, applySharpen, buildCurveLUT, computeHistogram, gaussianBlurRadiusToSigma, GRADIENT_PRESETS, parseCubeLUT } from "./adjustments";

function makeImageData(r: number, g: number, b: number, a = 255, count = 4): ImageData {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return new ImageData(data, count, 1);
}

describe("brightness/contrast", () => {
  it("returns unchanged image at zero values", () => {
    const src = makeImageData(128, 64, 200);
    const result = applyBrightnessContrast(src, { brightness: 0, contrast: 0 });
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(64);
    expect(result.data[2]).toBe(200);
  });

  it("increases brightness", () => {
    const src = makeImageData(100, 100, 100);
    const result = applyBrightnessContrast(src, { brightness: 50, contrast: 0 });
    expect(result.data[0]).toBeGreaterThan(100);
    expect(result.data[1]).toBeGreaterThan(100);
    expect(result.data[2]).toBeGreaterThan(100);
  });

  it("decreases brightness", () => {
    const src = makeImageData(100, 100, 100);
    const result = applyBrightnessContrast(src, { brightness: -50, contrast: 0 });
    expect(result.data[0]).toBeLessThan(100);
  });

  it("clamps to 0-255 range", () => {
    const src = makeImageData(250, 5, 128);
    const result = applyBrightnessContrast(src, { brightness: 100, contrast: 100 });
    expect(result.data[0]).toBeLessThanOrEqual(255);
    expect(result.data[1]).toBeGreaterThanOrEqual(0);
  });

  it("preserves alpha channel", () => {
    const src = makeImageData(128, 128, 128, 100);
    const result = applyBrightnessContrast(src, { brightness: 50, contrast: 50 });
    expect(result.data[3]).toBe(100);
  });
});

describe("hue/saturation", () => {
  it("returns unchanged at zero values", () => {
    const src = makeImageData(200, 100, 50);
    const result = applyHueSaturation(src, { hue: 0, saturation: 0, lightness: 0 });
    // Should be very close to original (allow rounding)
    expect(Math.abs(result.data[0] - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.data[1] - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.data[2] - 50)).toBeLessThanOrEqual(1);
  });

  it("shifts hue", () => {
    const src = makeImageData(255, 0, 0); // pure red
    const result = applyHueSaturation(src, { hue: 120, saturation: 0, lightness: 0 });
    // Hue shifted 120 degrees from red should be greenish
    expect(result.data[1]).toBeGreaterThan(result.data[0]); // green > red
  });

  it("reduces saturation toward gray", () => {
    const src = makeImageData(255, 0, 0);
    const result = applyHueSaturation(src, { hue: 0, saturation: -100, lightness: 0 });
    // Fully desaturated red becomes gray
    expect(Math.abs(result.data[0] - result.data[1])).toBeLessThan(10);
    expect(Math.abs(result.data[1] - result.data[2])).toBeLessThan(10);
  });

  it("adjusts lightness", () => {
    const src = makeImageData(128, 128, 128);
    const lighter = applyHueSaturation(src, { hue: 0, saturation: 0, lightness: 30 });
    expect(lighter.data[0]).toBeGreaterThan(128);
  });
});

describe("gaussian blur", () => {
  function makeImpulseImageData(size: number): ImageData {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = 255;
    }
    const center = Math.floor(size / 2);
    const index = (center * size + center) * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    return new ImageData(data, size, size);
  }

  it("returns unchanged at radius 0", () => {
    const src = makeImageData(100, 150, 200, 255, 16);
    const result = applyGaussianBlur(src, { radius: 0 });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it("blurs a uniform white image to white", () => {
    const w = 4; const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200; data[i + 1] = 200; data[i + 2] = 200; data[i + 3] = 255;
    }
    const src = new ImageData(data, w, h);
    const result = applyGaussianBlur(src, { radius: 2 });
    // Uniform input should stay uniform after blur
    expect(result.data[0]).toBeGreaterThan(190);
    expect(result.data[0]).toBeLessThanOrEqual(210);
  });

  it("does not modify dimensions", () => {
    const src = makeImageData(128, 128, 128, 255, 9);
    const result = applyGaussianBlur(src, { radius: 3 });
    expect(result.width).toBe(9);
    expect(result.height).toBe(1);
  });

  it("starts blurring before the slider reaches double digits", () => {
    const src = makeImpulseImageData(9);

    const result = applyGaussianBlur(src, { radius: 10 });
    const center = (4 * 9 + 4) * 4;

    expect(result.data[center]).toBeLessThan(255);
  });

  it("preserves opaque white instead of darkening it during blur", () => {
    const src = new ImageData(new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]), 3, 1);

    const result = applyGaussianBlur(src, { radius: 25 });

    expect(Array.from(result.data)).toEqual(Array.from(src.data));
  });

  it("increases blur strength smoothly as radius grows", () => {
    expect(gaussianBlurRadiusToSigma(10)).toBeGreaterThan(0.3);
    expect(gaussianBlurRadiusToSigma(50)).toBeGreaterThan(gaussianBlurRadiusToSigma(10));
    expect(gaussianBlurRadiusToSigma(100)).toBeGreaterThan(gaussianBlurRadiusToSigma(50));
  });
});

describe("sharpen", () => {
  it("returns unchanged at zero amount", () => {
    const src = makeImageData(100, 150, 200, 255, 9);
    const result = applySharpen(src, { amount: 0, radius: 1 });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it("returns unchanged at very small radius", () => {
    const src = makeImageData(100, 150, 200, 255, 4);
    const result = applySharpen(src, { amount: 100, radius: 0.05 });
    expect(result.data[0]).toBe(100);
  });

  it("preserves alpha channel", () => {
    const src = makeImageData(128, 128, 128, 80, 9);
    const result = applySharpen(src, { amount: 100, radius: 1 });
    expect(result.data[3]).toBe(80);
  });

  it("does not modify dimensions", () => {
    const src = makeImageData(128, 128, 128, 255, 9);
    const result = applySharpen(src, { amount: 50, radius: 1 });
    expect(result.width).toBe(9);
    expect(result.height).toBe(1);
  });
});

describe("color balance", () => {
  const zeroParams = {
    shadowsCyanRed: 0, shadowsMagentaGreen: 0, shadowsYellowBlue: 0,
    midtonesCyanRed: 0, midtonesMagentaGreen: 0, midtonesYellowBlue: 0,
    highlightsCyanRed: 0, highlightsMagentaGreen: 0, highlightsYellowBlue: 0,
  };

  it("returns unchanged at zero values", () => {
    const src = makeImageData(128, 64, 200);
    const result = applyColorBalance(src, zeroParams);
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(64);
    expect(result.data[2]).toBe(200);
  });

  it("shifts midtones toward red", () => {
    const src = makeImageData(128, 128, 128);
    const result = applyColorBalance(src, { ...zeroParams, midtonesCyanRed: 100 });
    expect(result.data[0]).toBeGreaterThan(128); // red increased
    expect(result.data[1]).toBe(128); // green unchanged
    expect(result.data[2]).toBe(128); // blue unchanged
  });

  it("shifts shadows toward blue", () => {
    // Dark pixel = strong shadow weight
    const src = makeImageData(30, 30, 30);
    const result = applyColorBalance(src, { ...zeroParams, shadowsYellowBlue: 100 });
    expect(result.data[2]).toBeGreaterThan(30); // blue increased
  });

  it("shifts highlights toward green", () => {
    // Bright pixel = strong highlight weight
    const src = makeImageData(220, 220, 220);
    const result = applyColorBalance(src, { ...zeroParams, highlightsMagentaGreen: 100 });
    expect(result.data[1]).toBeGreaterThan(220); // green increased
  });

  it("preserves alpha channel", () => {
    const src = makeImageData(128, 128, 128, 90);
    const result = applyColorBalance(src, { ...zeroParams, midtonesCyanRed: 50 });
    expect(result.data[3]).toBe(90);
  });
});

describe("motion blur", () => {
  function make4x4(value: number): ImageData {
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
    return new ImageData(data, w, h);
  }

  it("returns unchanged at distance < 1", () => {
    const src = makeImageData(100, 150, 200, 255, 4);
    const result = applyMotionBlur(src, { angle: 0, distance: 0 });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
  });

  it("uniform image stays uniform after motion blur", () => {
    const src = make4x4(128);
    const result = applyMotionBlur(src, { angle: 45, distance: 3 });
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(128);
  });

  it("preserves dimensions", () => {
    const src = make4x4(100);
    const result = applyMotionBlur(src, { angle: 90, distance: 2 });
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it("preserves alpha on uniform image", () => {
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100; data[i + 1] = 100; data[i + 2] = 100; data[i + 3] = 200;
    }
    const src = new ImageData(data, w, h);
    const result = applyMotionBlur(src, { angle: 0, distance: 2 });
    expect(result.data[3]).toBe(200);
  });
});

describe("add noise", () => {
  it("returns unchanged at zero amount", () => {
    const src = makeImageData(100, 150, 200);
    const result = applyAddNoise(src, { amount: 0, monochrome: true });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it("modifies pixels at non-zero amount", () => {
    // With high amount, at least some pixels should change (probabilistic but near-certain)
    const src = makeImageData(128, 128, 128, 255, 100);
    const result = applyAddNoise(src, { amount: 50, monochrome: false });
    let changed = false;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i] !== 128) { changed = true; break; }
    }
    expect(changed).toBe(true);
  });

  it("monochrome noise shifts R/G/B equally per pixel", () => {
    const src = makeImageData(128, 128, 128, 255, 100);
    const result = applyAddNoise(src, { amount: 50, monochrome: true });
    // For each pixel, R-128 should equal G-128 should equal B-128
    for (let i = 0; i < result.data.length; i += 4) {
      const dr = result.data[i] - 128;
      const dg = result.data[i + 1] - 128;
      const db = result.data[i + 2] - 128;
      expect(dr).toBe(dg);
      expect(dg).toBe(db);
    }
  });

  it("preserves alpha channel", () => {
    const src = makeImageData(128, 128, 128, 80);
    const result = applyAddNoise(src, { amount: 50, monochrome: true });
    expect(result.data[3]).toBe(80);
  });
});

describe("reduce noise", () => {
  it("returns unchanged at zero strength", () => {
    const src = makeImageData(100, 150, 200, 255, 4);
    const result = applyReduceNoise(src, { strength: 0 });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
  });

  it("uniform image stays uniform", () => {
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100; data[i + 1] = 100; data[i + 2] = 100; data[i + 3] = 255;
    }
    const src = new ImageData(data, w, h);
    const result = applyReduceNoise(src, { strength: 50 });
    expect(result.data[0]).toBe(100);
  });

  it("preserves alpha channel", () => {
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100; data[i + 1] = 100; data[i + 2] = 100; data[i + 3] = 70;
    }
    const src = new ImageData(data, w, h);
    const result = applyReduceNoise(src, { strength: 50 });
    expect(result.data[3]).toBe(70);
  });

  it("preserves dimensions", () => {
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100; data[i + 1] = 100; data[i + 2] = 100; data[i + 3] = 255;
    }
    const src = new ImageData(data, w, h);
    const result = applyReduceNoise(src, { strength: 50 });
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });
});

describe("computeHistogram", () => {
  it("counts luminance values", () => {
    // 4 pixels all black (lum=0)
    const src = makeImageData(0, 0, 0, 255, 4);
    const hist = computeHistogram(src);
    expect(hist[0]).toBe(4);
    expect(hist[128]).toBe(0);
  });

  it("returns 256 bins", () => {
    const src = makeImageData(128, 128, 128, 255, 1);
    const hist = computeHistogram(src);
    expect(hist.length).toBe(256);
  });
});

describe("levels", () => {
  it("returns unchanged at default params", () => {
    const src = makeImageData(128, 64, 200);
    const result = applyLevels(src, { inputBlack: 0, gamma: 1, inputWhite: 255 });
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(64);
    expect(result.data[2]).toBe(200);
  });

  it("clips black point", () => {
    const src = makeImageData(50, 50, 50);
    const result = applyLevels(src, { inputBlack: 100, gamma: 1, inputWhite: 255 });
    // 50 < 100, so should map to 0
    expect(result.data[0]).toBe(0);
  });

  it("clips white point", () => {
    const src = makeImageData(200, 200, 200);
    const result = applyLevels(src, { inputBlack: 0, gamma: 1, inputWhite: 150 });
    // 200 > 150, should map to 255
    expect(result.data[0]).toBe(255);
  });

  it("gamma < 1 darkens midtones", () => {
    const src = makeImageData(128, 128, 128);
    const result = applyLevels(src, { inputBlack: 0, gamma: 0.5, inputWhite: 255 });
    expect(result.data[0]).toBeLessThan(128);
  });

  it("gamma > 1 brightens midtones", () => {
    const src = makeImageData(128, 128, 128);
    const result = applyLevels(src, { inputBlack: 0, gamma: 2, inputWhite: 255 });
    expect(result.data[0]).toBeGreaterThan(128);
  });

  it("preserves alpha", () => {
    const src = makeImageData(128, 128, 128, 90);
    const result = applyLevels(src, { inputBlack: 0, gamma: 1, inputWhite: 255 });
    expect(result.data[3]).toBe(90);
  });
});

describe("buildCurveLUT", () => {
  it("identity curve (0,0)-(255,255) maps each value to itself", () => {
    const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it("inverted curve (0,255)-(255,0) inverts values", () => {
    const lut = buildCurveLUT([{ x: 0, y: 255 }, { x: 255, y: 0 }]);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
    // midpoint should be near 128
    expect(Math.abs(lut[128] - 127)).toBeLessThan(5);
  });

  it("empty points produce identity", () => {
    const lut = buildCurveLUT([]);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it("single point fills entire LUT with that value", () => {
    const lut = buildCurveLUT([{ x: 100, y: 200 }]);
    expect(lut[0]).toBe(200);
    expect(lut[128]).toBe(200);
    expect(lut[255]).toBe(200);
  });

  it("three-point curve: midpoint above identity brightens midtones", () => {
    const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }]);
    expect(lut[128]).toBeGreaterThan(128);
  });
});

describe("applyCurves", () => {
  it("identity curve leaves pixels unchanged", () => {
    const src = makeImageData(100, 150, 200);
    const result = applyCurves(src, { points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it("preserves alpha", () => {
    const src = makeImageData(100, 100, 100, 75);
    const result = applyCurves(src, { points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] });
    expect(result.data[3]).toBe(75);
  });

  it("inverted curve inverts pixel values", () => {
    const src = makeImageData(0, 128, 255);
    const result = applyCurves(src, { points: [{ x: 0, y: 255 }, { x: 255, y: 0 }] });
    expect(result.data[0]).toBe(255); // 0 -> 255
    expect(result.data[2]).toBe(0);   // 255 -> 0
  });
});

describe("gradient map", () => {
  it("black-to-white gradient preserves luminance-like mapping", () => {
    const src = makeImageData(128, 128, 128);
    const result = applyGradientMap(src, {
      stops: [
        { position: 0, r: 0, g: 0, b: 0 },
        { position: 1, r: 255, g: 255, b: 255 },
      ],
    });
    // Gray pixel should map to gray
    expect(Math.abs(result.data[0] - 128)).toBeLessThan(5);
  });

  it("maps pure black to start of gradient", () => {
    const src = makeImageData(0, 0, 0);
    const result = applyGradientMap(src, {
      stops: [
        { position: 0, r: 255, g: 0, b: 0 },
        { position: 1, r: 0, g: 0, b: 255 },
      ],
    });
    expect(result.data[0]).toBe(255); // red
    expect(result.data[2]).toBe(0);   // no blue
  });

  it("maps pure white to end of gradient", () => {
    const src = makeImageData(255, 255, 255);
    const result = applyGradientMap(src, {
      stops: [
        { position: 0, r: 255, g: 0, b: 0 },
        { position: 1, r: 0, g: 0, b: 255 },
      ],
    });
    expect(result.data[0]).toBe(0);   // no red
    expect(result.data[2]).toBe(255); // blue
  });

  it("preserves alpha", () => {
    const src = makeImageData(128, 128, 128, 80);
    const result = applyGradientMap(src, {
      stops: [
        { position: 0, r: 0, g: 0, b: 0 },
        { position: 1, r: 255, g: 255, b: 255 },
      ],
    });
    expect(result.data[3]).toBe(80);
  });

  it("returns copy for empty stops", () => {
    const src = makeImageData(128, 64, 200);
    const result = applyGradientMap(src, { stops: [] });
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(64);
  });

  it("presets array is not empty", () => {
    expect(GRADIENT_PRESETS.length).toBeGreaterThan(0);
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.stops.length).toBeGreaterThanOrEqual(2);
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });
});

describe("parseCubeLUT", () => {
  it("parses a minimal 2x2x2 cube LUT", () => {
    const cube = `# comment
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
    const lut = parseCubeLUT(cube);
    expect(lut).not.toBeNull();
    expect(lut!.size).toBe(2);
    expect(lut!.data.length).toBe(2 * 2 * 2 * 3);
  });

  it("returns null for invalid input", () => {
    expect(parseCubeLUT("garbage")).toBeNull();
    expect(parseCubeLUT("LUT_3D_SIZE 2\n0.0 0.0")).toBeNull();
  });
});

describe("applyLUT", () => {
  function makeIdentityLUT(size: number): { size: number; data: Float32Array } {
    const data = new Float32Array(size * size * size * 3);
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const idx = (b * size * size + g * size + r) * 3;
          data[idx]     = r / (size - 1);
          data[idx + 1] = g / (size - 1);
          data[idx + 2] = b / (size - 1);
        }
      }
    }
    return { size, data };
  }

  it("identity LUT preserves pixels", () => {
    const lut = makeIdentityLUT(4);
    const src = makeImageData(100, 150, 200);
    const result = applyLUT(src, { lut, intensity: 100 });
    expect(Math.abs(result.data[0] - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(result.data[1] - 150)).toBeLessThanOrEqual(2);
    expect(Math.abs(result.data[2] - 200)).toBeLessThanOrEqual(2);
  });

  it("zero intensity preserves pixels exactly", () => {
    const lut = makeIdentityLUT(2);
    const src = makeImageData(100, 150, 200);
    const result = applyLUT(src, { lut, intensity: 0 });
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it("preserves alpha", () => {
    const lut = makeIdentityLUT(2);
    const src = makeImageData(100, 100, 100, 80);
    const result = applyLUT(src, { lut, intensity: 100 });
    expect(result.data[3]).toBe(80);
  });
});
