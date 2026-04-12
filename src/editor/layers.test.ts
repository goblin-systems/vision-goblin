import { describe, expect, it } from "vitest";
import { createBlankDocument, createTextLayer, measureTextBoxBounds } from "./documents";
import type { RasterLayer } from "./types";
import { installPixelCanvasMock, setPixel } from "../test/pixelCanvasMock";
import { fitReplacementTextData } from "./textReplacementMatcher";
import {
  addLayer,
  detectRasterTextReplacementPieces,
  detectDropShadowFromTextPixels,
  detectOutlineEffectFromTextPixels,
  replaceRasterTextWithEditableLayers,
  replaceRasterTextWithEditableLayer,
  canDeleteLayer,
  deleteLayer,
  duplicateLayer,
  moveLayer,
  renameLayer,
  selectLayer,
  setBackgroundLayerColor,
  toggleLayerLock,
  toggleLayerVisibility,
} from "./layers";

describe("editor layers", () => {
  it("adds a new layer and selects it", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const layer = addLayer(doc);
    expect(doc.layers).toHaveLength(3);
    expect(doc.activeLayerId).toBe(layer.id);
    expect(layer.name).toBe("Layer 3");
  });

  it("renames a layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[1];
    expect(renameLayer(doc, target.id, "Foreground")).toBe(true);
    expect(target.name).toBe("Foreground");
  });

  it("duplicates a layer and selects the copy", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const copy = duplicateLayer(doc, doc.layers[1].id);
    expect(copy).not.toBeNull();
    expect(doc.layers).toHaveLength(3);
    expect(doc.activeLayerId).toBe(copy?.id);
  });

  it("deletes a normal layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const extra = addLayer(doc, "Extra");
    const result = deleteLayer(doc, extra.id);
    expect(result.ok).toBe(true);
    expect(doc.layers.some((layer) => layer.id === extra.id)).toBe(false);
  });

  it("does not delete the background layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const result = deleteLayer(doc, doc.layers[0].id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("protected");
  });

  it("reorders editable layers but not background", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const second = addLayer(doc, "Layer 3");
    expect(moveLayer(doc, second.id, -1)).toBe(true);
    expect(doc.layers[1].id).toBe(second.id);
    expect(moveLayer(doc, doc.layers[0].id, 1)).toBe(false);
  });

  it("toggles layer visibility", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[1];
    expect(toggleLayerVisibility(doc, target.id)).toBe(true);
    expect(target.visible).toBe(false);
  });

  it("toggles layer lock", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[1];
    expect(toggleLayerLock(doc, target.id)).toBe(true);
    expect(target.locked).toBe(true);
  });

  it("updates the background layer color", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    expect(setBackgroundLayerColor(doc, "#ff0000")).toBe(true);
    expect(doc.layers[0].fillColor).toBe("#ff0000");
  });

  it("selects an existing layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[0];
    expect(selectLayer(doc, target.id)).toBe(true);
    expect(doc.activeLayerId).toBe(target.id);
  });

  it("reports deletion eligibility correctly", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    expect(canDeleteLayer(doc, doc.layers[0])).toBe(false);
    expect(canDeleteLayer(doc, doc.layers[1])).toBe(true);
  });

  it("replaces raster text with a cleaned raster and editable text layer atomically", () => {
    const doc = createBlankDocument("Test", 200, 100, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    const rasterLayer: RasterLayer = rasterCandidate;
    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 200;
    cleanedCanvas.height = 100;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterLayer,
      cleanedCanvas,
      "Updated title",
      { x: 20, y: 10, width: 120, height: 30 },
      "AI Replace Raster Text",
    );

    expect(doc.layers).toHaveLength(3);
    expect(doc.layers[2]).toBe(textLayer);
    expect(doc.activeLayerId).toBe(textLayer.id);
    expect(textLayer.type).toBe("text");
    expect(textLayer.textData.text).toBe("Updated title");
    expect(textLayer.x).toBe(20);
    expect(textLayer.y).toBe(10);
    expect(textLayer.textData.boxWidth).toBe(120);
    expect(doc.history[0]).toBe("AI Replace Raster Text");
    expect(doc.undoStack).toHaveLength(1);
  });

  it("detects multiple replacement pieces from separated removed text islands", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 200, 100, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 200;
    cleanedCanvas.height = 100;

    for (let y = 12; y < 30; y += 1) {
      for (let x = 20; x < 60; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#111111");
      }
      for (let x = 120; x < 170; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#d62828");
      }
    }

    const pieces = detectRasterTextReplacementPieces(
      rasterCandidate,
      cleanedCanvas,
      { x: 10, y: 8, width: 170, height: 30 },
    );

    expect(pieces).toHaveLength(2);
    expect(pieces[0].bounds.x).toBeLessThan(pieces[1].bounds.x);
    expect(pieces[0].bounds.width).toBeLessThan(60);
    expect(pieces[1].bounds.width).toBeGreaterThan(40);
  });

  it("applies multiple editable text layers with per-piece style inference", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 220, 120, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 220;
    cleanedCanvas.height = 120;

    for (let y = 18; y < 42; y += 1) {
      for (let x = 24; x < 74; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#111111");
      }
      for (let x = 130; x < 192; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#d62828");
      }
    }

    const textLayers = replaceRasterTextWithEditableLayers(
      doc,
      rasterCandidate,
      cleanedCanvas,
      [
        { text: "Left", bounds: { x: 20, y: 16, width: 58, height: 28 } },
        { text: "Right", bounds: { x: 126, y: 16, width: 70, height: 28 } },
      ],
      "AI Replace Raster Text",
    );

    expect(textLayers).toHaveLength(2);
    expect(doc.layers).toHaveLength(4);
    expect(textLayers[0].textData.fillColor).toBe("#111111");
    expect(textLayers[1].textData.fillColor).toBe("#d62828");
    expect(textLayers[0].x).toBe(20);
    expect(textLayers[1].x).toBe(126);
    expect(doc.activeLayerId).toBe(textLayers[1].id);
    expect(doc.selectedLayerIds).toEqual([textLayers[0].id, textLayers[1].id]);
  });

  it("infers replacement text colour from removed text pixels", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#ffffff");
      }
    }
    for (let y = 16; y < 32; y += 1) {
      for (let x = 28; x < 72; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#d62828");
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        setPixel(cleanedCanvas, x, y, "#ffffff");
      }
    }

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Updated title",
      { x: 20, y: 10, width: 60, height: 30 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.fillColor).toBe("#d62828");
  });

  it("infers centered alignment only when margins strongly support it", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;
    for (let y = 8; y < 32; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#ffffff");
        setPixel(cleanedCanvas, x, y, "#ffffff");
      }
    }
    for (let y = 12; y < 28; y += 1) {
      for (let x = 40; x < 60; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#202020");
      }
    }

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Centered",
      { x: 20, y: 8, width: 60, height: 24 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.alignment).toBe("center");
  });

  it("defaults style inference conservatively and keeps font size within bounds", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 160, 100, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 160;
    cleanedCanvas.height = 100;
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 140; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#f5f5f5");
        setPixel(cleanedCanvas, x, y, "#f5f5f5");
      }
    }
    for (let y = 18; y < 22; y += 1) {
      for (let x = 24; x < 136; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#111111");
      }
    }

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Wrapped\ntext",
      { x: 20, y: 10, width: 120, height: 30 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.alignment).toBe("left");
    expect(textLayer.textData.bold).toBe(false);
    expect(textLayer.textData.italic).toBe(false);
    expect(measureTextBoxBounds(textLayer.textData).height).toBeLessThanOrEqual(30);
    expect(textLayer.textData.fontSize).toBeGreaterThan(1);
  });

  it("can choose a non-default curated font family for a strong signal", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 160, 100, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const source = createTextLayer("Source", 0, 0, fitReplacementTextData(
      "Impact",
      { width: 140, height: 30 },
      { alignment: "left", fillColor: "#1a1a1a", fill: { type: "solid", color: "#1a1a1a" }, stroke: null, effects: [], bold: false, italic: false },
      { fontFamily: "Impact", kerning: 1 },
    ));
    rasterCandidate.canvas.getContext("2d")?.drawImage(source.canvas, 24, 16);

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 160;
    cleanedCanvas.height = 100;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Impact",
      { x: 24, y: 16, width: 140, height: 30 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.fontFamily).toBe("Impact");
  });

  it("falls back conservatively when font confidence is weak", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 160, 100, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    for (let y = 14; y < 30; y += 1) {
      for (let x = 28; x < 132; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#1a1a1a");
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 160;
    cleanedCanvas.height = 100;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Unclear",
      { x: 20, y: 12, width: 120, height: 28 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.fontFamily).toBe("Arial");
    expect(textLayer.textData.lineHeight).toBe(1.2);
    expect(textLayer.textData.kerning).toBe(0);
  });

  it("infers bounded kerning when the removed text signal supports it", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 200, 100, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const source = createTextLayer("Source", 0, 0, fitReplacementTextData(
      "Impact",
      { width: 140, height: 30 },
      { alignment: "left", fillColor: "#1a1a1a", fill: { type: "solid", color: "#1a1a1a" }, stroke: null, effects: [], bold: false, italic: false },
      { fontFamily: "Impact", kerning: 1 },
    ));
    rasterCandidate.canvas.getContext("2d")?.drawImage(source.canvas, 24, 16);

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 200;
    cleanedCanvas.height = 100;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Impact",
      { x: 24, y: 16, width: 140, height: 30 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.fontFamily).toBe("Impact");
    expect(textLayer.textData.kerning).toBe(1);
    expect(textLayer.textData.kerning).toBeGreaterThanOrEqual(-0.5);
    expect(textLayer.textData.kerning).toBeLessThanOrEqual(1);
    expect(measureTextBoxBounds(textLayer.textData).height).toBeLessThanOrEqual(30);
  });

  it("detects a vertical gradient when text pixel colors vary from top to bottom", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    // Paint text pixels as a red-to-blue vertical gradient
    for (let y = 10; y < 50; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        const t = (y - 10) / 39;
        const r = Math.round(255 * (1 - t));
        const b = Math.round(255 * t);
        setPixel(rasterCandidate.canvas, x, y, { r, g: 0, b, a: 255 });
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Gradient",
      { x: 20, y: 10, width: 60, height: 40 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.fill.type).toBe("linear-gradient");
    if (textLayer.textData.fill.type === "linear-gradient") {
      expect(textLayer.textData.fill.angle).toBe(90);
      expect(textLayer.textData.fill.stops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("infers a solid fill when text pixel colors are uniform", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#3388cc");
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Solid",
      { x: 20, y: 10, width: 60, height: 30 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.fill.type).toBe("solid");
  });

  it("detects a stroke when edge and interior pixel colors differ", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    // Paint a filled rectangle with a distinct 2px border (stroke)
    // Interior: white (#ffffff), Border: dark red (#990000)
    const boxLeft = 20;
    const boxTop = 10;
    const boxRight = 80;
    const boxBottom = 50;
    const borderWidth = 3;

    for (let y = boxTop; y < boxBottom; y += 1) {
      for (let x = boxLeft; x < boxRight; x += 1) {
        const isEdge = x < boxLeft + borderWidth || x >= boxRight - borderWidth
          || y < boxTop + borderWidth || y >= boxBottom - borderWidth;
        setPixel(rasterCandidate.canvas, x, y, isEdge ? "#990000" : "#ffffff");
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Stroked",
      { x: 20, y: 10, width: 60, height: 40 },
      "AI Replace Raster Text",
    );

    expect(textLayer.textData.stroke).not.toBeNull();
    if (textLayer.textData.stroke) {
      expect(textLayer.textData.stroke.width).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns empty effects for text with no shadow or outline", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    // Simple solid text — no shadow, no outline
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, "#3388cc");
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Plain",
      { x: 20, y: 10, width: 60, height: 30 },
      "AI Replace Raster Text",
    );

    expect(textLayer.effects ?? []).toEqual([]);
  });

  it("detects a drop shadow when semi-transparent dark pixels exist near the text", () => {
    installPixelCanvasMock();
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;

    // Paint main text body: opaque white, 20..60 x, 10..40 y
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 60; x += 1) {
        setPixel(canvas, x, y, { r: 255, g: 255, b: 255, a: 255 });
      }
    }
    // Paint shadow pixels: semi-transparent dark, offset +3,+3
    for (let y = 13; y < 43; y += 1) {
      for (let x = 23; x < 63; x += 1) {
        // Only paint shadow where it doesn't overlap the text body
        const inText = x >= 20 && x < 60 && y >= 10 && y < 40;
        if (!inText) {
          setPixel(canvas, x, y, { r: 20, g: 20, b: 20, a: 80 });
        }
      }
    }

    const result = detectDropShadowFromTextPixels(
      canvas,
      { left: 0, top: 0, width: 120, height: 80 },
      { x: 20, y: 10, width: 40, height: 30 },
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe("drop-shadow");
    expect(result!.enabled).toBe(true);
    expect(result!.offsetX).toBeGreaterThanOrEqual(0);
    expect(result!.offsetY).toBeGreaterThanOrEqual(0);
    expect(result!.blur).toBeGreaterThanOrEqual(1);
  });

  it("returns null shadow when no shadow pixels exist", () => {
    installPixelCanvasMock();
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;

    // Only solid text, no surrounding shadow pixels
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 60; x += 1) {
        setPixel(canvas, x, y, { r: 255, g: 255, b: 255, a: 255 });
      }
    }

    const result = detectDropShadowFromTextPixels(
      canvas,
      { left: 0, top: 0, width: 120, height: 80 },
      { x: 20, y: 10, width: 40, height: 30 },
    );

    expect(result).toBeNull();
  });

  it("detects an outline when high-alpha colored pixels surround the text box", () => {
    installPixelCanvasMock();
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;

    // Paint an outline border (red) around the text box
    const boxX = 20;
    const boxY = 10;
    const boxW = 40;
    const boxH = 30;
    const outlineWidth = 3;

    // Fill outline region (border band outside the text box)
    for (let y = boxY - outlineWidth; y < boxY + boxH + outlineWidth; y += 1) {
      for (let x = boxX - outlineWidth; x < boxX + boxW + outlineWidth; x += 1) {
        const insideBox = x >= boxX && x < boxX + boxW && y >= boxY && y < boxY + boxH;
        if (!insideBox) {
          setPixel(canvas, x, y, { r: 255, g: 0, b: 0, a: 255 });
        }
      }
    }
    // Fill interior text pixels (white)
    for (let y = boxY; y < boxY + boxH; y += 1) {
      for (let x = boxX; x < boxX + boxW; x += 1) {
        setPixel(canvas, x, y, { r: 255, g: 255, b: 255, a: 255 });
      }
    }

    const result = detectOutlineEffectFromTextPixels(
      canvas,
      { left: 0, top: 0, width: 120, height: 80 },
      { x: boxX, y: boxY, width: boxW, height: boxH },
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe("outline");
    expect(result!.enabled).toBe(true);
    expect(result!.width).toBeGreaterThanOrEqual(1);
    // Outline color should be reddish
    expect(result!.color).toMatch(/^#f/i);
  });

  it("returns null outline when no colored pixels exist outside the text box", () => {
    installPixelCanvasMock();
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;

    // Only interior text pixels, nothing outside
    for (let y = 10; y < 40; y += 1) {
      for (let x = 20; x < 60; x += 1) {
        setPixel(canvas, x, y, { r: 255, g: 255, b: 255, a: 255 });
      }
    }

    const result = detectOutlineEffectFromTextPixels(
      canvas,
      { left: 0, top: 0, width: 120, height: 80 },
      { x: 20, y: 10, width: 40, height: 30 },
    );

    expect(result).toBeNull();
  });

  it("applies detected effects to the replacement text layer", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Test", 120, 80, 100, "transparent");
    const rasterCandidate = doc.layers[1];
    if (!rasterCandidate || rasterCandidate.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    // Use bounds larger than the text body so shadow pixels fall within
    // the sample area but outside the detected text box.
    const boundsX = 10;
    const boundsY = 5;
    const boundsW = 80;
    const boundsH = 50;
    const textLeft = 20;
    const textTop = 10;
    const textRight = 60;
    const textBottom = 35;

    // Paint text body pixels (opaque white)
    for (let y = textTop; y < textBottom; y += 1) {
      for (let x = textLeft; x < textRight; x += 1) {
        setPixel(rasterCandidate.canvas, x, y, { r: 255, g: 255, b: 255, a: 255 });
      }
    }

    // Paint shadow pixels offset +4,+4 from text, semi-transparent dark
    const shadowOffX = 4;
    const shadowOffY = 4;
    for (let y = textTop + shadowOffY; y < textBottom + shadowOffY + 4; y += 1) {
      for (let x = textLeft + shadowOffX; x < textRight + shadowOffX + 4; x += 1) {
        const inText = x >= textLeft && x < textRight && y >= textTop && y < textBottom;
        if (!inText) {
          setPixel(rasterCandidate.canvas, x, y, { r: 10, g: 10, b: 10, a: 60 });
        }
      }
    }

    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 120;
    cleanedCanvas.height = 80;

    const textLayer = replaceRasterTextWithEditableLayer(
      doc,
      rasterCandidate,
      cleanedCanvas,
      "Shadowed",
      { x: boundsX, y: boundsY, width: boundsW, height: boundsH },
      "AI Replace Raster Text",
    );

    const effects = textLayer.effects ?? [];
    const shadowEffect = effects.find((e) => e.type === "drop-shadow");
    expect(shadowEffect).toBeDefined();
    expect(shadowEffect!.enabled).toBe(true);
  });
});
