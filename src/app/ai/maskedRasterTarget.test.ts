import { beforeEach, describe, expect, it } from "vitest";
import { makeNewDocument } from "../../editor/actions/documentActions";
import type { RasterLayer } from "../../editor/types";
import { installPixelCanvasMock, readPixel, setPixel } from "../../test/pixelCanvasMock";
import { prepareMaskedRasterTarget } from "./maskedRasterTarget";

function makeLayer(): RasterLayer {
  const doc = makeNewDocument("Doc", 120, 90, 100, "transparent");
  const layer = doc.layers[0];
  if (!layer || layer.type !== "raster") {
    throw new Error("Expected starter raster layer");
  }
  layer.canvas.width = 40;
  layer.canvas.height = 30;
  layer.x = 20;
  layer.y = 10;
  return layer;
}

describe("prepareMaskedRasterTarget", () => {
  beforeEach(() => {
    installPixelCanvasMock();
  });

  it("fills the full active layer bounds for doc-scope blank masks when allowed", () => {
    const layer = makeLayer();
    const doc = makeNewDocument("Doc", 120, 90, 100, "transparent");
    doc.layers[0] = layer;
    doc.activeLayerId = layer.id;
    const blankMask = document.createElement("canvas");
    blankMask.width = doc.width;
    blankMask.height = doc.height;

    const result = prepareMaskedRasterTarget({
      doc,
      layer,
      inputScope: "visible-content",
      surfaceMask: blankMask,
      emptyMaskPolicy: "fill-full-target",
      emptyMaskMessage: "mask required",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.selectionBounds).toEqual({ x: 20, y: 10, width: 40, height: 30 });
    expect(result.target.usedFullTargetFallback).toBe(true);
    expect(readPixel(result.target.maskCanvas, 20, 10).a).toBe(255);

    const docResult = document.createElement("canvas");
    docResult.width = doc.width;
    docResult.height = doc.height;
    setPixel(docResult, 20, 10, { r: 255, g: 0, b: 0, a: 255 });
    const layerResult = result.target.toLayerCanvas(docResult);
    expect(layerResult.width).toBe(40);
    expect(layerResult.height).toBe(30);
    expect(readPixel(layerResult, 0, 0).r).toBe(255);
  });

  it("translates document-space masks into cropped layer-content coordinates", () => {
    const doc = makeNewDocument("Doc", 120, 90, 100, "transparent");
    const layer = doc.layers[0];
    if (!layer || layer.type !== "raster") {
      throw new Error("Expected starter raster layer");
    }
    layer.canvas.width = 40;
    layer.canvas.height = 30;
    layer.x = 20;
    layer.y = 10;
    setPixel(layer.canvas, 5, 6, { r: 0, g: 0, b: 0, a: 255 });
    setPixel(layer.canvas, 9, 8, { r: 0, g: 0, b: 0, a: 255 });

    const sourceMask = document.createElement("canvas");
    sourceMask.width = doc.width;
    sourceMask.height = doc.height;
    setPixel(sourceMask, 25, 16, { r: 255, g: 255, b: 255, a: 255 });

    const result = prepareMaskedRasterTarget({
      doc,
      layer,
      inputScope: "selected-layers",
      surfaceMask: sourceMask,
      emptyMaskPolicy: "error",
      emptyMaskMessage: "mask required",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.selectionBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(result.target.usedFullTargetFallback).toBe(false);
    expect(result.target.outputExpectedWidth).toBe(5);
    expect(result.target.outputExpectedHeight).toBe(3);
    expect(result.target.blockOffset).toEqual({ x: 25, y: 16 });
    expect(readPixel(result.target.maskCanvas, 0, 0).a).toBe(255);

    const healedCrop = document.createElement("canvas");
    healedCrop.width = 5;
    healedCrop.height = 3;
    setPixel(healedCrop, 0, 0, { r: 0, g: 255, b: 0, a: 255 });
    const layerResult = result.target.toLayerCanvas(healedCrop);
    expect(layerResult.width).toBe(40);
    expect(layerResult.height).toBe(30);
    expect(readPixel(layerResult, 5, 6).g).toBe(255);
  });

  it("merges only masked pixels back onto the active layer for doc-scope denoise", () => {
    const layer = makeLayer();
    const doc = makeNewDocument("Doc", 120, 90, 100, "transparent");
    doc.layers[0] = layer;
    doc.activeLayerId = layer.id;
    setPixel(layer.canvas, 2, 2, { r: 10, g: 20, b: 30, a: 255 });
    setPixel(layer.canvas, 3, 2, { r: 40, g: 50, b: 60, a: 255 });

    const mask = document.createElement("canvas");
    mask.width = doc.width;
    mask.height = doc.height;
    setPixel(mask, layer.x + 2, layer.y + 2, { r: 255, g: 255, b: 255, a: 255 });

    const result = prepareMaskedRasterTarget({
      doc,
      layer,
      inputScope: "visible-content",
      surfaceMask: mask,
      emptyMaskPolicy: "fill-full-target",
      emptyMaskMessage: "mask required",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const denoisedDoc = document.createElement("canvas");
    denoisedDoc.width = doc.width;
    denoisedDoc.height = doc.height;
    setPixel(denoisedDoc, layer.x + 2, layer.y + 2, { r: 200, g: 210, b: 220, a: 255 });
    setPixel(denoisedDoc, layer.x + 3, layer.y + 2, { r: 150, g: 160, b: 170, a: 255 });

    const merged = result.target.applyMaskedResultToLayerCanvas(denoisedDoc);
    expect(readPixel(merged, 2, 2)).toMatchObject({ r: 200, g: 210, b: 220, a: 255 });
    expect(readPixel(merged, 3, 2)).toMatchObject({ r: 40, g: 50, b: 60, a: 255 });
  });

  it("merges only masked pixels back onto the active layer for selected-layers scope denoise", () => {
    const doc = makeNewDocument("Doc", 120, 90, 100, "transparent");
    const layer = doc.layers[0];
    if (!layer || layer.type !== "raster") {
      throw new Error("Expected starter raster layer");
    }
    layer.canvas.width = 40;
    layer.canvas.height = 30;
    layer.x = 20;
    layer.y = 10;
    setPixel(layer.canvas, 5, 6, { r: 10, g: 20, b: 30, a: 255 });
    setPixel(layer.canvas, 9, 8, { r: 40, g: 50, b: 60, a: 255 });

    const sourceMask = document.createElement("canvas");
    sourceMask.width = doc.width;
    sourceMask.height = doc.height;
    setPixel(sourceMask, 25, 16, { r: 255, g: 255, b: 255, a: 255 });

    const result = prepareMaskedRasterTarget({
      doc,
      layer,
      inputScope: "selected-layers",
      surfaceMask: sourceMask,
      emptyMaskPolicy: "fill-full-target",
      emptyMaskMessage: "mask required",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const denoisedCrop = document.createElement("canvas");
    denoisedCrop.width = result.target.outputExpectedWidth;
    denoisedCrop.height = result.target.outputExpectedHeight;
    setPixel(denoisedCrop, 0, 0, { r: 200, g: 210, b: 220, a: 255 });
    setPixel(denoisedCrop, 4, 2, { r: 150, g: 160, b: 170, a: 255 });

    const merged = result.target.applyMaskedResultToLayerCanvas(denoisedCrop);
    expect(readPixel(merged, 5, 6)).toMatchObject({ r: 200, g: 210, b: 220, a: 255 });
    expect(readPixel(merged, 9, 8)).toMatchObject({ r: 40, g: 50, b: 60, a: 255 });
  });

  it("rejects blank masks when the policy requires a non-empty mask", () => {
    const doc = makeNewDocument("Doc", 120, 90, 100, "transparent");
    const layer = doc.layers[0];
    if (!layer || layer.type !== "raster") {
      throw new Error("Expected starter raster layer");
    }
    const blankMask = document.createElement("canvas");
    blankMask.width = doc.width;
    blankMask.height = doc.height;

    const result = prepareMaskedRasterTarget({
      doc,
      layer,
      inputScope: "visible-content",
      surfaceMask: blankMask,
      emptyMaskPolicy: "error",
      emptyMaskMessage: "Paint or select the area to heal before continuing.",
    });

    expect(result).toEqual({ ok: false, error: "Paint or select the area to heal before continuing." });
  });
});
