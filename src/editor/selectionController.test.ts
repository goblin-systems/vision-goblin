import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import { createSelectionController } from "./selectionController";
import { createMaskCanvas, fillMask } from "./selection";
import type { RasterLayer } from "./types";
import { createLayerCanvas, syncLayerSource } from "./documents";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeController(doc: ReturnType<typeof makeNewDocument>, overrides?: {
  getActiveTool?: () => string;
  getActiveLayer?: (d: ReturnType<typeof makeNewDocument>) => RasterLayer | null;
}) {
  return createSelectionController({
    getActiveDocument: () => doc,
    getActiveLayer: overrides?.getActiveLayer ?? ((activeDoc) => (activeDoc.layers[0] as RasterLayer) ?? null),
    getActiveTool: (overrides?.getActiveTool as () => import("../settings").ToolName) ?? (() => "marquee" as const),
    setActiveTool: vi.fn(),
    renderEditorState: vi.fn(),
    renderToolState: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
    snapshotDocument: (_d) => "snapshot-" + Date.now(),
  });
}

/**
 * makeNewDocument pushes "Created blank canvas" into history automatically.
 * Reset the history/undo/redo stacks so tests start from a clean slate.
 */
function freshDoc(width = 100, height = 100) {
  const doc = makeNewDocument("Doc", width, height, 100, "transparent");
  doc.history = [];
  doc.historyIndex = 0;
  doc.undoStack = [];
  doc.redoStack = [];
  return doc;
}

/**
 * Mock getImageData on the shared context stub to return a real-sized
 * ImageData so maskBoundingRect can find pixels.
 * Returns a function that restores the original mock.
 */
function withFilledGetImageData(
  w: number,
  h: number,
  callback: () => void
) {
  // The global stub is shared — grab it from a fresh canvas
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  const filled = new Uint8ClampedArray(w * h * 4);
  // Fill every pixel white+opaque so maskBoundingRect finds a bounding rect
  for (let i = 0; i < filled.length; i += 4) {
    filled[i] = 255;     // R
    filled[i + 1] = 255; // G
    filled[i + 2] = 255; // B
    filled[i + 3] = 255; // A
  }
  const imageData = { data: filled, width: w, height: h };
  const origGetImageData = ctx.getImageData;
  vi.mocked(ctx.getImageData).mockReturnValue(imageData as unknown as ImageData);

  try {
    callback();
  } finally {
    ctx.getImageData = origGetImageData;
  }
}

function makeRasterLayer(w = 10, h = 10): RasterLayer {
  const canvas = createLayerCanvas(w, h);
  const layer: RasterLayer = {
    id: "layer-test",
    type: "raster",
    name: "Layer",
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

// ---------------------------------------------------------------------------
// original tests (unchanged)
// ---------------------------------------------------------------------------

describe("selectionController", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clamps marquee sides", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const controller = createSelectionController({
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0],
      getActiveTool: () => "marquee",
      setActiveTool: vi.fn(),
      renderEditorState: vi.fn(),
      renderToolState: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
      snapshotDocument: vi.fn(() => "snapshot"),
    });

    controller.setMarqueeSides(20);

    expect(controller.getMarqueeSides()).toBe(11);
  });

  it("captures and applies quick mask state", () => {
    const setActiveTool = vi.fn();
    const doc = makeNewDocument("Doc", 20, 20, 100, "transparent");
    doc.selectionMask = createMaskCanvas(doc.width, doc.height);
    fillMask(doc.selectionMask);
    const controller = createSelectionController({
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0],
      getActiveTool: () => "move",
      setActiveTool,
      renderEditorState: vi.fn(),
      renderToolState: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
      snapshotDocument: vi.fn(() => "snapshot"),
    });

    controller.toggleQuickMask();
    expect(controller.isQuickMaskActive()).toBe(true);
    expect(controller.getQuickMaskCanvas()).not.toBeNull();

    controller.toggleQuickMask();
    expect(controller.isQuickMaskActive()).toBe(false);
    expect(doc.selectionMask).not.toBeNull();
    expect(setActiveTool).toHaveBeenNthCalledWith(1, "brush");
    expect(setActiveTool).toHaveBeenNthCalledWith(2, "move");
  });

  it("updates marquee override from modifier keys", () => {
    const renderToolState = vi.fn();
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const controller = createSelectionController({
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0],
      getActiveTool: () => "marquee",
      setActiveTool: vi.fn(),
      renderEditorState: vi.fn(),
      renderToolState,
      showToast: vi.fn(),
      log: vi.fn(),
      snapshotDocument: vi.fn(() => "snapshot"),
    });

    controller.updateMarqueeModeFromModifiers(false, true, false);

    expect(controller.getEffectiveMarqueeMode()).toBe("add");
    expect(renderToolState).toHaveBeenCalled();
  });

  it("maps marquee modifier combinations to rotate and perfect semantics", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const controller = createSelectionController({
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0],
      getActiveTool: () => "marquee",
      setActiveTool: vi.fn(),
      renderEditorState: vi.fn(),
      renderToolState: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
      snapshotDocument: vi.fn(() => "snapshot"),
    });

    expect(controller.getMarqueeModifiers({ ctrlPressed: true, shiftPressed: true, altPressed: false })).toEqual({ rotate: true, perfect: true });
    expect(controller.getMarqueeModifiers({ ctrlPressed: false, shiftPressed: true, altPressed: true })).toEqual({ rotate: false, perfect: false });
    expect(controller.getMarqueeModifiers({ ctrlPressed: false, shiftPressed: false, altPressed: false })).toEqual({ rotate: false, perfect: true });
  });
});

