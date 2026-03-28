import { describe, expect, it } from "vitest";
import { applyAdjustmentLayerParams, defaultParamsForKind, isAdjustmentNeutral, ADJUSTMENT_KINDS, ADJUSTMENT_LABELS } from "./adjustmentLayers";
import type { AdjustmentKind, AdjustmentLayerData } from "./types";
import { createAdjustmentLayer, createBlankDocument, cloneLayer, serializeDocument, createLayerCanvas } from "./documents";
import { addAdjustmentLayer, deleteLayer, duplicateLayer, moveLayer, toggleLayerVisibility } from "./layers";

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

describe("adjustmentLayers module", () => {
  describe("defaultParamsForKind", () => {
    it("returns default params for all known kinds", () => {
      for (const kind of ADJUSTMENT_KINDS) {
        const params = defaultParamsForKind(kind);
        expect(params).toBeDefined();
        expect(typeof params).toBe("object");
      }
    });

    it("returns neutral brightness-contrast defaults", () => {
      const params = defaultParamsForKind("brightness-contrast");
      expect(params.brightness).toBe(0);
      expect(params.contrast).toBe(0);
    });

    it("returns neutral hue-saturation defaults", () => {
      const params = defaultParamsForKind("hue-saturation");
      expect(params.hue).toBe(0);
      expect(params.saturation).toBe(0);
      expect(params.lightness).toBe(0);
    });

    it("returns neutral levels defaults", () => {
      const params = defaultParamsForKind("levels");
      expect(params.inputBlack).toBe(0);
      expect(params.gamma).toBe(1);
      expect(params.inputWhite).toBe(255);
    });
  });

  describe("ADJUSTMENT_LABELS", () => {
    it("has a label for every kind", () => {
      for (const kind of ADJUSTMENT_KINDS) {
        expect(ADJUSTMENT_LABELS[kind]).toBeDefined();
        expect(typeof ADJUSTMENT_LABELS[kind]).toBe("string");
        expect(ADJUSTMENT_LABELS[kind].length).toBeGreaterThan(0);
      }
    });
  });

  describe("isAdjustmentNeutral", () => {
    it("detects neutral brightness-contrast", () => {
      expect(isAdjustmentNeutral({ kind: "brightness-contrast", params: { brightness: 0, contrast: 0 } })).toBe(true);
      expect(isAdjustmentNeutral({ kind: "brightness-contrast", params: { brightness: 10, contrast: 0 } })).toBe(false);
    });

    it("detects neutral hue-saturation", () => {
      expect(isAdjustmentNeutral({ kind: "hue-saturation", params: { hue: 0, saturation: 0, lightness: 0 } })).toBe(true);
      expect(isAdjustmentNeutral({ kind: "hue-saturation", params: { hue: 15, saturation: 0, lightness: 0 } })).toBe(false);
    });

    it("detects neutral levels", () => {
      expect(isAdjustmentNeutral({ kind: "levels", params: { inputBlack: 0, gamma: 1, inputWhite: 255 } })).toBe(true);
      expect(isAdjustmentNeutral({ kind: "levels", params: { inputBlack: 10, gamma: 1, inputWhite: 255 } })).toBe(false);
    });

    it("detects neutral curves", () => {
      expect(isAdjustmentNeutral({ kind: "curves", params: { points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } })).toBe(true);
      expect(isAdjustmentNeutral({ kind: "curves", params: { points: [{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }] } })).toBe(false);
    });

    it("gradient map is never neutral", () => {
      expect(isAdjustmentNeutral({ kind: "gradient-map", params: defaultParamsForKind("gradient-map") })).toBe(false);
    });
  });

  describe("applyAdjustmentLayerParams", () => {
    it("applies brightness-contrast adjustment", () => {
      const src = makeImageData(100, 100, 100);
      const data: AdjustmentLayerData = { kind: "brightness-contrast", params: { brightness: 50, contrast: 0 } };
      const result = applyAdjustmentLayerParams(data, src);
      expect(result.data[0]).toBeGreaterThan(100);
    });

    it("applies hue-saturation adjustment", () => {
      const src = makeImageData(200, 100, 50);
      const data: AdjustmentLayerData = { kind: "hue-saturation", params: { hue: 90, saturation: 0, lightness: 0 } };
      const result = applyAdjustmentLayerParams(data, src);
      // Hue shift should change the color channels
      expect(result.data[0]).not.toBe(200);
    });

    it("applies levels adjustment", () => {
      const src = makeImageData(128, 128, 128);
      const data: AdjustmentLayerData = { kind: "levels", params: { inputBlack: 50, gamma: 1, inputWhite: 200 } };
      const result = applyAdjustmentLayerParams(data, src);
      // Remapping should change values
      expect(result.data[0]).not.toBe(128);
    });

    it("applies curves adjustment", () => {
      const src = makeImageData(128, 128, 128);
      const data: AdjustmentLayerData = { kind: "curves", params: { points: [{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }] } };
      const result = applyAdjustmentLayerParams(data, src);
      expect(result.data[0]).toBeGreaterThan(128);
    });

    it("applies gradient map adjustment", () => {
      const src = makeImageData(128, 128, 128);
      const data: AdjustmentLayerData = {
        kind: "gradient-map",
        params: {
          stops: [
            { position: 0, r: 255, g: 0, b: 0 },
            { position: 1, r: 0, g: 0, b: 255 },
          ],
        },
      };
      const result = applyAdjustmentLayerParams(data, src);
      // Mid-gray should map roughly to a blend of red and blue
      expect(result.data[0]).toBeGreaterThan(50); // some red
      expect(result.data[2]).toBeGreaterThan(50); // some blue
    });

    it("neutral params return unchanged pixels for brightness-contrast", () => {
      const src = makeImageData(128, 64, 200);
      const data: AdjustmentLayerData = { kind: "brightness-contrast", params: { brightness: 0, contrast: 0 } };
      const result = applyAdjustmentLayerParams(data, src);
      expect(result.data[0]).toBe(128);
      expect(result.data[1]).toBe(64);
      expect(result.data[2]).toBe(200);
    });
  });
});

