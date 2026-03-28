import { describe, expect, it } from "vitest";
import { applyDisplacementMapToImageData, applyLiquifyBrush, hasLiquifyDisplacement } from "./liquify";

describe("liquify helpers", () => {
  it("detects whether any displacement exceeds the threshold", () => {
    const dispX = new Float32Array([0, 0.02]);
    const dispY = new Float32Array([0, 0]);

    expect(hasLiquifyDisplacement(dispX, dispY)).toBe(true);
    expect(hasLiquifyDisplacement(new Float32Array([0, 0.001]), new Float32Array([0, 0.001]))).toBe(false);
  });

  it("pushes nearby displacement values with radial falloff", () => {
    const dispX = new Float32Array(25);
    const dispY = new Float32Array(25);

    applyLiquifyBrush({
      dispX,
      dispY,
      width: 5,
      height: 5,
      centerX: 2,
      centerY: 2,
      brushSize: 2,
      strength: 1,
      moveX: 4,
      moveY: -2,
      mode: "push",
    });

    expect(dispX[2 + 2 * 5]).toBeGreaterThan(0);
    expect(dispY[2 + 2 * 5]).toBeLessThan(0);
    expect(dispX[0]).toBe(0);
    expect(dispY[0]).toBe(0);
  });

  it("samples source pixels through the displacement map", () => {
    const source = new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]), 2, 1);
    const dispX = new Float32Array([0, 1]);
    const dispY = new Float32Array([0, 0]);

    const result = applyDisplacementMapToImageData(source, dispX, dispY);

    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(result.data.slice(4, 8))).toEqual([255, 0, 0, 255]);
  });
});
