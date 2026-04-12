import { describe, expect, it } from "vitest";
import {
  computeCaptureHudPosition,
  computeCaptureDrawMetrics,
  computeLensBands,
  describeCaptureFailure,
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

  it("maps capture permission failures to clearer guidance", () => {
    expect(describeCaptureFailure("Permission denied by OS", "fallback")).toBe(
      "Screen capture permission was denied. Allow desktop capture for Vision Goblin, then try again.",
    );
    expect(describeCaptureFailure("Window not found", "fallback")).toBe("That window is no longer available to capture.");
  });

  it("positions the picker hud beside the cursor while staying onscreen", () => {
    expect(computeCaptureHudPosition(160, 120, 180, 140, 1280, 720)).toEqual({ left: 184, top: 144 });
    expect(computeCaptureHudPosition(1240, 690, 180, 140, 1280, 720)).toEqual({ left: 1036, top: 526 });
  });

  it("builds lens bands with a larger centre area", () => {
    const bands = computeLensBands(120, 11);
    const lastBand = bands[bands.length - 1];
    expect(bands).toHaveLength(11);
    expect(bands[5].size).toBeGreaterThan(bands[0].size);
    expect(bands[5].size).toBeGreaterThan(bands[10].size);
    expect(bands.reduce((sum, band) => sum + band.size, 0)).toBe(120);
    expect(bands[0].start).toBe(0);
    expect(lastBand.start + lastBand.size).toBe(120);
  });
});
