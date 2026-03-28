import { describe, expect, it } from "vitest";
import {
  computeCaptureDrawMetrics,
  formatCaptureError,
  getCaptureSelectionFromDrag,
  mapClientPointToBitmapPoint,
} from "./captureController";

describe("captureController helpers", () => {
  it("normalizes drag points into a positive capture selection", () => {
    expect(getCaptureSelectionFromDrag(40, 18, 12, 70)).toEqual({
      left: 12,
      top: 18,
      width: 28,
      height: 52,
    });
  });

  it("computes 1:1 draw metrics for high-dpi screenshots", () => {
    expect(computeCaptureDrawMetrics(
      { left: 0, top: 0, width: 1440, height: 900 },
      2,
      { width: 2880, height: 1800 },
    )).toEqual({
      drawX: 0,
      drawY: 0,
      drawWidth: 1440,
      drawHeight: 900,
      scale: 0.5,
    });
  });

  it("clamps canvas coordinates into bitmap space", () => {
    const metrics = {
      drawX: 100,
      drawY: 50,
      drawWidth: 400,
      drawHeight: 200,
      scale: 0.5,
    };

    expect(mapClientPointToBitmapPoint(50, 20, { left: 0, top: 0, width: 800, height: 600 }, metrics)).toEqual({ x: 0, y: 0 });
    expect(mapClientPointToBitmapPoint(700, 400, { left: 0, top: 0, width: 800, height: 600 }, metrics)).toEqual({ x: 800, y: 400 });
    expect(mapClientPointToBitmapPoint(250, 125, { left: 0, top: 0, width: 800, height: 600 }, metrics)).toEqual({ x: 300, y: 150 });
  });

  it("formats capture errors with useful fallbacks", () => {
    expect(formatCaptureError("Permission denied", "fallback")).toBe("Permission denied");
    expect(formatCaptureError(new Error("Window gone"), "fallback")).toBe("Window gone");
    expect(formatCaptureError(new Error("   "), "fallback")).toBe("fallback");
  });
});
