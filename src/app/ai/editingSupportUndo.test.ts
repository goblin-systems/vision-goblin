import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLayerCanvas, snapshotDocument, syncLayerSource } from "../../editor/documents";
import type { DocumentState, RasterLayer } from "../../editor/types";
import {
  addRasterLayerFromCanvas,
  applyMaskToLayer,
  applyMaskToSelection,
  replaceLayerWithCanvas,
} from "./editingSupport";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeLayer(): RasterLayer {
  const canvas = createLayerCanvas(100, 100);
  const layer: RasterLayer = {
    id: "layer-1",
    type: "raster",
    name: "Base Layer",
    canvas,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    effects: [],
  };
  syncLayerSource(layer);
  return layer;
}

function makeDocument(layer: RasterLayer): DocumentState {
  return {
    id: "doc-1",
    name: "Test",
    width: 100,
    height: 100,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: false,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    history: [],
    sourcePath: null,
    projectPath: null,
    background: "white",
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: null,
    selectionShape: "rect",
    selectionInverted: false,
    selectionPath: null,
    selectionMask: null,
    guides: [],
  };
}

/* ------------------------------------------------------------------ */
/* replaceLayerWithCanvas                                              */
/* ------------------------------------------------------------------ */

describe("replaceLayerWithCanvas — undo snapshots", () => {
  let layer: RasterLayer;
  let doc: DocumentState;

  beforeEach(() => {
    layer = makeLayer();
    doc = makeDocument(layer);
  });

  it("pushes exactly one snapshot onto undoStack", () => {
    const replacement = createLayerCanvas(100, 100);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale");
    expect(doc.undoStack).toHaveLength(1);
  });

  it("clears the redoStack", () => {
    doc.redoStack = ["old-redo-snapshot"];
    const replacement = createLayerCanvas(100, 100);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale");
    expect(doc.redoStack).toHaveLength(0);
  });

  it("pushes the history label", () => {
    const replacement = createLayerCanvas(100, 100);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale");
    expect(doc.history[0]).toBe("AI Upscale");
  });

  it("replaces the layer canvas with a clone of the input", () => {
    const original = layer.canvas;
    const replacement = createLayerCanvas(200, 200);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale");
    expect(layer.canvas).not.toBe(original);
    expect(layer.canvas).not.toBe(replacement); // should be a clone
    expect(layer.canvas.width).toBe(200);
    expect(layer.canvas.height).toBe(200);
  });

  it("captures pre-mutation state in the undo snapshot", () => {
    const snapshotBefore = snapshotDocument(doc);
    const replacement = createLayerCanvas(200, 200);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale");

    // The pushed snapshot should match the state before mutation
    expect(doc.undoStack[0]).toBe(snapshotBefore);
  });

  it("marks the document dirty", () => {
    expect(doc.dirty).toBe(false);
    const replacement = createLayerCanvas(100, 100);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale");
    expect(doc.dirty).toBe(true);
  });

  it("stores AI provenance on the layer when provided", () => {
    const provenance = {
      providerId: "openai",
      model: "dall-e-3",
      taskId: "t-1",
      family: "enhancement",
      operation: "upscale",
      warnings: [] as string[],
      createdAt: new Date().toISOString(),
    };
    const replacement = createLayerCanvas(100, 100);
    replaceLayerWithCanvas(doc, layer, replacement, "AI Upscale", provenance);
    expect(layer.aiProvenance).toBe(provenance);
  });
});

/* ------------------------------------------------------------------ */
/* addRasterLayerFromCanvas                                           */
/* ------------------------------------------------------------------ */