describe("adjustment layer creation", () => {
  it("creates an adjustment layer with correct type and data", () => {
    const layer = createAdjustmentLayer("Test Brightness", { kind: "brightness-contrast", params: { brightness: 0, contrast: 0 } });
    expect(layer.type).toBe("adjustment");
    expect(layer.adjustmentData.kind).toBe("brightness-contrast");
    expect(layer.adjustmentData.params.brightness).toBe(0);
    expect(layer.name).toBe("Test Brightness");
    expect(layer.visible).toBe(true);
    expect(layer.canvas.width).toBe(1);
  });
});

describe("adjustment layers in document", () => {
  it("addAdjustmentLayer adds to document and selects it", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const initialCount = doc.layers.length;
    const layer = addAdjustmentLayer(doc, "brightness-contrast");
    expect(doc.layers.length).toBe(initialCount + 1);
    expect(doc.activeLayerId).toBe(layer.id);
    expect(layer.type).toBe("adjustment");
    expect(layer.adjustmentData.kind).toBe("brightness-contrast");
  });

  it("addAdjustmentLayer pushes undo snapshot", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    expect(doc.undoStack.length).toBe(0);
    addAdjustmentLayer(doc, "hue-saturation");
    expect(doc.undoStack.length).toBe(1);
  });

  it("toggleLayerVisibility works on adjustment layers", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const layer = addAdjustmentLayer(doc, "levels");
    expect(layer.visible).toBe(true);
    toggleLayerVisibility(doc, layer.id);
    expect(layer.visible).toBe(false);
    toggleLayerVisibility(doc, layer.id);
    expect(layer.visible).toBe(true);
  });

  it("deleteLayer works on adjustment layers", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const layer = addAdjustmentLayer(doc, "curves");
    const count = doc.layers.length;
    const result = deleteLayer(doc, layer.id);
    expect(result.ok).toBe(true);
    expect(doc.layers.length).toBe(count - 1);
  });

  it("duplicateLayer clones adjustment data", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const layer = addAdjustmentLayer(doc, "brightness-contrast");
    layer.adjustmentData.params.brightness = 42;
    const copy = duplicateLayer(doc, layer.id);
    expect(copy).not.toBeNull();
    expect(copy?.type).toBe("adjustment");
    if (copy?.type === "adjustment") {
      expect(copy.adjustmentData.kind).toBe("brightness-contrast");
      expect(copy.adjustmentData.params.brightness).toBe(42);
      // Ensure it's a deep copy
      copy.adjustmentData.params.brightness = 99;
      expect(layer.adjustmentData.params.brightness).toBe(42);
    }
  });

  it("moveLayer works with adjustment layers", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    addAdjustmentLayer(doc, "hue-saturation");
    addAdjustmentLayer(doc, "levels");
    const adjIndex = doc.layers.findIndex((l) => l.type === "adjustment" && l.name.includes("Hue"));
    const moved = moveLayer(doc, doc.layers[adjIndex].id, 1);
    expect(moved).toBe(true);
  });

  it("cloneLayer preserves adjustment data", () => {
    const original = createAdjustmentLayer("Test CB", { kind: "color-balance", params: defaultParamsForKind("color-balance") });
    original.adjustmentData.params.shadowsCyanRed = 25;
    const clone = cloneLayer(original);
    expect(clone.type).toBe("adjustment");
    if (clone.type === "adjustment") {
      expect(clone.adjustmentData.kind).toBe("color-balance");
      expect(clone.adjustmentData.params.shadowsCyanRed).toBe(25);
      // Verify deep copy
      clone.adjustmentData.params.shadowsCyanRed = 50;
      expect(original.adjustmentData.params.shadowsCyanRed).toBe(25);
    }
  });

  it("serializeDocument includes adjustment layer data", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const layer = addAdjustmentLayer(doc, "gradient-map");
    const serialized = serializeDocument(doc);
    const adjLayer = serialized.layers.find((l) => l.id === layer.id);
    expect(adjLayer).toBeDefined();
    expect(adjLayer?.type).toBe("adjustment");
    expect(adjLayer?.adjustmentData).toBeDefined();
    expect(adjLayer?.adjustmentData?.kind).toBe("gradient-map");
  });
});
