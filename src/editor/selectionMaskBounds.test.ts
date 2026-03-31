import { describe, expect, it } from "vitest";
import { maskBoundingRect, maskContainsRect } from "./selection";

function createMaskFromSelectedPixels(width: number, height: number, pixels: Array<{ x: number; y: number }>): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const pixel of pixels) {
    const index = (pixel.y * width + pixel.x) * 4 + 3;
    data[index] = 255;
  }

  return {
    width,
    height,
    getContext: () => ({
      getImageData: () => ({ data, width, height }),
    }),
  } as unknown as HTMLCanvasElement;
}

describe("selection mask bounds helpers", () => {
  it("detects when a rect still contains selected pixels", () => {
    const mask = createMaskFromSelectedPixels(10, 10, [
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ]);

    expect(maskContainsRect(mask, { x: 3, y: 4, width: 4, height: 4 })).toBe(true);
  });

  it("returns false when a rect misses the selected area", () => {
    const mask = createMaskFromSelectedPixels(10, 10, [
      { x: 7, y: 7 },
      { x: 8, y: 7 },
      { x: 7, y: 8 },
      { x: 8, y: 8 },
    ]);

    expect(maskContainsRect(mask, { x: 1, y: 1, width: 3, height: 3 })).toBe(false);
  });

  it("still reports the tight mask bounds independently", () => {
    const mask = createMaskFromSelectedPixels(10, 10, [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ]);

    expect(maskBoundingRect(mask)).toEqual({ x: 2, y: 3, width: 4, height: 2 });
  });
});
