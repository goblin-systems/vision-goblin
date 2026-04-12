import { describe, expect, it } from "vitest";
import { createBlankDocument, deserializeDocument, serializeDocument } from "./documents";
import { applyStructuredTextReconstruction } from "./textReconstruction";

describe("structured text reconstruction apply", () => {
  it("applies valid structured multi-block text layers", () => {
    const doc = createBlankDocument("Test", 300, 200, 100, "transparent");
    const raster = doc.layers[1];
    if (raster.type !== "raster") throw new Error("Expected raster layer");
    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 300;
    cleanedCanvas.height = 200;

    const result = applyStructuredTextReconstruction(doc, raster, cleanedCanvas, [
      {
        id: "title",
        text: "Title",
        bounds: { x: 20, y: 30, width: 140, height: 40 },
        fill: { type: "solid", color: "#111111" },
        stroke: { color: "#ffffff", width: 2 },
        effects: [{ type: "drop-shadow", color: "#000000", offsetX: 1, offsetY: 2, blur: 3, opacity: 0.4, enabled: true }],
        rotationDeg: 12,
        scaleX: 1.1,
        scaleY: 0.9,
        skewXDeg: 4,
        skewYDeg: 2,
      },
      {
        id: "subtitle",
        text: "Subtitle",
        bounds: { x: 24, y: 80, width: 120, height: 24 },
        fill: {
          type: "linear-gradient",
          angle: 90,
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 1, color: "#0000ff" },
          ],
        },
        effects: [{ type: "outline", color: "#00ff00", width: 2, opacity: 1, enabled: true }],
      },
    ], "AI Replace Raster Text");

    expect(result).toHaveLength(2);
    expect(doc.layers.filter((layer) => layer.type === "text")).toHaveLength(2);
    const [first, second] = result;
    expect(first.textData.stroke).toEqual({ color: "#ffffff", width: 2 });
    expect(first.textData.rotationDeg).toBe(12);
    expect(first.textData.scaleX).toBe(1.1);
    expect(first.textData.skewXDeg).toBe(4);
    expect(second.textData.fill.type).toBe("linear-gradient");
    expect(doc.selectedLayerIds).toEqual(result.map((layer) => layer.id));
  });

  it("preserves grouping for nearby differently styled blocks", () => {
    const doc = createBlankDocument("Test", 300, 200, 100, "transparent");
    const raster = doc.layers[1];
    if (raster.type !== "raster") throw new Error("Expected raster layer");
    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 300;
    cleanedCanvas.height = 200;

    const result = applyStructuredTextReconstruction(doc, raster, cleanedCanvas, [
      { id: "left", text: "One", bounds: { x: 20, y: 40, width: 60, height: 20 }, fill: { type: "solid", color: "#111111" } },
      { id: "right", text: "Two", bounds: { x: 85, y: 40, width: 60, height: 20 }, fill: { type: "solid", color: "#ff0000" } },
    ], "AI Replace Raster Text");

    expect(result).toHaveLength(2);
    expect(result[0].textData.text).toBe("One");
    expect(result[1].textData.text).toBe("Two");
    expect(result[0].textData.fillColor).toBe("#111111");
    expect(result[1].textData.fillColor).toBe("#ff0000");
  });

  it("maps gradient, stroke, and effect fields into editable text layers", () => {
    const doc = createBlankDocument("Test", 300, 200, 100, "transparent");
    const raster = doc.layers[1];
    if (raster.type !== "raster") throw new Error("Expected raster layer");
    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 300;
    cleanedCanvas.height = 200;

    const [layer] = applyStructuredTextReconstruction(doc, raster, cleanedCanvas, [{
      id: "fx",
      text: "FX",
      bounds: { x: 20, y: 20, width: 100, height: 30 },
      fill: {
        type: "radial-gradient",
        stops: [
          { offset: 0, color: "#ffff00" },
          { offset: 1, color: "#ff00ff" },
        ],
      },
      stroke: { color: "#000000", width: 3 },
      effects: [
        { type: "drop-shadow", color: "#000000", offsetX: 2, offsetY: 2, blur: 4, opacity: 0.5, enabled: true },
        { type: "outline", color: "#00ff00", width: 1, opacity: 1, enabled: true },
      ],
    }], "AI Replace Raster Text");

    expect(layer.textData.fill.type).toBe("radial-gradient");
    expect(layer.textData.stroke).toEqual({ color: "#000000", width: 3 });
    expect(layer.effects).toHaveLength(2);
  });

  it("persists text transform mapping including skew through serialization", async () => {
    const doc = createBlankDocument("Test", 300, 200, 100, "transparent");
    const raster = doc.layers[1];
    if (raster.type !== "raster") throw new Error("Expected raster layer");
    const cleanedCanvas = document.createElement("canvas");
    cleanedCanvas.width = 300;
    cleanedCanvas.height = 200;

    const [layer] = applyStructuredTextReconstruction(doc, raster, cleanedCanvas, [{
      id: "transform",
      text: "Transform",
      bounds: { x: 10, y: 20, width: 140, height: 30 },
      rotationDeg: 15,
      scaleX: 1.2,
      scaleY: 0.8,
      skewXDeg: 6,
      skewYDeg: -3,
    }], "AI Replace Raster Text");

    const reopened = await deserializeDocument(serializeDocument(doc), null);
    const reopenedLayer = reopened.layers.find((entry) => entry.id === layer.id);
    expect(reopenedLayer?.type).toBe("text");
    if (!reopenedLayer || reopenedLayer.type !== "text") throw new Error("Expected text layer");
    expect(reopenedLayer.textData.rotationDeg).toBe(15);
    expect(reopenedLayer.textData.scaleX).toBe(1.2);
    expect(reopenedLayer.textData.scaleY).toBe(0.8);
    expect(reopenedLayer.textData.skewXDeg).toBe(6);
    expect(reopenedLayer.textData.skewYDeg).toBe(-3);
  });
});