// ---------------------------------------------------------------------------
// clearSelection — undo snapshots
// ---------------------------------------------------------------------------

describe("clearSelection — undo snapshots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pushes a snapshot onto undoStack when there is a selectionRect to clear", () => {
    const doc = freshDoc();
    doc.selectionRect = { x: 0, y: 0, width: 50, height: 50 };
    const controller = makeController(doc);

    controller.clearSelection();

    expect(doc.undoStack).toHaveLength(1);
  });

  it("pushes a snapshot onto undoStack when there is a selectionMask to clear", () => {
    const doc = freshDoc();
    doc.selectionMask = createMaskCanvas(100, 100);
    const controller = makeController(doc);

    controller.clearSelection();

    expect(doc.undoStack).toHaveLength(1);
  });

  it("clears the redoStack when there is something to clear", () => {
    const doc = freshDoc();
    doc.selectionRect = { x: 0, y: 0, width: 10, height: 10 };
    doc.redoStack = ["old-redo"];
    const controller = makeController(doc);

    controller.clearSelection();

    expect(doc.redoStack).toHaveLength(0);
  });

  it("pushes 'Deselected' into history", () => {
    const doc = freshDoc();
    doc.selectionRect = { x: 0, y: 0, width: 50, height: 50 };
    const controller = makeController(doc);

    controller.clearSelection();

    expect(doc.history[0]).toBe("Deselected");
  });

  it("does NOT push a snapshot when there is nothing to clear", () => {
    const doc = freshDoc();
    // no selectionRect or selectionMask
    const controller = makeController(doc);

    controller.clearSelection();

    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// selectEntireCanvas — undo snapshots
// ---------------------------------------------------------------------------

describe("selectEntireCanvas — undo snapshots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pushes a snapshot onto undoStack", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    const controller = makeController(doc);

    controller.selectEntireCanvas();

    expect(doc.undoStack).toHaveLength(1);
  });

  it("clears the redoStack", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    doc.redoStack = ["old-redo"];
    const controller = makeController(doc);

    controller.selectEntireCanvas();

    expect(doc.redoStack).toHaveLength(0);
  });

  it("pushes 'Selected all' into history", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    const controller = makeController(doc);

    controller.selectEntireCanvas();

    expect(doc.history[0]).toBe("Selected all");
  });

  it("sets selectionRect to the full canvas bounds", () => {
    const doc = makeNewDocument("Doc", 200, 150, 100, "transparent");
    const controller = makeController(doc);

    controller.selectEntireCanvas();

    expect(doc.selectionRect).toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });
});

// ---------------------------------------------------------------------------
// invertSelection — undo snapshots
// ---------------------------------------------------------------------------

describe("invertSelection — undo snapshots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pushes a snapshot onto undoStack when inverting with no prior selection", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    // no selectionRect, no selectionMask → invert creates a full-canvas inverted selection
    const controller = makeController(doc);

    controller.invertSelection();

    expect(doc.undoStack).toHaveLength(1);
  });

  it("clears the redoStack on invert", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    doc.redoStack = ["old-redo"];
    const controller = makeController(doc);

    controller.invertSelection();

    expect(doc.redoStack).toHaveLength(0);
  });

  it("pushes 'Inverted selection' into history", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    const controller = makeController(doc);

    controller.invertSelection();

    expect(doc.history[0]).toBe("Inverted selection");
  });

  it("pushes a snapshot when inverting an existing rect selection", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    doc.selectionRect = { x: 10, y: 10, width: 50, height: 50 };
    const controller = makeController(doc);

    controller.invertSelection();

    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Inverted selection");
  });
});

// ---------------------------------------------------------------------------
// completeLassoSelection — undo snapshots
// ---------------------------------------------------------------------------

