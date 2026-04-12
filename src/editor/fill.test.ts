import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import { applyFillToSelection } from "./fill";
import { getFillGradientNoOverlapMessage, getFillGradientSelectionRequiredMessage } from "./fillGradientValidation";
import { installPixelCanvasMock, readPixel, setPixel } from "../test/pixelCanvasMock";

describe("applyFillToSelection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installPixelCanvasMock();
  });

  it("fills only pixels covered by the effective selection mask", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    setPixel(selectionMask, 1, 1, "#FFFFFF");
    setPixel(selectionMask, 2, 2, "#FFFFFF");

    setPixel(layer.canvas, 1, 1, "#111111");
    setPixel(layer.canvas, 2, 2, "#222222");
    setPixel(layer.canvas, 0, 0, "#333333");

    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 1, y: 1, width: 2, height: 2 };

    const result = applyFillToSelection(doc, layer, "#FF00AA");

    expect(result.ok).toBe(true);
    expect(readPixel(layer.canvas, 1, 1)).toEqual({ r: 255, g: 0, b: 170, a: 255 });
    expect(readPixel(layer.canvas, 2, 2)).toEqual({ r: 255, g: 0, b: 170, a: 255 });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 51, g: 51, b: 51, a: 255 });
  });

  it("uses the inverted effective selection when selection inversion is active", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    setPixel(layer.canvas, 0, 0, "#111111");
    setPixel(layer.canvas, 1, 1, "#222222");
    setPixel(layer.canvas, 3, 3, "#333333");

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    setPixel(selectionMask, 1, 1, "#FFFFFF");
    setPixel(selectionMask, 2, 2, "#FFFFFF");

    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 1, y: 1, width: 2, height: 2 };
    doc.selectionInverted = true;

    const result = applyFillToSelection(doc, layer, "#00FF00");

    expect(result.ok).toBe(true);
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(readPixel(layer.canvas, 1, 1)).toEqual({ r: 34, g: 34, b: 34, a: 255 });
    expect(readPixel(layer.canvas, 3, 3)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  it("does not mutate when there is no effective selection", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    setPixel(layer.canvas, 0, 0, "#123456");
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;

    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 0, y: 0, width: 4, height: 4 };

    const result = applyFillToSelection(doc, layer, "#ABCDEF");

    expect(result).toEqual({ ok: false, message: getFillGradientSelectionRequiredMessage("fill"), variant: "info" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it("returns an overlap message when the effective selection misses the active layer", () => {
    const doc = makeNewDocument("Doc", 6, 6, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    layer.x = 4;
    layer.y = 4;
    layer.canvas.width = 2;
    layer.canvas.height = 2;

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 6;
    selectionMask.height = 6;
    setPixel(selectionMask, 0, 0, "#FFFFFF");
    setPixel(selectionMask, 1, 1, "#FFFFFF");

    setPixel(layer.canvas, 0, 0, "#123456");
    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 0, y: 0, width: 2, height: 2 };

    const result = applyFillToSelection(doc, layer, "#ABCDEF");

    expect(result).toEqual({ ok: false, message: getFillGradientNoOverlapMessage(), variant: "info" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });
});
