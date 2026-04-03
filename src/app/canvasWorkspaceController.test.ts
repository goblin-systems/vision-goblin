import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
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
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => settings,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
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
        cloneOffsetX: 0,
        cloneOffsetY: 0,
        creationLayerId: null,
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
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
      editorCanvas,
      getEditorContext: () => editorCanvas.getContext("2d")!,
      getSettings: () => settings,
      getActiveDocument: () => doc,
      getActiveLayer: (activeDoc) => activeDoc.layers[0] ?? null,
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
        cloneOffsetX: 0,
        cloneOffsetY: 0,
        creationLayerId: null,
      }),
      getTransformDraft: () => null,
      getEffectiveMarqueeMode: () => "replace",
      getMarqueeSides: () => 4,
      getMarqueeModifiers: () => ({ rotate: false, perfect: false }),
      getQuickMaskOverlay: () => null,
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
});
