import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import * as canvasPointerModule from "./canvasPointer";
import { combineMasks, createMaskCanvas, defaultPolygonRotation, maskBoundingRect, maskContainsRect, rasterizeRectToMask } from "./selection";
import type { PointerState } from "./types";

vi.mock("./selection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./selection")>();
  return {
    ...actual,
    createMaskCanvas: vi.fn((width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }),
    rasterizeRectToMask: vi.fn(),
    combineMasks: vi.fn(),
    maskBoundingRect: vi.fn(),
    maskContainsRect: vi.fn(),
  };
});

function createPointerState(): PointerState {
  return {
    mode: "none",
    lastDocX: 0,
    lastDocY: 0,
    startDocX: 0,
    startDocY: 0,
    startClientX: 0,
    startClientY: 0,
    startLayerX: 0,
    startLayerY: 0,
    startPanX: 0,
    startPanY: 0,
    startSelectionRect: null,
    startSelectionInverted: false,
    transformHandle: null,
    startLayerWidth: 0,
    startLayerHeight: 0,
    startScaleX: 1,
    startScaleY: 1,
    startCenterX: 0,
    startCenterY: 0,
    startPivotX: 0,
    startPivotY: 0,
    startRotateDeg: 0,
    startSkewXDeg: 0,
    startSkewYDeg: 0,
    cloneOffsetX: 0,
    cloneOffsetY: 0,
    creationLayerId: null,
  };
}

function createMarqueeController(options?: {
  modifiers?: { rotate: boolean; perfect: boolean };
  selectionMode?: "replace" | "add" | "subtract" | "intersect";
  marqueeShape?: number;
}) {
  const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
  const editorCanvas = document.createElement("canvas");
  const canvasWrap = document.createElement("div");
  const renderEditorState = vi.fn();
  const pointerState = createPointerState();
  const modifiers = options?.modifiers ?? { rotate: false, perfect: true };

  vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const controller = canvasPointerModule.createCanvasPointerController({
    editorCanvas,
    canvasWrap,
    getActiveDocument: () => doc,
    getActiveLayer: (activeDoc) => activeDoc.layers[0],
    getActiveTool: () => "marquee",
    commitTransformDraft: vi.fn(),
    getSelectionMode: () => options?.selectionMode ?? "replace",
    getMarqueeShape: () => options?.marqueeShape ?? 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => null),
    getTransformDraft: vi.fn(() => null),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000" }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => modifiers,
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas: vi.fn(),
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn(() => null),
    getMaskEditTarget: () => null,
    getQuickMaskCanvas: () => null,
    log: vi.fn(),
  });

  return { controller, doc, renderEditorState };
}

function createPointerControllerFixture(options?: {
  activeTool?: string;
  hasTransformDraft?: boolean;
}) {
  const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
  const editorCanvas = document.createElement("canvas");
  const canvasWrap = document.createElement("div");
  const renderEditorState = vi.fn();
  const renderCanvas = vi.fn();
  const pointerState = createPointerState();
  const commitTransformDraft = vi.fn();
  const activeTool = options?.activeTool ?? "brush";
  const editableLayer = doc.layers[1]!;
  const transformDraft = options?.hasTransformDraft ? {
    layerId: editableLayer.id,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    centerX: 0,
    centerY: 0,
    pivotX: 0,
    pivotY: 0,
    sourceCanvas: document.createElement("canvas"),
  } : null;

  vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const controller = canvasPointerModule.createCanvasPointerController({
    editorCanvas,
    canvasWrap,
    getActiveDocument: () => doc,
    getActiveLayer: (activeDoc) => activeDoc.layers[1],
    getActiveTool: () => activeTool,
    commitTransformDraft,
    getSelectionMode: () => "replace",
    getMarqueeShape: () => 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => null),
    getTransformDraft: vi.fn(() => transformDraft),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000" }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas,
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn(() => null),
    getMaskEditTarget: () => null,
    getQuickMaskCanvas: () => null,
    log: vi.fn(),
  });

  return { controller, doc, pointerState, commitTransformDraft, renderEditorState, renderCanvas };
}

