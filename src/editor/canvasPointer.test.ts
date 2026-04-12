import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import * as canvasPointerModule from "./canvasPointer";
import * as healingModule from "./healing";
import { createShapeLayer, createTextLayer } from "./documents";
import { applyFillToSelection } from "./fill";
import { hitTestShapeLayer } from "./shapeHitTesting";
import { combineMasks, createMaskCanvas, defaultPolygonRotation, maskBoundingRect, maskContainsRect, rasterizeRectToMask } from "./selection";
import { createSmartObjectLayer } from "./smartObject";
import { installPixelCanvasMock, readPixel, setPixel } from "../test/pixelCanvasMock";
import type { Layer, PointerState } from "./types";

vi.mock("./fill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fill")>();
  return {
    ...actual,
    applyFillToSelection: vi.fn(actual.applyFillToSelection),
  };
});

vi.mock("./fillGradientValidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fillGradientValidation")>();
  return {
    ...actual,
    getFillGradientTargetError: vi.fn(actual.getFillGradientTargetError),
  };
});

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
    startTextBoxWidth: 0,
    startTextBoxHeight: 0,
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
  const scheduleCanvasRender = vi.fn();
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
    isTextEditingActive: () => false,
    commitTransformDraft: vi.fn(),
    cancelTransformDraft: vi.fn(),
    getSelectionMode: () => options?.selectionMode ?? "replace",
    getMarqueeShape: () => options?.marqueeShape ?? 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => null),
    getTransformDraft: vi.fn(() => null),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => modifiers,
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas: vi.fn(),
    scheduleCanvasRender,
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn(() => null),
    getCustomPaintTarget: () => null,
    getMaskEditTarget: () => null,
    getQuickMaskCanvas: () => null,
    showToast: vi.fn(),
    log: vi.fn(),
    getSelectionMaskTarget: () => null,
  });

  return { controller, doc, renderEditorState, scheduleCanvasRender };
}

function createPointerControllerFixture(options?: {
  activeTool?: string;
  hasTransformDraft?: boolean;
   isTextEditingActive?: boolean;
   quickMaskCanvas?: HTMLCanvasElement | null;
   customPaintTarget?: {
     canvas: HTMLCanvasElement;
    exclusiveCanvas?: HTMLCanvasElement;
    historyMode: "document" | "ephemeral";
    paintLabel: string;
    logLabel: string;
  } | null;
  maskEditTarget?: "active-layer" | string | null;
  onCreateShapeLayer?: (x: number, y: number) => ReturnType<typeof createShapeLayer> | null;
}) {
  const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
  const editorCanvas = document.createElement("canvas");
  const canvasWrap = document.createElement("div");
  const renderEditorState = vi.fn();
  const renderCanvas = vi.fn();
  const scheduleCanvasRender = vi.fn();
  const showToast = vi.fn();
  const pointerState = createPointerState();
  const commitTransformDraft = vi.fn();
  const cancelTransformDraft = vi.fn();
  const activeTool = options?.activeTool ?? "brush";
  const editableLayer = doc.layers[1]!;
  const transformDraft = options?.hasTransformDraft ? {
    layerId: editableLayer.id,
    intent: "layer" as const,
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
    getActiveLayer: (activeDoc) => activeDoc.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? activeDoc.layers[1] ?? null,
    getActiveTool: () => activeTool,
    isTextEditingActive: () => options?.isTextEditingActive ?? false,
    commitTransformDraft,
    cancelTransformDraft,
    getSelectionMode: () => "replace",
    getMarqueeShape: () => 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => null),
    getTransformDraft: vi.fn(() => transformDraft),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas,
    scheduleCanvasRender,
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn((x: number, y: number) => options?.onCreateShapeLayer?.(x, y) ?? null),
    getCustomPaintTarget: () => options?.customPaintTarget ?? null,
    getMaskEditTarget: () => options?.maskEditTarget === "active-layer" ? editableLayer.id : options?.maskEditTarget ?? null,
    getQuickMaskCanvas: () => options?.quickMaskCanvas ?? null,
    showToast,
    log: vi.fn(),
    getSelectionMaskTarget: () => null,
  });

  return { controller, doc, pointerState, commitTransformDraft, cancelTransformDraft, renderEditorState, scheduleCanvasRender, renderCanvas, showToast };
}

function addOpaquePixel(layer: { canvas: HTMLCanvasElement; x: number; y: number }, localX = 2, localY = 2) {
  setPixel(layer.canvas, localX, localY, { r: 255, g: 255, b: 255, a: 255 });
  return { clientX: layer.x + localX, clientY: layer.y + localY };
}

