import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import { createSelectionController } from "./selectionController";
import { createMaskCanvas, fillMask } from "./selection";
import type { RasterLayer } from "./types";
import { createLayerCanvas, syncLayerSource } from "./documents";
import { installPixelCanvasMock, readPixel, setPixel } from "../test/pixelCanvasMock";

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
    getSelectionMaskTarget: () => null,
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
      getSelectionMaskTarget: () => null,
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
      getSelectionMaskTarget: () => null,
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
      getSelectionMaskTarget: () => null,
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
      getSelectionMaskTarget: () => null,
    });

    expect(controller.getMarqueeModifiers({ ctrlPressed: true, shiftPressed: true, altPressed: false })).toEqual({ rotate: true, perfect: false });
    expect(controller.getMarqueeModifiers({ ctrlPressed: false, shiftPressed: true, altPressed: true })).toEqual({ rotate: false, perfect: true });
    expect(controller.getMarqueeModifiers({ ctrlPressed: false, shiftPressed: false, altPressed: false })).toEqual({ rotate: false, perfect: false });
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

  it("clears an existing selection on replace-mode lasso click", () => {
    const doc = freshDoc();
    doc.selectionRect = { x: 5, y: 5, width: 30, height: 30 };
    doc.selectionMask = createMaskCanvas(doc.width, doc.height);
    fillMask(doc.selectionMask);
    doc.selectionPath = {
      points: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
      closed: false,
    };
    const controller = makeController(doc, { getActiveTool: () => "lasso" });

    controller.completeLassoSelection(0, 0);

    expect(doc.selectionRect).toBeNull();
    expect(doc.selectionMask).toBeNull();
    expect(doc.selectionPath).toBeNull();
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Deselected");
  });

  it("keeps the current selection on non-replace lasso click", () => {
    const doc = freshDoc();
    const existingMask = createMaskCanvas(doc.width, doc.height);
    fillMask(existingMask);
    doc.selectionRect = { x: 5, y: 5, width: 30, height: 30 };
    doc.selectionMask = existingMask;
    doc.selectionPath = {
      points: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
      closed: false,
    };
    const controller = makeController(doc, { getActiveTool: () => "lasso" });
    controller.setMarqueeMode("add");

    controller.completeLassoSelection(0, 0);

    expect(doc.selectionRect).toEqual({ x: 5, y: 5, width: 30, height: 30 });
    expect(doc.selectionMask).toBe(existingMask);
    expect(doc.selectionPath).toBeNull();
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

// ---------------------------------------------------------------------------
// session-target redirection
// ---------------------------------------------------------------------------

describe("session-target redirection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installPixelCanvasMock();
  });

  function freshDocWithPixelMock(width = 10, height = 10) {
    const doc = makeNewDocument("Doc", width, height, 100, "transparent");
    doc.history = [];
    doc.historyIndex = 0;
    doc.undoStack = [];
    doc.redoStack = [];
    return doc;
  }

  function makePixelRasterLayer(w = 10, h = 10): RasterLayer {
    const canvas = createLayerCanvas(w, h);
    // Fill with a uniform colour so magic wand flood-fill hits every pixel
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        setPixel(canvas, x, y, { r: 200, g: 200, b: 200, a: 255 });
      }
    }
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

  function makeSessionTargetController(
    doc: ReturnType<typeof freshDocWithPixelMock>,
    sessionTarget: HTMLCanvasElement,
    overrides?: {
      getActiveTool?: () => string;
      getActiveLayer?: (d: ReturnType<typeof freshDocWithPixelMock>) => RasterLayer | null;
    },
  ) {
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
      getSelectionMaskTarget: () => sessionTarget,
    });
  }

  it("magic wand writes to session target when active", () => {
    const layer = makePixelRasterLayer(10, 10);
    const doc = freshDocWithPixelMock(10, 10);
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const sessionTarget = createMaskCanvas(10, 10);

    const controller = makeSessionTargetController(doc, sessionTarget, {
      getActiveTool: () => "magic-wand",
    });

    controller.magicWandSelect(0, 0);

    // The session target should have pixels (magic wand found contiguous region)
    const pixel = readPixel(sessionTarget, 0, 0);
    expect(pixel.a).toBeGreaterThan(0);

    // doc.selectionMask should NOT be modified
    expect(doc.selectionMask).toBeNull();
  });

  it("lasso writes to session target when active", () => {
    const layer = makePixelRasterLayer(100, 100);
    const doc = freshDocWithPixelMock(100, 100);
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const sessionTarget = createMaskCanvas(100, 100);

    // Set up a valid lasso path (>= 3 points, large enough bounding rect)
    doc.selectionPath = {
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }],
      closed: false,
    };

    const controller = makeSessionTargetController(doc, sessionTarget, {
      getActiveTool: () => "lasso",
    });

    controller.completeLassoSelection(0, 0);

    // The session target should have pixels from the lasso rasterization
    let hasPixels = false;
    for (let y = 10; y < 50; y++) {
      for (let x = 10; x < 50; x++) {
        if (readPixel(sessionTarget, x, y).a > 0) {
          hasPixels = true;
          break;
        }
      }
      if (hasPixels) break;
    }
    expect(hasPixels).toBe(true);

    // doc.selectionMask should NOT be modified
    expect(doc.selectionMask).toBeNull();
  });

  it("replace mode clears target before writing", () => {
    // Create a layer where only the top-left quadrant matches magic wand.
    // This way the mask won't cover pixel (9,9), and replace's clearRect
    // will erase the pre-filled pixel there.
    const w = 10, h = 10;
    const layer: RasterLayer = {
      id: "layer-test",
      type: "raster",
      name: "Layer",
      canvas: createLayerCanvas(w, h),
      x: 0,
      y: 0,
      visible: true,
      opacity: 1,
      locked: false,
      effects: [],
    };
    // Fill top-left quadrant with one colour and bottom-right with a very different colour
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 5 && y < 5) {
          setPixel(layer.canvas, x, y, { r: 100, g: 100, b: 100, a: 255 });
        } else {
          setPixel(layer.canvas, x, y, { r: 0, g: 0, b: 0, a: 0 }); // transparent
        }
      }
    }
    syncLayerSource(layer);

    const doc = freshDocWithPixelMock(w, h);
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const sessionTarget = createMaskCanvas(w, h);

    // Pre-fill a pixel in the bottom-right area (outside the magic wand region)
    setPixel(sessionTarget, 9, 9, { r: 255, g: 0, b: 0, a: 200 });
    expect(readPixel(sessionTarget, 9, 9).a).toBe(200);

    const controller = makeSessionTargetController(doc, sessionTarget, {
      getActiveTool: () => "magic-wand",
    });
    // Default mode is "replace" — clearRect runs before drawImage
    // Tolerance 32: magic wand from (2,2) floods the top-left contiguous region (100,100,100,255)

    controller.magicWandSelect(2, 2);

    // After replace mode: clearRect wiped the entire target, then the mask was drawn.
    // The mask only covers the top-left quadrant, so (9,9) should now be transparent.
    const pixel = readPixel(sessionTarget, 9, 9);
    expect(pixel.a).toBe(0); // old pixel was cleared by replace
    // And the top-left quadrant should have the mask
    expect(readPixel(sessionTarget, 2, 2).a).toBeGreaterThan(0);
  });

  it("add mode accumulates on target", () => {
    const layer = makePixelRasterLayer(10, 10);
    const doc = freshDocWithPixelMock(10, 10);
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const sessionTarget = createMaskCanvas(10, 10);

    // Pre-fill a pixel on the target
    setPixel(sessionTarget, 5, 5, { r: 255, g: 255, b: 255, a: 255 });
    expect(readPixel(sessionTarget, 5, 5).a).toBe(255);

    const controller = makeSessionTargetController(doc, sessionTarget, {
      getActiveTool: () => "magic-wand",
    });
    controller.setMarqueeMode("add");

    // Magic wand will add its result onto the existing target
    controller.magicWandSelect(0, 0);

    // The pre-existing pixel should still be there (add doesn't clear)
    expect(readPixel(sessionTarget, 5, 5).a).toBe(255);
    // And a new pixel from the magic wand should also be present
    expect(readPixel(sessionTarget, 0, 0).a).toBeGreaterThan(0);
  });

  it("no undo push when writing to session target", () => {
    const layer = makePixelRasterLayer(10, 10);
    const doc = freshDocWithPixelMock(10, 10);
    doc.layers = [layer];
    doc.activeLayerId = layer.id;
    const sessionTarget = createMaskCanvas(10, 10);

    const controller = makeSessionTargetController(doc, sessionTarget, {
      getActiveTool: () => "magic-wand",
    });

    controller.magicWandSelect(0, 0);

    // undo stack should remain empty — session manages its own state
    expect(doc.undoStack).toHaveLength(0);
  });
});
