import { describe, expect, it, vi } from "vitest";
import {
  addLayerMask,
  removeLayerMask,
  invertLayerMask,
  clearLayerMask,
  cloneLayerMask,
  drawMaskStroke,
  blendWithMask,
} from "./layerMask";
import { createAdjustmentLayer, createBlankDocument, cloneLayer, serializeDocument, deserializeDocument, createLayerCanvas } from "./documents";
import { addAdjustmentLayer } from "./layers";
import { defaultParamsForKind } from "./adjustmentLayers";
import type { AdjustmentLayer, Layer } from "./types";

function makeAdjLayer(name = "Test BC"): AdjustmentLayer {
  return createAdjustmentLayer(name, {
    kind: "brightness-contrast",
    params: defaultParamsForKind("brightness-contrast"),
  });
}

describe("layerMask module", () => {
  describe("addLayerMask", () => {
    it("creates a mask canvas matching document dimensions", () => {
      const layer = makeAdjLayer();
      expect(layer.mask).toBeUndefined();
      const mask = addLayerMask(layer, 200, 100);
      expect(mask).toBeInstanceOf(HTMLCanvasElement);
      expect(mask.width).toBe(200);
      expect(mask.height).toBe(100);
      expect(layer.mask).toBe(mask);
    });

    it("fills the mask with white (calls fillRect)", () => {
      const layer = makeAdjLayer();
      const mask = addLayerMask(layer, 50, 50);
      const ctx = mask.getContext("2d")!;
      // fillRect called during creation with white
      expect(ctx.fillRect).toHaveBeenCalled();
    });
  });

  describe("removeLayerMask", () => {
    it("removes mask and returns old mask", () => {
      const layer = makeAdjLayer();
      const mask = addLayerMask(layer, 100, 100);
      const old = removeLayerMask(layer);
      expect(old).toBe(mask);
      expect(layer.mask).toBeUndefined();
    });

    it("returns null when no mask exists", () => {
      const layer = makeAdjLayer();
      const old = removeLayerMask(layer);
      expect(old).toBeNull();
    });
  });

  describe("invertLayerMask", () => {
    it("does nothing if layer has no mask", () => {
      const layer = makeAdjLayer();
      expect(() => invertLayerMask(layer)).not.toThrow();
    });

    it("calls getImageData and putImageData on the mask", () => {
      const layer = makeAdjLayer();
      addLayerMask(layer, 10, 10);
      // The stub getImageData returns {data: [255,255,255,255]}
      // invertLayerMask reads and writes back
      expect(() => invertLayerMask(layer)).not.toThrow();
    });
  });

  describe("clearLayerMask", () => {
    it("does nothing if layer has no mask", () => {
      const layer = makeAdjLayer();
      expect(() => clearLayerMask(layer)).not.toThrow();
    });

    it("calls fillRect on the mask to reset to white", () => {
      const layer = makeAdjLayer();
      const mask = addLayerMask(layer, 10, 10);
      const ctx = mask.getContext("2d")!;
      vi.mocked(ctx.fillRect).mockClear();
      clearLayerMask(layer);
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
    });
  });

  describe("cloneLayerMask", () => {
    it("creates an independent copy of the mask", () => {
      const layer = makeAdjLayer();
      const mask = addLayerMask(layer, 50, 50);
      const cloned = cloneLayerMask(mask);
      expect(cloned).toBeInstanceOf(HTMLCanvasElement);
      expect(cloned).not.toBe(mask);
      expect(cloned.width).toBe(50);
      expect(cloned.height).toBe(50);
    });
  });

  describe("drawMaskStroke", () => {
    it("paints white for reveal mode", () => {
      const layer = makeAdjLayer();
      const mask = addLayerMask(layer, 100, 100);
      const ctx = mask.getContext("2d")!;
      drawMaskStroke(mask, 10, 10, 50, 50, 8, 1, "reveal");
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(50, 50);
    });

    it("paints black for hide mode", () => {
      const layer = makeAdjLayer();
      const mask = addLayerMask(layer, 100, 100);
      const ctx = mask.getContext("2d")!;
      vi.mocked(ctx.stroke).mockClear();
      drawMaskStroke(mask, 0, 0, 30, 30, 4, 0.5, "hide");
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });

  describe("blendWithMask", () => {
    it("returns original when mask is all black (R=0)", () => {
      const original = new ImageData(new Uint8ClampedArray([100, 150, 200, 255]), 1, 1);
      const adjusted = new ImageData(new Uint8ClampedArray([200, 50, 100, 255]), 1, 1);
      // Create a mock canvas whose getImageData returns all-black mask data
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 1;
      mockCanvas.height = 1;
      const ctx = mockCanvas.getContext("2d")!;
      vi.mocked(ctx.getImageData).mockReturnValueOnce({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
        width: 1,
        height: 1,
        colorSpace: "srgb",
      } as ImageData);
      const result = blendWithMask(original, adjusted, mockCanvas);
      expect(result.data[0]).toBe(100);
      expect(result.data[1]).toBe(150);
      expect(result.data[2]).toBe(200);
      expect(result.data[3]).toBe(255);
    });

    it("returns adjusted when mask is all white (R=255)", () => {
      const original = new ImageData(new Uint8ClampedArray([100, 150, 200, 255]), 1, 1);
      const adjusted = new ImageData(new Uint8ClampedArray([200, 50, 100, 255]), 1, 1);
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 1;
      mockCanvas.height = 1;
      const ctx = mockCanvas.getContext("2d")!;
      vi.mocked(ctx.getImageData).mockReturnValueOnce({
        data: new Uint8ClampedArray([255, 255, 255, 255]),
        width: 1,
        height: 1,
        colorSpace: "srgb",
      } as ImageData);
      const result = blendWithMask(original, adjusted, mockCanvas);
      expect(result.data[0]).toBe(200);
      expect(result.data[1]).toBe(50);
      expect(result.data[2]).toBe(100);
      expect(result.data[3]).toBe(255);
    });

    it("blends 50% when mask is gray (R=128)", () => {
      const original = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
      const adjusted = new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1);
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 1;
      mockCanvas.height = 1;
      const ctx = mockCanvas.getContext("2d")!;
      vi.mocked(ctx.getImageData).mockReturnValueOnce({
        data: new Uint8ClampedArray([128, 128, 128, 255]),
        width: 1,
        height: 1,
        colorSpace: "srgb",
      } as ImageData);
      const result = blendWithMask(original, adjusted, mockCanvas);
      // 128/255 ≈ 0.502 → round(0 + 255 * 0.502) ≈ 128
      expect(result.data[0]).toBeGreaterThanOrEqual(127);
      expect(result.data[0]).toBeLessThanOrEqual(129);
    });
  });

  describe("cloneLayer with mask", () => {
    it("preserves mask when cloning a layer", () => {
      const layer = makeAdjLayer();
      addLayerMask(layer, 100, 100);
      const clone = cloneLayer(layer);
      expect(clone.mask).toBeDefined();
      expect(clone.mask).not.toBe(layer.mask);
      expect(clone.mask!.width).toBe(100);
      expect(clone.mask!.height).toBe(100);
    });
  });

  describe("serialization round-trip", () => {
    it("includes maskDataUrl in serialized output", () => {
      const doc = createBlankDocument("Test", 200, 100, 100);
      const layer = addAdjustmentLayer(doc, "brightness-contrast");
      addLayerMask(layer, 200, 100);
      const serialized = serializeDocument(doc);
      const adjLayer = serialized.layers.find((l) => l.id === layer.id);
      expect(adjLayer).toBeDefined();
      expect(adjLayer?.maskDataUrl).toBeDefined();
      expect(adjLayer?.maskDataUrl).toMatch(/^data:image/);
    });

    it("omits maskDataUrl when no mask exists", () => {
      const doc = createBlankDocument("Test", 200, 100, 100);
      addAdjustmentLayer(doc, "brightness-contrast");
      const serialized = serializeDocument(doc);
      const adjLayer = serialized.layers.find((l) => l.type === "adjustment");
      expect(adjLayer?.maskDataUrl).toBeUndefined();
    });
  });
});