describe("completeLassoSelection — undo snapshots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pushes a snapshot on valid commit when maskBounds is non-null", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    doc.selectionPath = {
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }],
      closed: false,
    };
    const controller = makeController(doc, { getActiveTool: () => "lasso" });

    // Mock getImageData to return filled data so maskBoundingRect returns non-null
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = 100, h = 100;
    const filled = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < filled.length; i += 4) {
      filled[i + 3] = 255;
    }
    vi.mocked(ctx.getImageData).mockReturnValue({ data: filled, width: w, height: h } as unknown as ImageData);

    controller.completeLassoSelection(0, 0);

    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Lasso selection");
  });

  it("does NOT push a snapshot when selectionPath has too few points", () => {
    const doc = freshDoc();
    doc.selectionPath = {
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }], // only 2 points
      closed: false,
    };
    const controller = makeController(doc, { getActiveTool: () => "lasso" });

    controller.completeLassoSelection(0, 0);

    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toHaveLength(0);
  });

  it("does NOT push a snapshot when path bounding rect is too small", () => {
    const doc = freshDoc();
    doc.selectionPath = {
      // All points at roughly same coords → width < 2, height < 2
      points: [{ x: 10, y: 10 }, { x: 10.5, y: 10 }, { x: 10, y: 10.5 }],
      closed: false,
    };
    const controller = makeController(doc, { getActiveTool: () => "lasso" });

    controller.completeLassoSelection(0, 0);

    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toHaveLength(0);
  });

  it("does NOT push a snapshot when selectionPath is null", () => {
    const doc = freshDoc();
    doc.selectionPath = null;
    const controller = makeController(doc, { getActiveTool: () => "lasso" });

    controller.completeLassoSelection(0, 0);

    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toHaveLength(0);
  });

  it("clears redoStack on valid commit", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    doc.redoStack = ["old-redo"];
    doc.selectionPath = {
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }],
      closed: false,
    };
    const controller = makeController(doc, { getActiveTool: () => "lasso" });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = 100, h = 100;
    const filled = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < filled.length; i += 4) {
      filled[i + 3] = 255;
    }
    vi.mocked(ctx.getImageData).mockReturnValue({ data: filled, width: w, height: h } as unknown as ImageData);

    controller.completeLassoSelection(0, 0);

    expect(doc.redoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// magicWandSelect — undo snapshots
// ---------------------------------------------------------------------------

describe("magicWandSelect — undo snapshots", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pushes a snapshot when selection is successfully made", () => {
    const layer = makeRasterLayer(10, 10);
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const controller = makeController(doc, { getActiveTool: () => "magic-wand" });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = 10, h = 10;

    // Layer getImageData — returns a single-pixel seed at [0,0] with color (200,200,200,255)
    // All other pixels also match since tolerance is 32 and they'd be (255,255,255,255) in default mock
    // We use a targeted mock: first call from magicWandSelect (layer ctx), subsequent calls from maskBoundingRect
    const layerData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < layerData.length; i += 4) {
      layerData[i] = 200;
      layerData[i + 1] = 200;
      layerData[i + 2] = 200;
      layerData[i + 3] = 255;
    }
    const maskData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < maskData.length; i += 4) {
      maskData[i + 3] = 255; // non-zero alpha so maskBoundingRect returns bounds
    }
    vi.mocked(ctx.getImageData)
      .mockReturnValueOnce({ data: layerData, width: w, height: h } as unknown as ImageData) // layer read
      .mockReturnValue({ data: maskData, width: w, height: h } as unknown as ImageData);    // mask bounding rect

    controller.magicWandSelect(0, 0);

    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Magic wand selection");
  });

  it("does NOT push a snapshot when no matching pixels are found", () => {
    const layer = makeRasterLayer(10, 10);
    const doc = freshDoc(10, 10);
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const controller = makeController(doc, { getActiveTool: () => "magic-wand" });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = 10, h = 10;

    const layerData = new Uint8ClampedArray(w * h * 4);
    // All pixels transparent → no match for flood fill (seed pixel is also transparent → all 0s)
    // maskBoundingRect will also return null (no alpha)
    const emptyMaskData = new Uint8ClampedArray(w * h * 4); // all zeros
    vi.mocked(ctx.getImageData)
      .mockReturnValueOnce({ data: layerData, width: w, height: h } as unknown as ImageData)  // layer read
      .mockReturnValue({ data: emptyMaskData, width: w, height: h } as unknown as ImageData); // mask bounding rect

    controller.magicWandSelect(0, 0);

    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toHaveLength(0);
  });

  it("clears redoStack on successful magic wand selection", () => {
    const layer = makeRasterLayer(10, 10);
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    doc.redoStack = ["old-redo"];
    const controller = makeController(doc, { getActiveTool: () => "magic-wand" });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = 10, h = 10;
    const layerData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < layerData.length; i += 4) {
      layerData[i] = 200; layerData[i + 1] = 200; layerData[i + 2] = 200; layerData[i + 3] = 255;
    }
    const maskData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < maskData.length; i += 4) {
      maskData[i + 3] = 255;
    }
    vi.mocked(ctx.getImageData)
      .mockReturnValueOnce({ data: layerData, width: w, height: h } as unknown as ImageData)
      .mockReturnValue({ data: maskData, width: w, height: h } as unknown as ImageData);

    controller.magicWandSelect(0, 0);

    expect(doc.redoStack).toHaveLength(0);
  });
});
