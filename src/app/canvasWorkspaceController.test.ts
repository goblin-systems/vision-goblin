import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { createAdjustmentLayer } from "../editor/documents";
import { renderCanvas as renderCanvasView } from "../editor/render";
import { getDefaultSettings } from "../settings";
import { createCanvasWorkspaceController, findGuideAtPosition, snapLayerPositionForDocument } from "./canvasWorkspaceController";

vi.mock("../editor/render", () => ({
  renderCanvas: vi.fn(),
}));

describe("canvasWorkspaceController helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("snaps a layer edge to the nearest guide", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    doc.guides.push({ id: "g1", orientation: "vertical", position: 80 });
    const layer = doc.layers[0]!;
    layer.canvas.width = 40;
    layer.canvas.height = 20;

    const result = snapLayerPositionForDocument({
      doc,
      layer,
      rawX: 43,
      rawY: 10,
      snapEnabled: true,
      showGrid: false,
      gridSize: 16,
    });

    expect(result.x).toBe(40);
    expect(result.lines).toEqual([{ orientation: "vertical", position: 80 }]);
  });

  it("finds a guide using zoom-scaled hit tolerance", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const guide = { id: "g1", orientation: "horizontal" as const, position: 24 };
    doc.guides.push(guide);

    expect(findGuideAtPosition(doc, 12, 25, { originX: 0, originY: 0, scale: 2 })).toEqual(guide);
    expect(findGuideAtPosition(doc, 12, 28, { originX: 0, originY: 0, scale: 2 })).toBeNull();
  });

  it("coalesces repeated scheduled canvas renders into one frame", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    let hasQueuedFrame = false;
    let queuedFrame: FrameRequestCallback = () => {
      throw new Error("Expected a queued animation frame");
    };
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      hasQueuedFrame = true;
      queuedFrame = callback;
      return 1;
    });
    const settings = { ...getDefaultSettings(), activeTool: "move" as const, snapEnabled: true, showGrid: false, gridSize: 16 };

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => settings,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => ({ brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      adjustBrushSize: vi.fn((delta: number) => 24 + delta),
      getPointerState: () => ({
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [],
      renderShellState: vi.fn(),
      renderEditorState: vi.fn(),
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
    });

    controller.scheduleCanvasRender();
    controller.scheduleCanvasRender();
    controller.scheduleCanvasRender();

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(renderCanvasView).not.toHaveBeenCalled();

    expect(hasQueuedFrame).toBe(true);
    queuedFrame(16);

    expect(renderCanvasView).toHaveBeenCalledTimes(1);
  });

  it("routes wheel zoom through shell and canvas-only updates", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    let hasQueuedFrame = false;
    let queuedFrame: FrameRequestCallback = () => {
      throw new Error("Expected a queued animation frame");
    };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      hasQueuedFrame = true;
      queuedFrame = callback;
      return 1;
    });
    const settings = { ...getDefaultSettings(), activeTool: "move" as const, snapEnabled: true, showGrid: false, gridSize: 16 };
    const renderShellState = vi.fn();
    const renderEditorState = vi.fn();

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => settings,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => ({ brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      adjustBrushSize: vi.fn((delta: number) => 24 + delta),
      getPointerState: () => ({
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [],
      renderShellState,
      renderEditorState,
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
    });

    const readout = document.createElement("button");
    readout.id = "zoom-readout";
    document.body.appendChild(readout);
    controller.bindZoomControls();

    editorCanvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, bubbles: true, cancelable: true }));
    editorCanvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, bubbles: true, cancelable: true }));

    expect(doc.zoom).toBe(120);
    expect(renderShellState).toHaveBeenCalledTimes(2);
    expect(renderEditorState).not.toHaveBeenCalled();
    expect(renderCanvasView).not.toHaveBeenCalled();

    expect(hasQueuedFrame).toBe(true);
    queuedFrame(16);

    expect(renderCanvasView).toHaveBeenCalledTimes(1);
  });

  it("logs and applies degraded interactive rendering for large documents", () => {
    const doc = makeNewDocument("Large", 7000, 4000, 100, "transparent");
    doc.layers.push(createAdjustmentLayer("Levels", { kind: "levels", params: { inputBlack: 0, inputWhite: 255, gamma: 1 } }));
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    const log = vi.fn();

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => ({ ...getDefaultSettings(), activeTool: "move", snapEnabled: true, showGrid: false, gridSize: 16 }),
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => ({ brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      adjustBrushSize: vi.fn((delta: number) => 24 + delta),
      getPointerState: () => ({
        mode: "pan",
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [],
      renderShellState: vi.fn(),
      renderEditorState: vi.fn(),
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log,
    });

    controller.renderCanvas();
    controller.renderCanvas();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Large image degraded interactive render"), "WARN");
    expect(renderCanvasView).toHaveBeenLastCalledWith(expect.objectContaining({
      degradedRendering: expect.objectContaining({
        active: true,
        skipAdjustmentLayers: true,
      }),
    }));
  });

  it("passes ephemeral mask overlays through to the renderer", () => {
    const doc = makeNewDocument("Doc", 120, 80, 100, "transparent");
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = 120;
    overlayCanvas.height = 80;

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => ({ ...getDefaultSettings(), activeTool: "brush", snapEnabled: true, showGrid: false, gridSize: 16 }),
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => ({ brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      adjustBrushSize: vi.fn((delta: number) => 24 + delta),
      getPointerState: () => ({
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [{
        canvas: overlayCanvas,
        color: "rgba(255, 0, 0, 0.3)",
        outlineColor: "rgba(255, 255, 255, 1)",
        active: true,
      }],
      renderShellState: vi.fn(),
      renderEditorState: vi.fn(),
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
    });

    controller.renderCanvas();

    expect(renderCanvasView).toHaveBeenLastCalledWith(expect.objectContaining({
      maskOverlays: [expect.objectContaining({
        canvas: overlayCanvas,
        active: true,
      })],
    }));
  });

  it("uses Alt+wheel to resize the brush for smudge instead of zooming", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    const settings = { ...getDefaultSettings(), activeTool: "smudge" as const, snapEnabled: true, showGrid: false, gridSize: 16 };
    const adjustBrushSize = vi.fn((delta: number) => 24 + delta);
    const renderShellState = vi.fn();

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => settings,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => ({ brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      adjustBrushSize,
      getPointerState: () => ({
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [],
      renderShellState,
      renderEditorState: vi.fn(),
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
    });

    const readout = document.createElement("button");
    readout.id = "zoom-readout";
    document.body.appendChild(readout);
    controller.bindZoomControls();

    const event = new WheelEvent("wheel", { deltaY: -10, altKey: true, bubbles: true, cancelable: true });
    editorCanvas.dispatchEvent(event);

    expect(adjustBrushSize).toHaveBeenCalledWith(1);
    expect(doc.zoom).toBe(100);
    expect(renderShellState).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    readout.remove();
  });

  it("keeps zooming on wheel when Alt is not pressed or the tool is not paint-like", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    const settings = { ...getDefaultSettings(), activeTool: "move" as const, snapEnabled: true, showGrid: false, gridSize: 16 };
    const adjustBrushSize = vi.fn();
    const renderShellState = vi.fn();

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => settings,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => ({ brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 }),
      adjustBrushSize,
      getPointerState: () => ({
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [],
      renderShellState,
      renderEditorState: vi.fn(),
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
    });

    const readout = document.createElement("button");
    readout.id = "zoom-readout";
    document.body.appendChild(readout);
    controller.bindZoomControls();

    editorCanvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, bubbles: true, cancelable: true }));
    editorCanvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, altKey: true, bubbles: true, cancelable: true }));

    expect(doc.zoom).toBe(120);
    expect(adjustBrushSize).not.toHaveBeenCalled();
    expect(renderShellState).toHaveBeenCalledTimes(2);

    readout.remove();
  });

  it("shows a brush cursor ring with the scaled brush size for smudge", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const canvasWrap = document.createElement("div");
    const editorCanvas = document.createElement("canvas");
    canvasWrap.appendChild(editorCanvas);
    document.body.appendChild(canvasWrap);
    let activeTool: ReturnType<typeof getDefaultSettings>["activeTool"] = "smudge";
    const settings = { ...getDefaultSettings(), snapEnabled: true, showGrid: false, gridSize: 16 };
    const brushState = { brushSize: 24, brushOpacity: 1, activeColour: "#000000", healingSampleSpread: 2.4, healingBlend: 0.8 };

    vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 310,
      bottom: 220,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect);

    const controller = createCanvasWorkspaceController({
      canvasWrap,
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => ({ ...settings, activeTool }),
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
      getBrushState: () => brushState,
      adjustBrushSize: vi.fn((delta: number) => brushState.brushSize + delta),
      getPointerState: () => ({
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
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
      getMaskOverlays: () => [],
      renderShellState: vi.fn(),
      renderEditorState: vi.fn(),
      updateMarqueeModeFromModifiers: vi.fn(),
      captureSelectionMode: vi.fn(),
      canvasPointer: {
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
      },
      resetView: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
    });

    controller.bindCanvasInteractions();
    editorCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 70, bubbles: true }));

    const paintCursor = canvasWrap.querySelector<HTMLElement>(".paint-cursor-ring");
    expect(paintCursor?.hidden).toBe(false);
    expect(paintCursor?.style.width).toBe("24px");
    expect(paintCursor?.style.height).toBe("24px");
    expect(editorCanvas.style.cursor).toBe("none");

    brushState.brushSize = 40;
    controller.renderCanvas();
    expect(paintCursor?.style.width).toBe("40px");

    activeTool = "move";
    controller.renderCanvas();
    expect(paintCursor?.hidden).toBe(true);
    expect(editorCanvas.style.cursor).toBe("");

    canvasWrap.remove();
  });
});
