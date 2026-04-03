import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import * as canvasPointerModule from "./canvasPointer";
import { createShapeLayer } from "./documents";
import { applyFillToSelection } from "./fill";
import { combineMasks, createMaskCanvas, defaultPolygonRotation, maskBoundingRect, maskContainsRect, rasterizeRectToMask } from "./selection";
import type { PointerState } from "./types";

function parseHexColour(colour: string) {
  const hex = colour.startsWith("#") ? colour.slice(1) : colour;
  const expanded = hex.length === 3 ? hex.split("").map((value) => `${value}${value}`).join("") : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: expanded.length >= 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
  };
}

function installPixelCanvasMock() {
  const originalCreateElement = document.createElement.bind(document);

  const attachPixelContext = (canvas: HTMLCanvasElement) => {
    let width = 0;
    let height = 0;
    let pixels = new Uint8ClampedArray();

    const ensureSize = () => {
      if (width === canvas.width && height === canvas.height) {
        return;
      }
      width = canvas.width;
      height = canvas.height;
      pixels = new Uint8ClampedArray(width * height * 4);
    };

    const paintPixel = (x: number, y: number, rgba: { r: number; g: number; b: number; a: number }) => {
      ensureSize();
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }
      const index = (y * width + x) * 4;
      pixels[index] = rgba.r;
      pixels[index + 1] = rgba.g;
      pixels[index + 2] = rgba.b;
      pixels[index + 3] = rgba.a;
    };

    const readPixel = (x: number, y: number) => {
      ensureSize();
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const index = (y * width + x) * 4;
      return {
        r: pixels[index],
        g: pixels[index + 1],
        b: pixels[index + 2],
        a: pixels[index + 3],
      };
    };

    const applySourceOver = (targetX: number, targetY: number, source: { r: number; g: number; b: number; a: number }) => {
      if (source.a === 0) {
        return;
      }
      paintPixel(targetX, targetY, source);
    };

    const ctx = {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
      lineCap: "round",
      lineJoin: "round",
      lineWidth: 1,
      clearRect: (x: number, y: number, w: number, h: number) => {
        ensureSize();
        for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) {
          for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
            paintPixel(px, py, { r: 0, g: 0, b: 0, a: 0 });
          }
        }
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        ensureSize();
        const rgba = parseHexColour(String(ctx.fillStyle));
        for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) {
          for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
            applySourceOver(px, py, rgba);
          }
        }
      },
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      roundRect: () => undefined,
      fill: () => undefined,
      stroke: () => {
        ensureSize();
        const rgba = parseHexColour(String(ctx.strokeStyle));
        for (let py = 0; py < height; py++) {
          for (let px = 0; px < width; px++) {
            if (ctx.globalCompositeOperation === "destination-out") {
              paintPixel(px, py, { r: 0, g: 0, b: 0, a: 0 });
            } else {
              applySourceOver(px, py, rgba);
            }
          }
        }
      },
      save: () => undefined,
      restore: () => undefined,
      getImageData: (x: number, y: number, w: number, h: number) => {
        ensureSize();
        const data = new Uint8ClampedArray(w * h * 4);
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const source = readPixel(x + px, y + py);
            const index = (py * w + px) * 4;
            data[index] = source.r;
            data[index + 1] = source.g;
            data[index + 2] = source.b;
            data[index + 3] = source.a;
          }
        }
        return new ImageData(data, w, h);
      },
      drawImage: (sourceCanvas: HTMLCanvasElement, dx: number, dy: number) => {
        ensureSize();
        const sourceGetPixel = (sourceCanvas as HTMLCanvasElement & { __getPixel?: (x: number, y: number) => { r: number; g: number; b: number; a: number } }).__getPixel;
        if (!sourceGetPixel) {
          return;
        }
        for (let py = 0; py < sourceCanvas.height; py++) {
          for (let px = 0; px < sourceCanvas.width; px++) {
            const source = sourceGetPixel(px, py);
            const targetX = dx + px;
            const targetY = dy + py;
            if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
              continue;
            }
            if (ctx.globalCompositeOperation === "destination-in") {
              if (source.a === 0) {
                paintPixel(targetX, targetY, { r: 0, g: 0, b: 0, a: 0 });
              }
              continue;
            }
            if (ctx.globalCompositeOperation === "destination-out") {
              if (source.a > 0) {
                paintPixel(targetX, targetY, { r: 0, g: 0, b: 0, a: 0 });
              }
              continue;
            }
            applySourceOver(targetX, targetY, source);
          }
        }
      },
    } as unknown as CanvasRenderingContext2D & {
      fillStyle: string;
      strokeStyle: string;
      globalCompositeOperation: GlobalCompositeOperation;
      globalAlpha: number;
      lineCap: CanvasLineCap;
      lineJoin: CanvasLineJoin;
      lineWidth: number;
    };

    Object.defineProperty(canvas, "getContext", {
      value: vi.fn((kind: string) => (kind === "2d" ? ctx : null)),
      configurable: true,
    });
    Object.defineProperty(canvas, "__getPixel", {
      value: (x: number, y: number) => readPixel(x, y),
      configurable: true,
    });
    Object.defineProperty(canvas, "__setPixel", {
      value: (x: number, y: number, rgba: { r: number; g: number; b: number; a: number }) => paintPixel(x, y, rgba),
      configurable: true,
    });
  };

  vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === "canvas") {
      attachPixelContext(element as HTMLCanvasElement);
    }
    return element;
  }) as typeof document.createElement);
}