function createTextTransformControllerFixture() {
  const doc = makeNewDocument("Doc", 320, 240, 100, "transparent");
  const editorCanvas = document.createElement("canvas");
  const canvasWrap = document.createElement("div");
  const pointerState = createPointerState();
  const renderEditorState = vi.fn();
  const scheduleCanvasRender = vi.fn();
  let activeTool = "transform";
  const textLayer = createTextLayer("Headline", 40, 30, { text: "Wrapped text for resize", fontSize: 24, boxWidth: 140 });
  doc.layers.push(textLayer);
  doc.activeLayerId = textLayer.id;
  const draft: any = {
    layerId: textLayer.id,
    intent: "layer" as const,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    centerX: textLayer.x + textLayer.canvas.width / 2,
    centerY: textLayer.y + textLayer.canvas.height / 2,
    pivotX: textLayer.x + textLayer.canvas.width / 2,
    pivotY: textLayer.y + textLayer.canvas.height / 2,
    sourceCanvas: textLayer.sourceCanvas ?? textLayer.canvas,
    textBoxWidth: textLayer.textData.boxWidth,
    textBoxHeight: textLayer.textData.boxHeight,
    previewOverride: null,
  };

  vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 320,
    height: 240,
    right: 320,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const controller = canvasPointerModule.createCanvasPointerController({
    editorCanvas,
    canvasWrap,
    getActiveDocument: () => doc,
    getActiveLayer: () => textLayer,
    getActiveTool: () => activeTool,
    isTextEditingActive: () => false,
    commitTransformDraft: vi.fn(),
    cancelTransformDraft: vi.fn(),
    getSelectionMode: () => "replace",
    getMarqueeShape: () => 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => draft),
    getTransformDraft: vi.fn(() => draft),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas: vi.fn(),
    scheduleCanvasRender,
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn(() => null),
    getCustomPaintTarget: () => null,
    getMaskEditTarget: () => null,
    getQuickMaskCanvas: () => null,
    showToast: vi.fn(),
    log: vi.fn(),
    getSelectionMaskTarget: () => null,
  });

  return { controller, doc, draft, textLayer, pointerState, renderEditorState, scheduleCanvasRender, setActiveTool: (tool: string) => { activeTool = tool; } };
}

function createShapeTransformControllerFixture() {
  const doc = makeNewDocument("Doc", 320, 240, 100, "transparent");
  const editorCanvas = document.createElement("canvas");
  const canvasWrap = document.createElement("div");
  const pointerState = createPointerState();
  const scheduleCanvasRender = vi.fn();
  const shapeLayer = createShapeLayer("Badge", "rectangle", 60, 50);
  doc.layers.push(shapeLayer);
  doc.activeLayerId = shapeLayer.id;
  const draft: any = {
    layerId: shapeLayer.id,
    intent: "layer" as const,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    centerX: shapeLayer.x + shapeLayer.canvas.width / 2,
    centerY: shapeLayer.y + shapeLayer.canvas.height / 2,
    pivotX: shapeLayer.x + shapeLayer.canvas.width / 2,
    pivotY: shapeLayer.y + shapeLayer.canvas.height / 2,
    sourceCanvas: shapeLayer.sourceCanvas ?? shapeLayer.canvas,
    previewOverride: null,
  };

  vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 320,
    height: 240,
    right: 320,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const controller = canvasPointerModule.createCanvasPointerController({
    editorCanvas,
    canvasWrap,
    getActiveDocument: () => doc,
    getActiveLayer: () => shapeLayer,
    getActiveTool: () => "transform",
    isTextEditingActive: () => false,
    commitTransformDraft: vi.fn(),
    cancelTransformDraft: vi.fn(),
    getSelectionMode: () => "replace",
    getMarqueeShape: () => 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => draft),
    getTransformDraft: vi.fn(() => draft),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas: vi.fn(),
    scheduleCanvasRender,
    renderEditorState: vi.fn(),
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn(() => null),
    getCustomPaintTarget: () => null,
    getMaskEditTarget: () => null,
    getQuickMaskCanvas: () => null,
    showToast: vi.fn(),
    log: vi.fn(),
    getSelectionMaskTarget: () => null,
  });

  return { controller, doc, draft, shapeLayer, pointerState, scheduleCanvasRender };
}

function createTextToolControllerFixture(options?: {
  selectedTextLayer?: boolean;
  isTextEditingActive?: boolean;
  draftRef?: { current: any | null };
}) {
  const doc = makeNewDocument("Doc", 320, 240, 100, "transparent");
  const editorCanvas = document.createElement("canvas");
  const canvasWrap = document.createElement("div");
  const pointerState = createPointerState();
  const renderEditorState = vi.fn();
  const createTextLayerSpy = vi.fn((x: number, y: number) => createTextLayer("Created text", x, y, { text: "New text" }));
  const cancelTransformDraft = vi.fn();
  const selectedLayer = createTextLayer("Existing text", 40, 30, { text: "Hello world", boxWidth: 140 });
  doc.layers.push(selectedLayer);
  if (options?.selectedTextLayer) {
    doc.activeLayerId = selectedLayer.id;
  }
  const draft = options?.selectedTextLayer ? {
    layerId: selectedLayer.id,
    intent: "text-layout" as const,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    centerX: selectedLayer.x + selectedLayer.canvas.width / 2,
    centerY: selectedLayer.y + selectedLayer.canvas.height / 2,
    pivotX: selectedLayer.x + selectedLayer.canvas.width / 2,
    pivotY: selectedLayer.y + selectedLayer.canvas.height / 2,
    sourceCanvas: selectedLayer.sourceCanvas ?? selectedLayer.canvas,
    textBoxWidth: selectedLayer.textData.boxWidth,
    textBoxHeight: selectedLayer.textData.boxHeight,
    previewOverride: null,
  } : null;
  if (options?.draftRef) {
    options.draftRef.current = draft;
  }

  vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 320,
    height: 240,
    right: 320,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const controller = canvasPointerModule.createCanvasPointerController({
    editorCanvas,
    canvasWrap,
    getActiveDocument: () => doc,
    getActiveLayer: (activeDoc) => activeDoc.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? null,
    getActiveTool: () => "text",
    isTextEditingActive: () => options?.isTextEditingActive ?? false,
    commitTransformDraft: vi.fn(),
    cancelTransformDraft,
    getSelectionMode: () => "replace",
    getMarqueeShape: () => 4,
    getTransformMode: () => "scale",
    ensureTransformDraft: vi.fn(() => draft),
    getTransformDraft: vi.fn(() => options?.draftRef ? options.draftRef.current : draft),
    syncTransformInputs: vi.fn(),
    getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
    getSpacePressed: () => false,
    getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
    snapLayerPosition: (_layer, x, y) => ({ x, y }),
    pointerState,
    renderCanvas: vi.fn(),
    scheduleCanvasRender: vi.fn(),
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: createTextLayerSpy,
    onCreateShapeLayer: vi.fn(() => null),
    getCustomPaintTarget: () => null,
    getMaskEditTarget: () => null,
    getQuickMaskCanvas: () => null,
    showToast: vi.fn(),
    log: vi.fn(),
    getSelectionMaskTarget: () => null,
  });

  return { controller, doc, pointerState, renderEditorState, createTextLayerSpy, cancelTransformDraft, selectedLayer };
}

