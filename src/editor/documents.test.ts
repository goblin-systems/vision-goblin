import { describe, expect, it } from "vitest";
import { canDeleteLayer } from "./layers";
import { cloneDocument, createBlankDocument, createLayerCanvas, createLayerThumb, resizeCanvasDocument, serializeDocument } from "./documents";
import { getResizeOffset } from "./geometry";

describe("editor documents", () => {
  it("creates blank documents with a background layer and editable layer", () => {
    const doc = createBlankDocument("Untitled", 640, 480, 100);
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[0].isBackground).toBe(true);
    expect(doc.layers[1].name).toBe("Layer 1");
    expect(doc.activeLayerId).toBe(doc.layers[1].id);
    expect(doc.selectionRect).toBeNull();
    expect(doc.selectionInverted).toBe(false);
  });

  it("only allows deleting non-background layers", () => {
    const doc = createBlankDocument("Untitled", 640, 480, 100);
    expect(canDeleteLayer(doc, doc.layers[0])).toBe(false);
    expect(canDeleteLayer(doc, doc.layers[1])).toBe(true);
  });

  it("clones documents with new ids and duplicated layers", () => {
    const doc = createBlankDocument("Untitled", 640, 480, 100);
    doc.selectionRect = { x: 10, y: 10, width: 50, height: 40 };
    doc.selectionInverted = true;
    const clone = cloneDocument(doc);
    expect(clone.id).not.toBe(doc.id);
    expect(clone.layers).toHaveLength(doc.layers.length);
    expect(clone.layers[0].id).not.toBe(doc.layers[0].id);
    expect(clone.name).toContain("Copy");
    expect(clone.selectionRect).toEqual(doc.selectionRect);
    expect(clone.selectionInverted).toBe(true);
  });

  it("resizes document canvases using the provided offset", () => {
    const doc = createBlankDocument("Untitled", 100, 80, 100);
    const offset = getResizeOffset("center", 100, 80, 140, 120);
    resizeCanvasDocument(doc, 140, 120, offset);
    expect(doc.width).toBe(140);
    expect(doc.height).toBe(120);
    expect(doc.layers[0].canvas.width).toBe(140);
    expect(doc.layers[0].canvas.height).toBe(120);
  });

  it("creates layer thumbnails at the expected size", () => {
    const layer = {
      id: "layer-1",
      type: "raster" as const,
      name: "Layer",
      canvas: createLayerCanvas(200, 100),
      x: 0,
      y: 0,
      visible: true,
      opacity: 1,
      locked: false,
      effects: [],
    };
    const thumb = createLayerThumb(layer);
    expect(thumb.width).toBe(28);
    expect(thumb.height).toBe(28);
  });

  it("serializes AI provenance on layers", () => {
    const doc = createBlankDocument("Untitled", 320, 240, 100);
    doc.layers[1].aiProvenance = {
      providerId: "openai-compatible",
      model: "gpt-4.1-mini",
      taskId: "task-42",
      family: "enhancement",
      operation: "upscale",
      warnings: ["offline"],
      createdAt: "2026-03-28T00:00:00.000Z",
    };

    const serialized = serializeDocument(doc);

    expect(serialized.layers[1].aiProvenance?.operation).toBe("upscale");
    expect(serialized.layers[1].aiProvenance?.warnings).toEqual(["offline"]);
  });
});
