/**
 * Adjustment layer support — bridges AdjustmentLayerData to the existing
 * pixel-level adjustment functions so they can be applied non-destructively
 * during compositing.
 */

import type { AdjustmentKind, AdjustmentLayerData } from "./types";
import {
  applyBrightnessContrast,
  applyColorBalance,
  applyCurves,
  applyGradientMap,
  applyHueSaturation,
  applyLevels,
  type BrightnessContrastParams,
  type ColorBalanceParams,
  type CurvesParams,
  type GradientMapParams,
  type HueSaturationParams,
  type LevelsParams,
} from "./adjustments";

// ---------------------------------------------------------------------------
// Default parameter factories for each adjustment kind
// ---------------------------------------------------------------------------

export function defaultParamsForKind(kind: AdjustmentKind): Record<string, unknown> {
  switch (kind) {
    case "brightness-contrast":
      return { brightness: 0, contrast: 0 };
    case "hue-saturation":
      return { hue: 0, saturation: 0, lightness: 0 };
    case "levels":
      return { inputBlack: 0, gamma: 1, inputWhite: 255 };
    case "curves":
      return { points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    case "color-balance":
      return {
        shadowsCyanRed: 0, shadowsMagentaGreen: 0, shadowsYellowBlue: 0,
        midtonesCyanRed: 0, midtonesMagentaGreen: 0, midtonesYellowBlue: 0,
        highlightsCyanRed: 0, highlightsMagentaGreen: 0, highlightsYellowBlue: 0,
      };
    case "gradient-map":
      return {
        stops: [
          { position: 0, r: 0, g: 0, b: 0 },
          { position: 1, r: 255, g: 255, b: 255 },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  "brightness-contrast": "Brightness / Contrast",
  "hue-saturation": "Hue / Saturation",
  "levels": "Levels",
  "curves": "Curves",
  "color-balance": "Color Balance",
  "gradient-map": "Gradient Map",
};

export const ADJUSTMENT_KINDS: AdjustmentKind[] = [
  "brightness-contrast",
  "hue-saturation",
  "levels",
  "curves",
  "color-balance",
  "gradient-map",
];

// ---------------------------------------------------------------------------
// Apply an adjustment layer's params to ImageData
// ---------------------------------------------------------------------------

export function applyAdjustmentLayerParams(data: AdjustmentLayerData, source: ImageData): ImageData {
  const p = data.params;
  switch (data.kind) {
    case "brightness-contrast":
      return applyBrightnessContrast(source, p as unknown as BrightnessContrastParams);
    case "hue-saturation":
      return applyHueSaturation(source, p as unknown as HueSaturationParams);
    case "levels":
      return applyLevels(source, p as unknown as LevelsParams);
    case "curves":
      return applyCurves(source, p as unknown as CurvesParams);
    case "color-balance":
      return applyColorBalance(source, p as unknown as ColorBalanceParams);
    case "gradient-map":
      return applyGradientMap(source, p as unknown as GradientMapParams);
  }
}

/**
 * Returns true if the adjustment's parameters are all at their neutral/default
 * values and would produce no visible change.
 */
export function isAdjustmentNeutral(data: AdjustmentLayerData): boolean {
  const p = data.params;
  switch (data.kind) {
    case "brightness-contrast":
      return (p.brightness as number) === 0 && (p.contrast as number) === 0;
    case "hue-saturation":
      return (p.hue as number) === 0 && (p.saturation as number) === 0 && (p.lightness as number) === 0;
    case "levels":
      return (p.inputBlack as number) === 0 && (p.gamma as number) === 1 && (p.inputWhite as number) === 255;
    case "curves": {
      const pts = p.points as Array<{ x: number; y: number }>;
      return pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 255 && pts[1].y === 255;
    }
    case "color-balance":
      return Object.values(p).every((v) => v === 0);
    case "gradient-map":
      return false; // gradient map always transforms
  }
}