describe("canvasPointer marquee drag", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installPixelCanvasMock();
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
    vi.mocked(applyFillToSelection).mockReset();
  });

  it("supports down-right marquee drag without shifting away from the cursor", () => {
    const { controller, doc, renderEditorState, scheduleCanvasRender } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 40 } as PointerEvent);

    expect(doc.selectionRect).toEqual({ x: 10, y: 20, width: 20, height: 20 });
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(scheduleCanvasRender).toHaveBeenCalledTimes(1);
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

  it("uses text tool side handles to resize the text box instead of skewing", () => {
    const { controller, draft, textLayer, pointerState, scheduleCanvasRender, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width;
    const startY = textLayer.y + textLayer.canvas.height / 2;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 60, clientY: startY } as PointerEvent);

    expect(pointerState.transformHandle).toBe("e");
    expect(draft.textBoxWidth).toBeGreaterThan(textLayer.textData.boxWidth ?? 0);
    const preview = draft.previewOverride as { width: number } | null;
    expect(preview).not.toBeNull();
    if (!preview) {
      throw new Error("Expected text resize preview");
    }
    expect(preview.width).toBeGreaterThan(textLayer.canvas.width);
    expect(draft.skewXDeg).toBe(0);
    expect(draft.skewYDeg).toBe(0);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
  });

  it("anchors text-layout resize math to the gesture start across repeated pointer moves", () => {
    const { controller, draft, textLayer, pointerState, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width;
    const startY = textLayer.y + textLayer.canvas.height / 2;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 30, clientY: startY } as PointerEvent);

    const firstExpectedWidth = Math.max(
      24,
      Math.round((textLayer.textData.boxWidth ?? 0) * ((pointerState.startLayerWidth + 30) / pointerState.startLayerWidth)),
    );
    expect(draft.textBoxWidth).toBe(firstExpectedWidth);

    controller.handlePointerMove({ clientX: startX + 60, clientY: startY } as PointerEvent);

    const secondExpectedWidth = Math.max(
      24,
      Math.round((textLayer.textData.boxWidth ?? 0) * ((pointerState.startLayerWidth + 60) / pointerState.startLayerWidth)),
    );
    expect(draft.textBoxWidth).toBe(secondExpectedWidth);
  });

  it("uses text tool vertical handles to resize the text frame height", () => {
    const { controller, draft, textLayer, pointerState, scheduleCanvasRender, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    textLayer.textData.boxHeight = 72;
    draft.textBoxHeight = 72;
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width / 2;
    const startY = textLayer.y + textLayer.canvas.height;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX, clientY: startY + 30 } as PointerEvent);

    expect(pointerState.transformHandle).toBe("s");
    expect(draft.textBoxHeight).toBeGreaterThan(72);
    expect(draft.previewOverride?.height).toBeGreaterThan(textLayer.canvas.height);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
  });

  it("preserves the current draft height when resizing text layout width", () => {
    const { controller, draft, textLayer, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    textLayer.textData.boxHeight = 72;
    draft.textBoxHeight = 96;
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width;
    const startY = textLayer.y + textLayer.canvas.height / 2;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 60, clientY: startY } as PointerEvent);

    expect(draft.textBoxHeight).toBe(96);
    expect(draft.previewOverride?.height).toBeGreaterThanOrEqual(96);
  });

  it("anchors text-layout height resize math to the gesture start across repeated pointer moves", () => {
    const { controller, draft, textLayer, pointerState, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    textLayer.textData.boxHeight = 72;
    draft.textBoxHeight = 72;
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width / 2;
    const startY = textLayer.y + textLayer.canvas.height;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX, clientY: startY + 20 } as PointerEvent);

    const firstExpectedHeight = Math.max(
      24,
      Math.round(72 * ((pointerState.startLayerHeight + 20) / pointerState.startLayerHeight)),
    );
    expect(draft.textBoxHeight).toBe(firstExpectedHeight);

    controller.handlePointerMove({ clientX: startX, clientY: startY + 40 } as PointerEvent);

    const secondExpectedHeight = Math.max(
      24,
      Math.round(72 * ((pointerState.startLayerHeight + 40) / pointerState.startLayerHeight)),
    );
    expect(draft.textBoxHeight).toBe(secondExpectedHeight);
  });

  it("preserves the current draft width when resizing text layout height", () => {
    const { controller, draft, textLayer, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    draft.textBoxWidth = 200;
    textLayer.textData.boxHeight = 72;
    draft.textBoxHeight = 72;
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width / 2;
    const startY = textLayer.y + textLayer.canvas.height;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX, clientY: startY + 30 } as PointerEvent);

    expect(draft.textBoxWidth).toBe(200);
    expect(draft.previewOverride?.width).toBe(200);
  });

  it("uses text tool corner handles to resize text frame width and height together", () => {
    const { controller, draft, textLayer, pointerState, scheduleCanvasRender, setActiveTool } = createTextTransformControllerFixture();
    draft.intent = "text-layout";
    textLayer.textData.boxHeight = 72;
    draft.textBoxHeight = 72;
    setActiveTool("text");
    const startX = textLayer.x + textLayer.canvas.width;
    const startY = textLayer.y + textLayer.canvas.height;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 60, clientY: startY + 30 } as PointerEvent);

    expect(pointerState.transformHandle).toBe("se");
    expect(draft.textBoxWidth).toBeGreaterThan(textLayer.textData.boxWidth ?? 0);
    expect(draft.textBoxHeight).toBeGreaterThan(72);
    expect(draft.previewOverride?.width).toBeGreaterThan(textLayer.canvas.width);
    expect(draft.previewOverride?.height).toBeGreaterThan(textLayer.canvas.height);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
  });

  it("does not create a new text layer or dismiss the draft when clicking away while editing text", () => {
    const { controller, pointerState, createTextLayerSpy, cancelTransformDraft } = createTextToolControllerFixture({ isTextEditingActive: true });

    controller.handlePointerDown({ clientX: 250, clientY: 180, button: 0 } as PointerEvent);

    expect(createTextLayerSpy).not.toHaveBeenCalled();
    expect(cancelTransformDraft).not.toHaveBeenCalled();
    expect(pointerState.mode).toBe("none");
  });

  it("dismisses the text-layout transform when clicking away from selected text in text tool mode", () => {
    const { controller, pointerState, createTextLayerSpy, cancelTransformDraft } = createTextToolControllerFixture({ selectedTextLayer: true });

    controller.handlePointerDown({ clientX: 250, clientY: 180, button: 0 } as PointerEvent);

    expect(createTextLayerSpy).not.toHaveBeenCalled();
    expect(cancelTransformDraft).toHaveBeenCalledWith(false);
    expect(pointerState.mode).toBe("none");
  });

  it("creates a new text layer on a second empty-canvas click after dismissing text-layout", () => {
    const draftRef = { current: null as any | null };
    const { controller, pointerState, createTextLayerSpy, cancelTransformDraft, selectedLayer } = createTextToolControllerFixture({
      selectedTextLayer: true,
      draftRef,
    });
    cancelTransformDraft.mockImplementation(() => {
      draftRef.current = null;
    });
    const clickX = Math.max(0, selectedLayer.x - 20);
    const clickY = Math.max(0, selectedLayer.y - 20);

    controller.handlePointerDown({ clientX: clickX, clientY: clickY, button: 0 } as PointerEvent);
    expect(createTextLayerSpy).not.toHaveBeenCalled();
    expect(cancelTransformDraft).toHaveBeenCalledWith(false);
    expect(pointerState.mode).toBe("none");

    controller.handlePointerDown({ clientX: clickX, clientY: clickY, button: 0 } as PointerEvent);

    expect(createTextLayerSpy).toHaveBeenCalledWith(clickX, clickY);
    expect(pointerState.mode).toBe("create-layer");
  });

  it("still creates a new text layer when the text tool is idle", () => {
    const { controller, pointerState, createTextLayerSpy } = createTextToolControllerFixture();

    controller.handlePointerDown({ clientX: 250, clientY: 180, button: 0 } as PointerEvent);

    expect(createTextLayerSpy).toHaveBeenCalledWith(250, 180);
    expect(pointerState.mode).toBe("create-layer");
  });

  it("uses transform tool side handles to skew text layers instead of resizing the text box", () => {
    const { controller, draft, textLayer, pointerState, scheduleCanvasRender } = createTextTransformControllerFixture();
    const startX = textLayer.x + textLayer.canvas.width;
    const startY = textLayer.y + textLayer.canvas.height / 2;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 40, clientY: startY + 20 } as PointerEvent);

    expect(pointerState.transformHandle).toBe("e");
    expect(draft.textBoxWidth).toBe(textLayer.textData.boxWidth);
    expect(draft.previewOverride).toBeNull();
    expect(draft.skewYDeg).not.toBe(0);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
  });

  it("uses shape side handles to resize one axis instead of skewing", () => {
    const { controller, draft, shapeLayer, pointerState, scheduleCanvasRender } = createShapeTransformControllerFixture();
    const startX = shapeLayer.x + shapeLayer.canvas.width;
    const startY = shapeLayer.y + shapeLayer.canvas.height / 2;

    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 40, clientY: startY } as PointerEvent);

    expect(pointerState.transformHandle).toBe("e");
    expect(draft.scaleX).toBeGreaterThan(1);
    expect(draft.scaleY).toBe(1);
    expect(draft.skewXDeg).toBe(0);
    expect(draft.skewYDeg).toBe(0);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
  });

  it("hit-tests visible shape pixels within the rendered bounds", () => {
    const shapeLayer = createShapeLayer("Badge", "rectangle", 20, 30);

    expect(hitTestShapeLayer(shapeLayer, shapeLayer.x + 4, shapeLayer.y + 4)).toBe(true);
    expect(hitTestShapeLayer(shapeLayer, shapeLayer.x - 1, shapeLayer.y - 1)).toBe(false);
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

  it("commits fill as a single undoable history step", () => {
    const { controller, doc, pointerState, showToast, renderEditorState } = createPointerControllerFixture({ activeTool: "fill" });
    doc.selectionRect = { x: 2, y: 3, width: 10, height: 8 };
    doc.redoStack = ["redo-snapshot"];
    vi.mocked(applyFillToSelection).mockReturnValue({ ok: true, message: "Filled selection" });

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);

    expect(pointerState.mode).toBe("none");
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toHaveLength(0);
    expect(doc.history[0]).toBe("Filled selection");
    expect(showToast).toHaveBeenCalledWith("Filled selection", "success");
    expect(renderEditorState).toHaveBeenCalledTimes(1);
  });

  it("commits healing strokes as a single undoable history step", () => {
    const { controller, doc, pointerState, renderEditorState } = createPointerControllerFixture({ activeTool: "healing-brush" });

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 16, clientY: 20 } as PointerEvent);
    controller.handlePointerUp();

    expect(pointerState.mode).toBe("none");
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Healed pixels");
    expect(renderEditorState).toHaveBeenCalledTimes(2);
  });

  it("creates a fresh healing session for each drag stroke", () => {
    const healingSpy = vi.spyOn(healingModule, "healingStroke");
    const { controller } = createPointerControllerFixture({ activeTool: "healing-brush" });

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 16, clientY: 20 } as PointerEvent);
    controller.handlePointerUp();
    controller.handlePointerDown({ clientX: 20, clientY: 22, button: 0 } as PointerEvent);

    expect(healingSpy).toHaveBeenCalledTimes(3);
    const firstSession = healingSpy.mock.calls[0]?.[2] ?? null;
    const moveSession = healingSpy.mock.calls[1]?.[2] ?? null;
    const secondStrokeSession = healingSpy.mock.calls[2]?.[2] ?? null;
    expect(firstSession).not.toBeNull();
    expect(moveSession).toBe(firstSession);
    expect(secondStrokeSession).not.toBe(firstSession);
  });

  it("uses the lightweight canvas path while panning", () => {
    const { controller, doc, pointerState, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({ activeTool: "move" });

    controller.handlePointerDown({ clientX: 10, clientY: 12, button: 1 } as PointerEvent);
    controller.handlePointerMove({ clientX: 26, clientY: 32 } as PointerEvent);

    expect(pointerState.mode).toBe("pan");
    expect(doc.panX).toBe(16);
    expect(doc.panY).toBe(20);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderEditorState).not.toHaveBeenCalled();
  });

  it("uses the lightweight canvas path during marquee preview drags and full render on commit", () => {
    const { controller, renderEditorState, scheduleCanvasRender } = createMarqueeController({ modifiers: { rotate: false, perfect: false } });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 50 } as PointerEvent);

    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(scheduleCanvasRender).toHaveBeenCalledTimes(1);

    controller.handlePointerUp();

    expect(renderEditorState).toHaveBeenCalledTimes(2);
  });

  it("uses the lightweight canvas path during crop preview drags and full render on commit", () => {
    const { controller, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({ activeTool: "crop" });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 50 } as PointerEvent);

    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(scheduleCanvasRender).toHaveBeenCalledTimes(1);

    controller.handlePointerUp();

    expect(renderEditorState).toHaveBeenCalledTimes(2);
  });

  it("uses the lightweight canvas path during move-layer drags and full render on commit", () => {
    const { controller, doc, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({ activeTool: "move" });
    const layer = doc.layers[1]!;

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 45 } as PointerEvent);

    expect(layer.x).toBe(20);
    expect(layer.y).toBe(25);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderEditorState).not.toHaveBeenCalled();

    controller.handlePointerUp();

    expect(renderEditorState).toHaveBeenCalledTimes(1);
  });

  it("uses the lightweight canvas path during lasso preview drags and full render on commit", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    const editorCanvas = document.createElement("canvas");
    const canvasWrap = document.createElement("div");
    const renderEditorState = vi.fn();
    const scheduleCanvasRender = vi.fn();
    const onLassoPoint = vi.fn((x: number, y: number) => {
      doc.selectionPath?.points.push({ x, y });
    });
    const onLassoComplete = vi.fn();
    const pointerState = createPointerState();

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
      getActiveTool: () => "lasso",
      isTextEditingActive: () => false,
      commitTransformDraft: vi.fn(),
      cancelTransformDraft: vi.fn(),
      getSelectionMode: () => "replace",
      getMarqueeShape: () => 4,
      getTransformMode: () => "scale",
      ensureTransformDraft: vi.fn(() => null),
      getTransformDraft: vi.fn(() => null),
      syncTransformInputs: vi.fn(),
      getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      getSpacePressed: () => false,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      snapLayerPosition: (_layer, x, y) => ({ x, y }),
      pointerState,
      renderCanvas: vi.fn(),
      scheduleCanvasRender,
      renderEditorState,
      onColourPicked: vi.fn(),
      getCloneSource: () => null,
      setCloneSource: vi.fn(),
      onLassoPoint,
      onLassoComplete,
      onCreateTextLayer: vi.fn(() => null),
      onCreateShapeLayer: vi.fn(() => null),
      getCustomPaintTarget: () => null,
      getMaskEditTarget: () => null,
      getQuickMaskCanvas: () => null,
      showToast: vi.fn(),
      log: vi.fn(),
      getSelectionMaskTarget: () => null,
    });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 40, clientY: 50 } as PointerEvent);

    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(scheduleCanvasRender).toHaveBeenCalledTimes(1);
    expect(onLassoPoint).toHaveBeenCalledWith(40, 50);

    controller.handlePointerUp();

    expect(renderEditorState).toHaveBeenCalledTimes(2);
    expect(onLassoComplete).toHaveBeenCalledOnce();
  });

  it("uses the scheduled canvas path for quick mask paint pointer moves", () => {
    const quickMaskCanvas = document.createElement("canvas");
    quickMaskCanvas.width = 100;
    quickMaskCanvas.height = 100;
    const { controller, renderCanvas, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({
      activeTool: "brush",
      quickMaskCanvas,
    });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 40 } as PointerEvent);

    expect(renderEditorState).toHaveBeenCalledOnce();
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderCanvas).not.toHaveBeenCalled();
  });

  it("routes brush strokes to a custom paint target instead of the active layer", () => {
    const guideCanvas = document.createElement("canvas");
    guideCanvas.width = 100;
    guideCanvas.height = 100;
    const { controller, doc, renderCanvas, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({
      activeTool: "brush",
      customPaintTarget: {
        canvas: guideCanvas,
        historyMode: "ephemeral",
        paintLabel: "Painted AI mask guide",
        logLabel: "AI mask caster",
      },
    });
    const layer = doc.layers[1]!;

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 40 } as PointerEvent);
    controller.handlePointerUp();

    expect(renderEditorState).toHaveBeenCalledTimes(2);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderCanvas).not.toHaveBeenCalled();
    expect(readPixel(guideCanvas, 10, 20).a).toBeGreaterThan(0);
    expect(readPixel(layer.canvas, 10, 20).a).toBe(0);
  });

  it("clears the opposite guide channel when painting a custom shadow guide stroke", () => {
    const casterCanvas = document.createElement("canvas");
    casterCanvas.width = 100;
    casterCanvas.height = 100;
    const surfaceCanvas = document.createElement("canvas");
    surfaceCanvas.width = 100;
    surfaceCanvas.height = 100;
    setPixel(surfaceCanvas, 10, 20, { r: 255, g: 255, b: 255, a: 255 });

    const { controller } = createPointerControllerFixture({
      activeTool: "brush",
      customPaintTarget: {
        canvas: casterCanvas,
        exclusiveCanvas: surfaceCanvas,
        historyMode: "ephemeral",
        paintLabel: "Painted AI mask guide",
        logLabel: "AI mask caster",
      },
    });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerUp();

    expect(readPixel(casterCanvas, 10, 20).a).toBeGreaterThan(0);
    expect(readPixel(surfaceCanvas, 10, 20).a).toBe(0);
  });

  it("uses the scheduled canvas path for layer mask paint pointer moves", () => {
    const { controller, doc, renderCanvas, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({
      activeTool: "brush",
      maskEditTarget: "active-layer",
    });
    const layer = doc.layers[1]!;
    layer.mask = document.createElement("canvas");
    layer.mask.width = 100;
    layer.mask.height = 100;

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 40 } as PointerEvent);

    expect(renderEditorState).toHaveBeenCalledOnce();
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderCanvas).not.toHaveBeenCalled();
  });

  it("uses the scheduled canvas path for raster paint pointer moves", () => {
    const { controller, renderCanvas, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({ activeTool: "brush" });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: 30, clientY: 40 } as PointerEvent);

    expect(renderEditorState).toHaveBeenCalledOnce();
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderCanvas).not.toHaveBeenCalled();
  });

  it("uses the scheduled canvas path during shape creation drags and full render on commit", () => {
    const { controller, doc, pointerState, renderEditorState, scheduleCanvasRender } = createPointerControllerFixture({
      activeTool: "shape",
      onCreateShapeLayer: (x, y) => {
        const created = createShapeLayer("Rectangle 1", "rectangle", x, y);
        doc.layers.push(created);
        doc.activeLayerId = created.id;
        return created;
      },
    });

    controller.handlePointerDown({ clientX: 10, clientY: 20, button: 0 } as PointerEvent);

    expect(pointerState.mode).toBe("create-layer");
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(scheduleCanvasRender).not.toHaveBeenCalled();

    controller.handlePointerMove({ clientX: 40, clientY: 55 } as PointerEvent);

    const created = doc.layers.find((layer) => layer.id === pointerState.creationLayerId);
    expect(created?.type).toBe("shape");
    if (!created || created.type !== "shape") {
      throw new Error("Expected created shape layer");
    }
    expect(created.x).toBe(10);
    expect(created.y).toBe(20);
    expect(created.shapeData.width).toBe(30);
    expect(created.shapeData.height).toBe(35);
    expect(scheduleCanvasRender).toHaveBeenCalledOnce();
    expect(renderEditorState).toHaveBeenCalledTimes(1);

    controller.handlePointerUp();

    expect(renderEditorState).toHaveBeenCalledTimes(2);
    expect(doc.history[0]).toBe("Created shape layer");
  });

  it("reselects a clicked shape in move mode and moves it in the same gesture", () => {
    const doc = makeNewDocument("Doc", 240, 180, 100, "transparent");
    const editorCanvas = document.createElement("canvas");
    const canvasWrap = document.createElement("div");
    const pointerState = createPointerState();
    const otherLayer = doc.layers[1]!;
    const shapeLayer = createShapeLayer("Badge", "rectangle", 30, 40);
    doc.layers.push(shapeLayer);
    doc.activeLayerId = otherLayer.id;

    vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 240,
      height: 180,
      right: 240,
      bottom: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const controller = canvasPointerModule.createCanvasPointerController({
      editorCanvas,
      canvasWrap,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? null,
      getActiveTool: () => "move",
      isTextEditingActive: () => false,
      commitTransformDraft: vi.fn(),
      cancelTransformDraft: vi.fn(),
      getSelectionMode: () => "replace",
      getMarqueeShape: () => 4,
      getTransformMode: () => "scale",
      ensureTransformDraft: vi.fn(() => null),
      getTransformDraft: vi.fn(() => null),
      syncTransformInputs: vi.fn(),
      getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      getSpacePressed: () => false,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      snapLayerPosition: (_layer, x, y) => ({ x, y }),
      pointerState,
      renderCanvas: vi.fn(),
      scheduleCanvasRender: vi.fn(),
      renderEditorState: vi.fn(),
      onColourPicked: vi.fn(),
      getCloneSource: () => null,
      setCloneSource: vi.fn(),
      onLassoPoint: vi.fn(),
      onLassoComplete: vi.fn(),
      onCreateTextLayer: vi.fn(() => null),
      onCreateShapeLayer: vi.fn(() => null),
      getCustomPaintTarget: () => null,
      getMaskEditTarget: () => null,
      getQuickMaskCanvas: () => null,
      showToast: vi.fn(),
      log: vi.fn(),
      getSelectionMaskTarget: () => null,
    });

    const startX = shapeLayer.x + 10;
    const startY = shapeLayer.y + 10;
    controller.handlePointerDown({ clientX: startX, clientY: startY, button: 0 } as PointerEvent);
    controller.handlePointerMove({ clientX: startX + 25, clientY: startY + 15 } as PointerEvent);
    controller.handlePointerUp();

    expect(doc.activeLayerId).toBe(shapeLayer.id);
    expect(shapeLayer.x).toBe(55);
    expect(shapeLayer.y).toBe(55);
    expect(doc.history[0]).toBe("Moved active layer");
  });

  it.each<[("raster" | "text" | "shape" | "smart-object"), () => Layer]>([
    ["raster", () => {
      const layer = makeNewDocument("Hit raster", 80, 80, 100, "transparent").layers[1]!;
      if (layer.type !== "raster") {
        throw new Error("Expected raster layer");
      }
      layer.name = "Picked raster";
      layer.x = 24;
      layer.y = 18;
      return layer;
    }],
    ["text", () => {
      const layer = createTextLayer("Picked text", 24, 18, { text: "VG" });
      return layer;
    }],
    ["shape", () => createShapeLayer("Picked shape", "rectangle", 24, 18)],
    ["smart-object", () => {
      const source = document.createElement("canvas");
      source.width = 24;
      source.height = 24;
      setPixel(source, 2, 2, { r: 255, g: 255, b: 255, a: 255 });
      return createSmartObjectLayer("Picked smart", source, 24, 18);
    }],
  ])("alt-click selects the topmost non-active %s layer by canvas hit", (_label, buildLayer) => {
    const { controller, doc, pointerState, renderEditorState } = createPointerControllerFixture({ activeTool: "move" });
    const targetLayer = buildLayer();
    doc.layers.push(targetLayer);
    const hitPoint = addOpaquePixel(targetLayer);

    controller.handlePointerDown({ ...hitPoint, button: 0, altKey: true } as PointerEvent);

    expect(doc.activeLayerId).toBe(targetLayer.id);
    expect(pointerState.mode).toBe("none");
    expect(renderEditorState).toHaveBeenCalledOnce();
  });

  it("clone-stamp Alt-click still sets the clone source instead of selecting a hit layer", () => {
    const { doc } = createPointerControllerFixture({ activeTool: "clone-stamp" });
    const setCloneSource = vi.fn();
    const activeLayer = doc.layers[1]!;
    const otherLayer = makeNewDocument("Other", 80, 80, 100, "transparent").layers[1]!;
    if (activeLayer.type !== "raster" || otherLayer.type !== "raster") {
      throw new Error("Expected raster layers");
    }
    otherLayer.name = "Top raster";
    otherLayer.x = 30;
    otherLayer.y = 22;
    doc.layers.push(otherLayer);
    const hitPoint = addOpaquePixel(otherLayer);

    const editorCanvas = document.createElement("canvas");
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

    const controllerWithCloneSource = canvasPointerModule.createCanvasPointerController({
      editorCanvas,
      canvasWrap: document.createElement("div"),
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? null,
      getActiveTool: () => "clone-stamp",
      isTextEditingActive: () => false,
      commitTransformDraft: vi.fn(),
      cancelTransformDraft: vi.fn(),
      getSelectionMode: () => "replace",
      getMarqueeShape: () => 4,
      getTransformMode: () => "scale",
      ensureTransformDraft: vi.fn(() => null),
      getTransformDraft: vi.fn(() => null),
      syncTransformInputs: vi.fn(),
      getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      getSpacePressed: () => false,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      snapLayerPosition: (_layer, x, y) => ({ x, y }),
      pointerState: createPointerState(),
      renderCanvas: vi.fn(),
      scheduleCanvasRender: vi.fn(),
      renderEditorState: vi.fn(),
      onColourPicked: vi.fn(),
      getCloneSource: () => null,
      setCloneSource,
      onLassoPoint: vi.fn(),
      onLassoComplete: vi.fn(),
      onCreateTextLayer: vi.fn(() => null),
      onCreateShapeLayer: vi.fn(() => null),
      getCustomPaintTarget: () => null,
      getMaskEditTarget: () => null,
      getQuickMaskCanvas: () => null,
      showToast: vi.fn(),
      log: vi.fn(),
      getSelectionMaskTarget: () => null,
    });

    controllerWithCloneSource.handlePointerDown({ ...hitPoint, button: 0, altKey: true } as PointerEvent);

    expect(setCloneSource).toHaveBeenCalledWith({ x: hitPoint.clientX, y: hitPoint.clientY });
    expect(doc.activeLayerId).toBe(activeLayer.id);
  });

  it("keeps normal move clicks unchanged for non-shape layers when Alt is not held", () => {
    const { controller, doc, pointerState, renderEditorState } = createPointerControllerFixture({ activeTool: "move" });
    const otherLayer = makeNewDocument("Other", 80, 80, 100, "transparent").layers[1]!;
    if (otherLayer.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    otherLayer.name = "Plain click raster";
    otherLayer.x = 30;
    otherLayer.y = 22;
    doc.layers.push(otherLayer);
    const hitPoint = addOpaquePixel(otherLayer);

    controller.handlePointerDown({ ...hitPoint, button: 0 } as PointerEvent);

    expect(doc.activeLayerId).not.toBe(otherLayer.id);
    expect(pointerState.mode).toBe("move-layer");
    expect(renderEditorState).not.toHaveBeenCalled();
  });

  it("does not commit fill when there is no effective selection", () => {
    const { controller, doc, showToast, renderEditorState } = createPointerControllerFixture({ activeTool: "fill" });
    vi.mocked(applyFillToSelection).mockReturnValue({ ok: false, message: "Create a selection before using Fill", variant: "info" });

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);

    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toEqual(["Created blank canvas"]);
    expect(showToast).toHaveBeenCalledWith("Create a selection before using Fill", "info");
    expect(renderEditorState).not.toHaveBeenCalled();
  });

  it("shows a message instead of filling a locked layer", () => {
    const { controller, doc, showToast } = createPointerControllerFixture({ activeTool: "fill" });
    doc.layers[1].locked = true;

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);

    expect(applyFillToSelection).not.toHaveBeenCalled();
    expect(doc.undoStack).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith("Unlock the active layer before filling", "error");
  });

  it("commits a pending transform before switching to gradient workflows", () => {
    const { controller, commitTransformDraft } = createPointerControllerFixture({ activeTool: "gradient", hasTransformDraft: true });

    controller.handlePointerDown({ clientX: 12, clientY: 18, button: 0 } as PointerEvent);

    expect(commitTransformDraft).toHaveBeenCalledOnce();
  });

  it("erases normally with no active selection", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    setPixel(layer.canvas, 0, 0, "#FF0000");
    setPixel(layer.canvas, 1, 1, "#00FF00");

    canvasPointerModule.drawStroke(layer, 0, 0, 0, 0, "eraser", 1, 1, "#000000");

    expect(readPixel(layer.canvas, 0, 0).a).toBe(0);
    expect(readPixel(layer.canvas, 1, 1).a).toBe(0);
  });

  it("keeps erasing constrained to the selection mask", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    setPixel(selectionMask, 1, 1, "#FFFFFF");

    setPixel(layer.canvas, 1, 1, "#FF0000");
    setPixel(layer.canvas, 3, 3, "#00FF00");

    canvasPointerModule.drawStroke(
      layer,
      0,
      0,
      0,
      0,
      "eraser",
      1,
      1,
      "#000000",
      { x: 1, y: 1, width: 1, height: 1 },
      false,
      "rect",
      null,
      selectionMask,
    );

    expect(readPixel(layer.canvas, 1, 1).a).toBe(0);
    expect(readPixel(layer.canvas, 3, 3)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  it("keeps brush painting constrained to the selection mask", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    setPixel(selectionMask, 2, 2, "#FFFFFF");

    canvasPointerModule.drawStroke(
      layer,
      0,
      0,
      0,
      0,
      "brush",
      1,
      1,
      "#3366FF",
      { x: 2, y: 2, width: 1, height: 1 },
      false,
      "rect",
      null,
      selectionMask,
    );

    expect(readPixel(layer.canvas, 2, 2)).toEqual({ r: 51, g: 102, b: 255, a: 255 });
    expect(readPixel(layer.canvas, 0, 0).a).toBe(0);
  });
});