describe("addRasterLayerFromCanvas — undo snapshots", () => {
  let layer: RasterLayer;
  let doc: DocumentState;

  beforeEach(() => {
    layer = makeLayer();
    doc = makeDocument(layer);
  });

  it("pushes exactly one snapshot onto undoStack", () => {
    const canvas = createLayerCanvas(100, 100);
    addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer");
    expect(doc.undoStack).toHaveLength(1);
  });

  it("clears the redoStack", () => {
    doc.redoStack = ["old-redo-snapshot"];
    const canvas = createLayerCanvas(100, 100);
    addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer");
    expect(doc.redoStack).toHaveLength(0);
  });

  it("adds a new layer to doc.layers", () => {
    expect(doc.layers).toHaveLength(1);
    const canvas = createLayerCanvas(100, 100);
    addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer");
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[1].name).toBe("AI Layer");
  });

  it("sets activeLayerId to the new layer", () => {
    const canvas = createLayerCanvas(100, 100);
    const newLayer = addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer");
    expect(doc.activeLayerId).toBe(newLayer.id);
    expect(doc.activeLayerId).not.toBe(layer.id);
  });

  it("does NOT push undo when alreadySnapshotted is true", () => {
    const canvas = createLayerCanvas(100, 100);
    addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer", undefined, { alreadySnapshotted: true });
    expect(doc.undoStack).toHaveLength(0);
  });

  it("does NOT clear redoStack when alreadySnapshotted is true", () => {
    doc.redoStack = ["old-redo-snapshot"];
    const canvas = createLayerCanvas(100, 100);
    addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer", undefined, { alreadySnapshotted: true });
    expect(doc.redoStack).toHaveLength(1);
  });

  it("returns the newly created RasterLayer", () => {
    const canvas = createLayerCanvas(100, 100);
    const result = addRasterLayerFromCanvas(doc, canvas, "AI Layer", "AI Add Layer");
    expect(result.type).toBe("raster");
    expect(result.name).toBe("AI Layer");
    expect(result.id).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* applyMaskToSelection                                                */
/* ------------------------------------------------------------------ */

describe("applyMaskToSelection — undo snapshots", () => {
  let layer: RasterLayer;
  let doc: DocumentState;

  beforeEach(() => {
    layer = makeLayer();
    doc = makeDocument(layer);
  });

  it("pushes exactly one snapshot onto undoStack when mask is non-empty", () => {
    // Default getImageData mock returns pixel with alpha=255, so isMaskEmpty returns false
    const mask = createLayerCanvas(100, 100);
    applyMaskToSelection(doc, mask, "AI Select Subject");
    expect(doc.undoStack).toHaveLength(1);
  });

  it("sets selectionMask on the document", () => {
    expect(doc.selectionMask).toBeNull();
    const mask = createLayerCanvas(100, 100);
    applyMaskToSelection(doc, mask, "AI Select Subject");
    expect(doc.selectionMask).toBeTruthy();
    expect(doc.selectionMask).not.toBe(mask); // should be a clone
  });

  it("returns true when mask has non-transparent pixels", () => {
    const mask = createLayerCanvas(100, 100);
    const result = applyMaskToSelection(doc, mask, "AI Select Subject");
    expect(result).toBe(true);
  });

  it("returns false and does NOT push undo when mask is empty", () => {
    const mask = createLayerCanvas(100, 100);
    // Override getImageData for this call to return all-zero (empty) data
    const ctx = mask.getContext("2d")!;
    const origGetImageData = ctx.getImageData;
    vi.mocked(ctx.getImageData).mockReturnValueOnce({
      data: new Uint8ClampedArray(100 * 100 * 4), // all zeros = empty
      width: 100,
      height: 100,
      colorSpace: "srgb",
    });
    const result = applyMaskToSelection(doc, mask, "AI Select Subject");
    expect(result).toBe(false);
    expect(doc.undoStack).toHaveLength(0);
    // Restore
    ctx.getImageData = origGetImageData;
  });

  it("clears the redoStack on success", () => {
    doc.redoStack = ["old-redo-snapshot"];
    const mask = createLayerCanvas(100, 100);
    applyMaskToSelection(doc, mask, "AI Select Subject");
    expect(doc.redoStack).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* applyMaskToLayer                                                    */
/* ------------------------------------------------------------------ */

describe("applyMaskToLayer — undo snapshots", () => {
  let layer: RasterLayer;
  let doc: DocumentState;

  beforeEach(() => {
    layer = makeLayer();
    doc = makeDocument(layer);
  });

  it("pushes exactly one snapshot onto undoStack", () => {
    const mask = createLayerCanvas(100, 100);
    applyMaskToLayer(doc, layer, mask, "AI Layer Mask");
    expect(doc.undoStack).toHaveLength(1);
  });

  it("sets layer.mask to a clone of the provided mask", () => {
    expect(layer.mask).toBeUndefined();
    const mask = createLayerCanvas(100, 100);
    applyMaskToLayer(doc, layer, mask, "AI Layer Mask");
    expect(layer.mask).toBeTruthy();
    expect(layer.mask).not.toBe(mask); // should be a clone
  });

  it("clears the redoStack", () => {
    doc.redoStack = ["old-redo-snapshot"];
    const mask = createLayerCanvas(100, 100);
    applyMaskToLayer(doc, layer, mask, "AI Layer Mask");
    expect(doc.redoStack).toHaveLength(0);
  });

  it("pushes the history label", () => {
    const mask = createLayerCanvas(100, 100);
    applyMaskToLayer(doc, layer, mask, "AI Layer Mask");
    expect(doc.history[0]).toBe("AI Layer Mask");
  });
});