describe("canvasPointer marquee drag", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(createMaskCanvas).mockImplementation((width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });
    vi.mocked(rasterizeRectToMask).mockImplementation(() => undefined);
    vi.mocked(combineMasks).mockImplementation(() => undefined);
    vi.mocked(maskBoundingRect).mockReturnValue(null);
    vi.mocked(maskContainsRect).mockReturnValue(false);
  });

  it("supports down-right marquee drag without shifting away from the cursor", () => {
    const { controller, doc, renderEditorState } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 40 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 10, y: 20, width: 20, height: 20 });
    expect(renderEditorState).toHaveBeenCalledTimes(2);
  });

  it("supports up-left marquee drag", () => {
    const { controller, doc } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 5, clientY: 10 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 5, y: 10, width: 5, height: 10 });
  });

  it("supports up-right marquee drag", () => {
    const { controller, doc } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 35, clientY: 10 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 10, y: 10, width: 25, height: 10 });
  });

  it("supports down-left marquee drag", () => {
    const { controller, doc } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 5, clientY: 40 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 5, y: 20, width: 5, height: 20 });
  });

  it("keeps perfect marquee attached to the dragged quadrant instead of forcing down-right", () => {
    const { controller, doc } = createMarqueeController();

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 0, clientY: 10 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 0, y: 10, width: 10, height: 10 });
  });

  it("keeps Ctrl+Shift marquee drag center-origin for rotate mode", () => {
    const { controller, doc } = createMarqueeController({ modifiers: { rotate: true, perfect: true } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 20, clientY: 20 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 0, y: 10, width: 20, height: 20 });
  });

  it("keeps the dragged marquee bounds after replace commit when the mask stays inside them", () => {
    const { controller, doc } = createMarqueeController();

    vi.mocked(maskContainsRect).mockReturnValue(true);
    vi.mocked(maskBoundingRect).mockReturnValue({ x: 14, y: 24, width: 22, height: 22 });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 50 } as PointerEvent);
    controller.handlePointerUp();

    expect(rasterizeRectToMask).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), { x: 10, y: 20, width: 30, height: 30 }, 4, expect.any(Number), true, true);
    expect(doc.selectionRect).toEqual({ x: 10, y: 20, width: 30, height: 30 });
    expect(doc.selectionMask).toBeInstanceOf(HTMLCanvasElement);
  });

  it("commits four-sided marquee masks with the axis-aligned rectangle geometry", () => {
    const { controller } = createMarqueeController({ modifiers: { rotate: false, perfect: false }, marqueeShape: 4 });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 55 } as PointerEvent);
    controller.handlePointerUp();

    expect(rasterizeRectToMask).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      { x: 10, y: 20, width: 30, height: 35 },
      4,
      defaultPolygonRotation(4),
      false,
      true,
    );
  });

  it("commits Ctrl+Shift four-sided marquee masks with rotated center-origin geometry", () => {
    const { controller, doc } = createMarqueeController({ modifiers: { rotate: true, perfect: true }, marqueeShape: 4 });
    vi.mocked(maskBoundingRect).mockReturnValue({ x: 20, y: 20, width: 40, height: 40 });

    controller.handlePointerDown({ clientX: 40, clientY: 40, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 60, clientY: 40 } as PointerEvent);
    controller.handlePointerUp();

    expect(doc.selectionRect).toEqual({ x: 20, y: 20, width: 40, height: 40 });
    expect(rasterizeRectToMask).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      { x: 20, y: 20, width: 40, height: 40 },
      4,
      0,
      true,
      false,
    );
  });

  it("falls back to combined mask bounds for non-replace marquee commits", () => {
    const { controller, doc } = createMarqueeController({ selectionMode: "add" });

    doc.selectionMask = document.createElement("canvas");
    vi.mocked(maskBoundingRect).mockReturnValue({ x: 5, y: 7, width: 40, height: 44 });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 50 } as PointerEvent);
    controller.handlePointerUp();

    expect(combineMasks).toHaveBeenCalledTimes(1);
    expect(doc.selectionRect).toEqual({ x: 5, y: 7, width: 40, height: 44 });
  });

  it("commits a pending transform before starting a brush stroke", () => {
    const { controller, pointerState, commitTransformDraft, renderEditorState } = createPointerControllerFixture({ activeTool: "brush", hasTransformDraft: true });

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);

    expect(commitTransformDraft).toHaveBeenCalledOnce();
    expect(pointerState.mode).toBe("paint");
    expect(renderEditorState).toHaveBeenCalledOnce();
  });

  it("commits a pending transform before starting a marquee drag", () => {
    const { controller, doc, pointerState, commitTransformDraft } = createPointerControllerFixture({ activeTool: "marquee", hasTransformDraft: true });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);

    expect(commitTransformDraft).toHaveBeenCalledOnce();
    expect(pointerState.mode).toBe("marquee");
    expect(doc.selectionRect).toEqual({ x: 10, y: 20, width: 1, height: 1 });
  });

  it("pushes 'Marquee selection' to undo history after a valid drag", () => {
    const { controller, doc } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 50 } as PointerEvent);
    controller.handlePointerUp();

    expect(doc.undoStack.length).toBeGreaterThan(0);
    expect(doc.history[0]).toBe("Marquee selection");
  });

  it("pushes 'Deselected' to undo history when clicking to clear an active selection", () => {
    const { controller, doc } = createMarqueeController({ selectionMode: "replace" });

    // Seed an active selection so there is something to clear
    doc.selectionRect = { x: 5, y: 5, width: 30, height: 30 };
    const undoCountBefore = doc.undoStack.length;

    // Click without dragging — produces a 1×1 rect which is < 2, triggering the clear path
    controller.handlePointerDown({ clientX: 60, clientY: 60, button: 0 } as PointerEvent);
    controller.handlePointerUp();

    expect(doc.selectionRect).toBeNull();
    expect(doc.undoStack.length).toBe(undoCountBefore + 1);
    expect(doc.history[0]).toBe("Deselected");
  });
});
