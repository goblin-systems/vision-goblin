import { describe, expect, it } from "vitest";
import {
  rgbToLab,
  labDistance,
  buildColorRangeMask,
  alphaToMaskImageData,
  samplePixel,
} from "./colorRange";

describe("colorRange", () => {
  describe("rgbToLab", () => {
    it("converts black", () => {
      const lab = rgbToLab(0, 0, 0);
      expect(lab.L).toBeCloseTo(0, 0);
    });

    it("converts white", () => {
      const lab = rgbToLab(255, 255, 255);
      expect(lab.L).toBeCloseTo(100, 0);
    });

    it("converts pure red", () => {
      const lab = rgbToLab(255, 0, 0);
      expect(lab.L).toBeGreaterThan(50);
      expect(lab.a).toBeGreaterThan(60); // positive a = red
    });

    it("converts pure green", () => {
      const lab = rgbToLab(0, 255, 0);
      expect(lab.a).toBeLessThan(-80); // negative a = green
    });
  });

  describe("labDistance", () => {
    it("returns 0 for identical colors", () => {
      const lab = rgbToLab(128, 64, 32);
      expect(labDistance(lab, lab)).toBe(0);
    });

    it("returns positive distance for different colors", () => {
      const a = rgbToLab(255, 0, 0);
      const b = rgbToLab(0, 0, 255);
      expect(labDistance(a, b)).toBeGreaterThan(50);
    });

    it("similar colors have small distance", () => {
      const a = rgbToLab(100, 100, 100);
      const b = rgbToLab(105, 100, 100);
      expect(labDistance(a, b)).toBeLessThan(5);
    });
  });

  describe("buildColorRangeMask", () => {
    function makeImageData(pixels: Array<[number, number, number, number]>, width: number): ImageData {
      const height = pixels.length / width;
      const data = new Uint8ClampedArray(pixels.length * 4);
      for (let i = 0; i < pixels.length; i++) {
        data[i * 4] = pixels[i][0];
        data[i * 4 + 1] = pixels[i][1];
        data[i * 4 + 2] = pixels[i][2];
        data[i * 4 + 3] = pixels[i][3];
      }
      return new ImageData(data, width, height);
    }

    it("selects exact color match with fuzziness 0", () => {
      const imgData = makeImageData([
        [255, 0, 0, 255],   // red
        [0, 255, 0, 255],   // green
        [0, 0, 255, 255],   // blue
        [255, 0, 0, 255],   // red
      ], 2);
      const mask = buildColorRangeMask(imgData, {
        samples: [[255, 0, 0]],
        fuzziness: 0,
      });
      expect(mask[0]).toBe(255);  // red → selected
      expect(mask[1]).toBe(0);    // green → not
      expect(mask[2]).toBe(0);    // blue → not
      expect(mask[3]).toBe(255);  // red → selected
    });

    it("selects similar colors with higher fuzziness", () => {
      const imgData = makeImageData([
        [255, 0, 0, 255],   // red
        [240, 10, 10, 255], // slightly different red
        [0, 255, 0, 255],   // green - far away
      ], 3);
      const mask = buildColorRangeMask(imgData, {
        samples: [[255, 0, 0]],
        fuzziness: 30,
      });
      expect(mask[0]).toBe(255);    // exact match
      expect(mask[1]).toBeGreaterThan(0);  // close match
      expect(mask[2]).toBe(0);      // green - too far
    });

    it("returns empty mask with no samples", () => {
      const imgData = makeImageData([[255, 0, 0, 255]], 1);
      const mask = buildColorRangeMask(imgData, { samples: [], fuzziness: 40 });
      expect(mask[0]).toBe(0);
    });

    it("skips transparent pixels", () => {
      const imgData = makeImageData([
        [255, 0, 0, 0],     // transparent red
        [255, 0, 0, 255],   // opaque red
      ], 2);
      const mask = buildColorRangeMask(imgData, {
        samples: [[255, 0, 0]],
        fuzziness: 10,
      });
      expect(mask[0]).toBe(0);    // transparent → skipped
      expect(mask[1]).toBe(255);  // opaque → selected
    });

    it("supports multiple sampled colors", () => {
      const imgData = makeImageData([
        [255, 0, 0, 255],   // red
        [0, 0, 255, 255],   // blue
        [0, 255, 0, 255],   // green
      ], 3);
      const mask = buildColorRangeMask(imgData, {
        samples: [[255, 0, 0], [0, 0, 255]],
        fuzziness: 10,
      });
      expect(mask[0]).toBe(255);  // red → selected
      expect(mask[1]).toBe(255);  // blue → selected
      expect(mask[2]).toBe(0);    // green → not
    });
  });

  describe("alphaToMaskImageData", () => {
    it("converts alpha mask to RGBA", () => {
      const mask = new Uint8ClampedArray([255, 0, 128]);
      const imgData = alphaToMaskImageData(mask, 3, 1);
      // Pixel 0: fully selected → white
      expect(imgData.data[0]).toBe(255);
      expect(imgData.data[3]).toBe(255);
      // Pixel 1: not selected → transparent
      expect(imgData.data[7]).toBe(0);
      // Pixel 2: partially selected
      expect(imgData.data[8]).toBe(255);
      expect(imgData.data[11]).toBe(128);
    });
  });

  describe("samplePixel", () => {
    it("returns RGB at valid coordinates", () => {
      const imgData = new ImageData(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
      const result = samplePixel(imgData, 0, 0);
      expect(result).toEqual([10, 20, 30]);
    });

    it("returns null for out of bounds", () => {
      const imgData = new ImageData(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
      expect(samplePixel(imgData, -1, 0)).toBeNull();
      expect(samplePixel(imgData, 0, 1)).toBeNull();
    });
  });
});
