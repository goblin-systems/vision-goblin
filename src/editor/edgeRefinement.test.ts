import { describe, it, expect } from "vitest";
import {
  morphExpand,
  boxBlurSmooth,
  gaussianFeather,
  alphaToMaskCanvas,
} from "./edgeRefinement";

describe("edgeRefinement", () => {
  describe("morphExpand", () => {
    it("expands a single pixel outward", () => {
      // 5x5 grid with center pixel selected
      const alpha = new Float32Array(25);
      alpha[12] = 1.0; // center (2,2)
      const expanded = morphExpand(alpha, 5, 5, 1);
      // Center should still be 1
      expect(expanded[12]).toBeCloseTo(1.0);
      // Adjacent pixels (within radius 1) should now be 1.0
      expect(expanded[7]).toBeCloseTo(1.0);  // (2,1) - up
      expect(expanded[17]).toBeCloseTo(1.0); // (2,3) - down
      expect(expanded[11]).toBeCloseTo(1.0); // (1,2) - left
      expect(expanded[13]).toBeCloseTo(1.0); // (3,2) - right
      // Corner pixels at distance sqrt(2) > 1 should remain 0
      expect(expanded[6]).toBeCloseTo(0.0);  // (1,1)
    });

    it("expands with a larger radius", () => {
      const alpha = new Float32Array(25);
      alpha[12] = 1.0; // center (2,2)
      const expanded = morphExpand(alpha, 5, 5, 2);
      // Diagonal pixel at distance sqrt(2) ≈ 1.41 should now be selected
      expect(expanded[6]).toBeCloseTo(1.0);  // (1,1)
      expect(expanded[8]).toBeCloseTo(1.0);  // (3,1)
    });

    it("contracts a filled region", () => {
      // 5x5 grid fully selected
      const alpha = new Float32Array(25).fill(1.0);
      const contracted = morphExpand(alpha, 5, 5, -1);
      // Corner (0,0) is at edge, its neighbor outside the grid is effectively 0
      // So corners should be contracted
      expect(contracted[0]).toBeCloseTo(0.0);  // (0,0) corner
      // Center (2,2) is far from edges, should remain 1
      expect(contracted[12]).toBeCloseTo(1.0);
    });

    it("returns same array when amount is 0", () => {
      const alpha = new Float32Array([0, 1, 0, 1]);
      const result = morphExpand(alpha, 2, 2, 0);
      expect(result).toBe(alpha); // same reference
    });

    it("handles partial alpha values in expand", () => {
      // 3x3 with center at 0.5
      const alpha = new Float32Array(9);
      alpha[4] = 0.5; // center
      const expanded = morphExpand(alpha, 3, 3, 1);
      // Adjacent pixels should pick up the 0.5 value
      expect(expanded[1]).toBeCloseTo(0.5); // (1,0) - up
      expect(expanded[3]).toBeCloseTo(0.5); // (0,1) - left
    });
  });

  describe("boxBlurSmooth", () => {
    it("does nothing when smooth is 0", () => {
      const alpha = new Float32Array([1, 0, 0, 0]);
      const original = new Float32Array(alpha);
      boxBlurSmooth(alpha, 2, 2, 0);
      expect(alpha).toEqual(original);
    });

    it("smooths a single bright pixel toward neighbours", () => {
      // 3x3 with center pixel only
      const alpha = new Float32Array(9);
      alpha[4] = 1.0; // center
      boxBlurSmooth(alpha, 3, 3, 10);
      // After smoothing, center should be less than 1
      expect(alpha[4]).toBeLessThan(1.0);
      expect(alpha[4]).toBeGreaterThan(0.0);
      // Adjacent should gain some value
      expect(alpha[1]).toBeGreaterThan(0.0);
      expect(alpha[3]).toBeGreaterThan(0.0);
    });

    it("preserves total energy approximately", () => {
      const alpha = new Float32Array(9);
      alpha[4] = 1.0;
      const sumBefore = alpha.reduce((a, b) => a + b, 0);
      boxBlurSmooth(alpha, 3, 3, 10);
      const sumAfter = alpha.reduce((a, b) => a + b, 0);
      // Box blur should roughly preserve total energy (some edge loss expected)
      expect(sumAfter).toBeGreaterThan(sumBefore * 0.5);
    });
  });

  describe("gaussianFeather", () => {
    it("does nothing when sigma is 0", () => {
      const alpha = new Float32Array([1, 0, 0, 0]);
      const original = new Float32Array(alpha);
      gaussianFeather(alpha, 2, 2, 0);
      expect(alpha).toEqual(original);
    });

    it("blurs a sharp edge", () => {
      // 10x1 strip: left half selected, right half not
      const alpha = new Float32Array(10);
      for (let i = 0; i < 5; i++) alpha[i] = 1.0;
      gaussianFeather(alpha, 10, 1, 1);
      // Edge transition should be smooth
      expect(alpha[3]).toBeGreaterThan(0.8); // well inside selected area
      expect(alpha[4]).toBeLessThan(1.0);    // at the edge
      expect(alpha[4]).toBeGreaterThan(0.3); // still mostly selected
      expect(alpha[5]).toBeGreaterThan(0.0); // bleeding into unselected
      expect(alpha[5]).toBeLessThan(0.7);
    });

    it("blurs in 2D", () => {
      // 5x5 with center pixel
      const alpha = new Float32Array(25);
      alpha[12] = 1.0; // center (2,2)
      gaussianFeather(alpha, 5, 5, 1);
      // Center should decrease
      expect(alpha[12]).toBeLessThan(1.0);
      // Adjacent should gain value
      expect(alpha[7]).toBeGreaterThan(0.0);  // up
      expect(alpha[11]).toBeGreaterThan(0.0); // left
      // Diagonal should also gain some value (but less)
      expect(alpha[6]).toBeGreaterThan(0.0);
      expect(alpha[6]).toBeLessThan(alpha[7]); // diagonal < orthogonal
    });
  });

  describe("alphaToMaskCanvas", () => {
    it("creates a canvas with correct dimensions", () => {
      const alpha = new Float32Array([1, 0, 0.5, 0]);
      const canvas = alphaToMaskCanvas(alpha, 2, 2);
      expect(canvas.width).toBe(2);
      expect(canvas.height).toBe(2);
    });

    it("calls putImageData with correct data", () => {
      const alpha = new Float32Array([1, 0]);
      const canvas = alphaToMaskCanvas(alpha, 2, 1);
      const ctx = canvas.getContext("2d")!;
      expect(ctx.putImageData).toHaveBeenCalled();
    });

    it("clamps values outside 0-1 range", () => {
      // Should not throw for out-of-range values
      const alpha = new Float32Array([1.5, -0.5, 0, 0.5]);
      expect(() => alphaToMaskCanvas(alpha, 2, 2)).not.toThrow();
    });
  });

  describe("integration: expand then feather", () => {
    it("expand then feather produces smooth expanded edge", () => {
      // 10x10 with 4x4 block in center
      const alpha = new Float32Array(100);
      for (let y = 3; y < 7; y++) {
        for (let x = 3; x < 7; x++) {
          alpha[y * 10 + x] = 1.0;
        }
      }
      // Expand by 1
      const expanded = morphExpand(alpha, 10, 10, 1);
      // The pixel at (2,5) should now be selected (was adjacent to selected)
      expect(expanded[5 * 10 + 2]).toBeCloseTo(1.0);

      // Feather the expanded mask
      const feathered = new Float32Array(expanded);
      gaussianFeather(feathered, 10, 10, 1);
      // Edge should now be soft
      const edgeVal = feathered[5 * 10 + 1]; // one pixel outside expanded area
      expect(edgeVal).toBeGreaterThan(0.0);
      expect(edgeVal).toBeLessThan(1.0);
    });
  });
});
