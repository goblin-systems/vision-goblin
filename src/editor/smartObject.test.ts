import { describe, expect, it } from "vitest";
import {
  createSmartObjectLayer,
  renderSmartObjectLayer,
  convertToSmartObject,
  rasterizeSmartObject,
  replaceSmartObjectSource,
} from "./smartObject";
import { createBlankDocument, createLayerCanvas, cloneLayer, refreshLayerCanvas, serializeDocument } from "./documents";
import { addLayer } from "./layers";
import type { Layer, RasterLayer, SmartObjectLayer } from "./types";

function makeCanvas(w = 100, h = 100): HTMLCanvasElement {
  const c = createLayerCanvas(w, h);
  return c;
}

describe("smartObject module", () => {
  describe("createSmartObjectLayer", () => {
    it("creates a layer with correct structure", () => {
      const source = makeCanvas(200, 150);
      const layer = createSmartObjectLayer("Test Smart Object", source, 10, 20);
      expect(layer.type).toBe("smart-object");
      expect(layer.name).toBe("Test Smart Object");
      expect(layer.x).toBe(10);
      expect(layer.y).toBe(20);
      expect(layer.visible).toBe(true);
      expect(layer.opacity).toBe(1);
      expect(layer.locked).toBe(false);
      expect(layer.smartObjectData).toBeDefined();
      expect(layer.smartObjectData.sourceWidth).toBe(200);
      expect(layer.smartObjectData.sourceHeight).toBe(150);
      expect(layer.smartObjectData.scaleX).toBe(1);
      expect(layer.smartObjectData.scaleY).toBe(1);
      expect(layer.smartObjectData.rotateDeg).toBe(0);
      expect(layer.smartObjectData.sourceDataUrl).toContain("data:image/png");
      expect(layer.smartObjectData.sourceCanvas).toBeDefined();
    });

    it("clones the source canvas so mutations don't affect original", () => {
      const source = makeCanvas(50, 50);
      const layer = createSmartObjectLayer("Clone Test", source);
      expect(layer.smartObjectData.sourceCanvas).not.toBe(source);
      expect(layer.canvas).not.toBe(source);
    });

    it("defaults position to 0,0 when not specified", () => {
      const layer = createSmartObjectLayer("Default Pos", makeCanvas());
      expect(layer.x).toBe(0);
      expect(layer.y).toBe(0);
    });
  });

  describe("renderSmartObjectLayer", () => {
    it("identity transform produces same-size canvas", () => {
      const layer = createSmartObjectLayer("Identity", makeCanvas(80, 60));
      renderSmartObjectLayer(layer);
      expect(layer.canvas.width).toBe(80);
      expect(layer.canvas.height).toBe(60);
    });

    it("does nothing when sourceCanvas is missing", () => {
      const layer = createSmartObjectLayer("No Source", makeCanvas(80, 60));
      layer.smartObjectData.sourceCanvas = undefined;
      const prevCanvas = layer.canvas;
      renderSmartObjectLayer(layer);
      // Canvas should not have changed since we returned early
      expect(layer.canvas).toBe(prevCanvas);
    });

    it("with scale changes canvas dimensions", () => {
      const layer = createSmartObjectLayer("Scaled", makeCanvas(100, 100));
      layer.smartObjectData.scaleX = 2;
      layer.smartObjectData.scaleY = 0.5;
      renderSmartObjectLayer(layer);
      // The output should be roughly 200x50 (scaled bounding box)
      expect(layer.canvas.width).toBeGreaterThan(100);
      expect(layer.canvas.height).toBeLessThanOrEqual(100);
    });

    it("with rotation changes canvas dimensions", () => {
      const layer = createSmartObjectLayer("Rotated", makeCanvas(100, 50));
      layer.smartObjectData.rotateDeg = 45;
      renderSmartObjectLayer(layer);
      // 45-degree rotation of a rectangle expands the bounding box
      expect(layer.canvas.width).toBeGreaterThan(100);
      expect(layer.canvas.height).toBeGreaterThan(50);
    });
  });

  describe("convertToSmartObject", () => {
    it("converts raster layer in-place keeping same ID", () => {
      const doc = createBlankDocument("test", 200, 200, 1);
      const raster = addLayer(doc, "MyRaster");
      const origId = raster.id;
      const layers = doc.layers;
      const smart = convertToSmartObject(layers, origId);
      expect(smart).not.toBeNull();
      expect(smart!.type).toBe("smart-object");
      expect(smart!.id).toBe(origId);
      expect(smart!.name).toBe("MyRaster");
      expect(smart!.smartObjectData.sourceWidth).toBe(200);
      expect(smart!.smartObjectData.sourceHeight).toBe(200);
      // The layer in the array should be the smart object
      const found = layers.find((l) => l.id === origId);
      expect(found?.type).toBe("smart-object");
    });

    it("returns null for non-raster layer", () => {
      const layers: Layer[] = [
        createSmartObjectLayer("Already Smart", makeCanvas()),
      ];
      const result = convertToSmartObject(layers, layers[0].id);
      expect(result).toBeNull();
    });

    it("returns null for non-existent layer ID", () => {
      const layers: Layer[] = [];
      const result = convertToSmartObject(layers, "nonexistent");
      expect(result).toBeNull();
    });

    it("preserves mask when converting", () => {
      const doc = createBlankDocument("test", 100, 100, 1);
      const raster = addLayer(doc, "WithMask");
      raster.mask = createLayerCanvas(100, 100);
      const smart = convertToSmartObject(doc.layers, raster.id);
      expect(smart).not.toBeNull();
      expect(smart!.mask).toBeDefined();
    });
  });

  describe("rasterizeSmartObject", () => {
    it("converts smart object back to raster", () => {
      const source = makeCanvas(100, 100);
      const smart = createSmartObjectLayer("SmartToRasterize", source);
      const layers: Layer[] = [smart];
      const raster = rasterizeSmartObject(layers, smart.id);
      expect(raster).not.toBeNull();
      expect(raster!.type).toBe("raster");
      expect(raster!.id).toBe(smart.id);
      expect(raster!.name).toBe("SmartToRasterize");
      const found = layers.find((l) => l.id === smart.id);
      expect(found?.type).toBe("raster");
    });

    it("returns null for non-smart-object", () => {
      const doc = createBlankDocument("test", 100, 100, 1);
      const raster = addLayer(doc, "Raster");
      const result = rasterizeSmartObject(doc.layers, raster.id);
      expect(result).toBeNull();
    });

    it("returns null for non-existent layer ID", () => {
      const result = rasterizeSmartObject([], "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("replaceSmartObjectSource", () => {
    it("updates source and re-renders", () => {
      const layer = createSmartObjectLayer("Replace Test", makeCanvas(100, 100));
      const newSource = makeCanvas(200, 150);
      replaceSmartObjectSource(layer, newSource);
      expect(layer.smartObjectData.sourceWidth).toBe(200);
      expect(layer.smartObjectData.sourceHeight).toBe(150);
      // Source canvas should not be the same reference
      expect(layer.smartObjectData.sourceCanvas).not.toBe(newSource);
    });
  });

  describe("cloneLayer (smart object)", () => {
    it("clones smart object with independent sourceCanvas", () => {
      const original = createSmartObjectLayer("Original", makeCanvas(100, 100));
      original.smartObjectData.scaleX = 1.5;
      original.smartObjectData.rotateDeg = 30;
      const clone = cloneLayer(original);
      expect(clone.type).toBe("smart-object");
      if (clone.type !== "smart-object") return;
      expect(clone.id).not.toBe(original.id);
      expect(clone.smartObjectData.scaleX).toBe(1.5);
      expect(clone.smartObjectData.rotateDeg).toBe(30);
      expect(clone.smartObjectData.sourceCanvas).not.toBe(original.smartObjectData.sourceCanvas);
      expect(clone.canvas).not.toBe(original.canvas);
    });
  });

  describe("refreshLayerCanvas (smart object)", () => {
    it("dispatches to renderSmartObjectLayer", () => {
      const layer = createSmartObjectLayer("Refresh Test", makeCanvas(100, 100));
      layer.smartObjectData.scaleX = 2;
      refreshLayerCanvas(layer);
      // After refresh with scaleX=2, canvas width should be roughly doubled
      expect(layer.canvas.width).toBeGreaterThan(100);
    });
  });

  describe("serializeDocument (smart object)", () => {
    it("includes smartObjectData in serialized layers", () => {
      const doc = createBlankDocument("test", 200, 200, 1);
      const smart = createSmartObjectLayer("SerializeTest", makeCanvas(100, 80));
      smart.smartObjectData.scaleX = 1.5;
      smart.smartObjectData.rotateDeg = 45;
      doc.layers.push(smart);
      const serialized = serializeDocument(doc);
      const serializedLayer = serialized.layers.find((l) => l.name === "SerializeTest");
      expect(serializedLayer).toBeDefined();
      expect(serializedLayer!.type).toBe("smart-object");
      expect(serializedLayer!.smartObjectData).toBeDefined();
      expect(serializedLayer!.smartObjectData!.sourceWidth).toBe(100);
      expect(serializedLayer!.smartObjectData!.sourceHeight).toBe(80);
      expect(serializedLayer!.smartObjectData!.scaleX).toBe(1.5);
      expect(serializedLayer!.smartObjectData!.rotateDeg).toBe(45);
      expect(serializedLayer!.smartObjectData!.sourceDataUrl).toContain("data:image/png");
    });
  });
});