function setPixel(canvas: HTMLCanvasElement, x: number, y: number, colour: string) {
  const rgba = parseHexColour(colour);
  (canvas as HTMLCanvasElement & { __setPixel: (px: number, py: number, value: { r: number; g: number; b: number; a: number }) => void }).__setPixel(x, y, rgba);
}

function readPixel(canvas: HTMLCanvasElement, x: number, y: number) {
  return (canvas as HTMLCanvasElement & { __getPixel: (px: number, py: number) => { r: number; g: number; b: number; a: number } }).__getPixel(x, y);
}

vi.mock("./fill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fill")>();
  return {
    ...actual,
    applyFillToSelection: vi.fn(actual.applyFillToSelection),
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
    scheduleCanvasRender,
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
    showToast: vi.fn(),
    log: vi.fn(),
  });

  return { controller, doc, renderEditorState, scheduleCanvasRender };
}

function createPointerControllerFixture(options?: {
  activeTool?: string;
  hasTransformDraft?: boolean;
  quickMaskCanvas?: HTMLCanvasElement | null;
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
    scheduleCanvasRender,
    renderEditorState,
    onColourPicked: vi.fn(),
    getCloneSource: () => null,
    setCloneSource: vi.fn(),
    onLassoPoint: vi.fn(),
    onLassoComplete: vi.fn(),
    onCreateTextLayer: vi.fn(() => null),
    onCreateShapeLayer: vi.fn((x: number, y: number) => options?.onCreateShapeLayer?.(x, y) ?? null),
    getMaskEditTarget: () => options?.maskEditTarget === "active-layer" ? editableLayer.id : options?.maskEditTarget ?? null,
    getQuickMaskCanvas: () => options?.quickMaskCanvas ?? null,
    showToast,
    log: vi.fn(),
  });

  return { controller, doc, pointerState, commitTransformDraft, renderEditorState, scheduleCanvasRender, renderCanvas, showToast };
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
    expect(renderEditorState).toHaveBeenCalledOnce();
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

    expect(renderEditorState).toHaveBeenCalledOnce();
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
      commitTransformDraft: vi.fn(),
      getSelectionMode: () => "replace",
      getMarqueeShape: () => 4,
      getTransformMode: () => "scale",
      ensureTransformDraft: vi.fn(() => null),
      getTransformDraft: vi.fn(() => null),
      syncTransformInputs: vi.fn(),
      getBrushState: () => ({ brushSize: 1, brushOpacity: 1, activeColour: "#000000" }),
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
      getMaskEditTarget: () => null,
      getQuickMaskCanvas: () => null,
      showToast: vi.fn(),
      log: vi.fn(),
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
