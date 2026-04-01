import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import {
  commitDestructiveAdjustment,
  getAdjustmentSessionError,
  restoreDestructiveAdjustmentPreview,
} from "./adjustmentModalController";

describe("adjustmentModalController helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports session guard errors for missing or locked targets", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId) ?? null;

    expect(getAdjustmentSessionError(null, null)).toBe("No document open");
    expect(getAdjustmentSessionError(doc, null)).toBe("No active layer");
    expect(getAdjustmentSessionError(doc, layer)).toBeNull();

    if (layer) {
      layer.locked = true;
    }

    expect(getAdjustmentSessionError(doc, layer)).toBe("Layer is locked");
  });

  it("restores the source canvas on cancel", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const renderCanvas = vi.fn();
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;
    const context = layer.canvas.getContext("2d");

    restoreDestructiveAdjustmentPreview({ doc, layer, sourceCanvas }, renderCanvas);

    expect(context?.clearRect).toHaveBeenCalled();
    expect(context?.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0);
    expect(renderCanvas).toHaveBeenCalledTimes(1);
  });

  it("commits previewed adjustments into history and dirty state", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;
    doc.redoStack = ["redo"];

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Levels",
      successMessage: "Levels applied",
      renderEditorState,
      showToast,
    });

    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toEqual([]);
    expect(doc.dirty).toBe(true);
    expect(doc.history[0]).toBe("Levels");
    expect(context?.putImageData).toHaveBeenCalled();
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Levels applied", "success");
  });

  // ---------------------------------------------------------------------------
  // No-selection path — full putImageData, no compositing drawImage
  //
  // Because all canvas getContext calls return the same shared contextStub
  // (see src/test/setup.ts), drawImage calls from makeNewDocument internals
  // (background layer initialisation → syncLayerSource → cloneCanvas) and
  // from the post-commit syncLayerSource call are also counted on the shared
  // stub.  For the no-selection path the total is exactly 2 drawImage calls:
  //   1. makeNewDocument background layer initialisation (clearLayer →
  //      syncLayerSource → cloneCanvas)
  //   2. post-commit syncLayerSource on the active layer
  // No compositing drawImage calls are made — those only appear in the
  // selection-scoped path where the count jumps to 5.
  // ---------------------------------------------------------------------------

  it("no selection: uses putImageData and does not call compositing drawImage", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      // selectionMask omitted — resolves to undefined → no-selection path
      target: { doc, layer, sourceCanvas },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Brightness/Contrast",
      successMessage: "Brightness/Contrast applied",
      renderEditorState,
      showToast,
    });

    // Full-replace path must call putImageData exactly once.
    expect(context?.putImageData).toHaveBeenCalledTimes(1);
    // Only 2 drawImage calls total (background init + post-commit syncLayerSource),
    // NOT the 5 that would indicate selection compositing took place.
    expect(context?.drawImage).toHaveBeenCalledTimes(2);
  });

  it("no selection (explicit null): uses putImageData and does not call compositing drawImage", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas, selectionMask: null },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Gaussian Blur",
      successMessage: "Gaussian Blur applied",
      renderEditorState,
      showToast,
    });

    expect(context?.putImageData).toHaveBeenCalledTimes(1);
    expect(context?.drawImage).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Active-selection path — selection-scoped composite, no putImageData on layer
  //
  // With an active selectionMask the composite routine runs:
  //   1. tmpCtx.putImageData(result, 0, 0)           — adjusted pixels on tmp
  //   2. tmpCtx.drawImage(selectionMask, -x, -y)     — clip via destination-in
  //   3. layerCtx.drawImage(sourceCanvas, 0, 0)      — restore original pixels
  //   4. layerCtx.drawImage(tmp, 0, 0)               — paint masked result
  // Plus the 2 infrastructure drawImage calls present in every path
  // (background init + post-commit syncLayerSource) = 5 drawImage total.
  // putImageData is called exactly once (on the tmp canvas, shared stub).
  // ---------------------------------------------------------------------------

  it("active selection: routes through composite path and produces correct call counts", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 10;
    selectionMask.height = 10;
    doc.redoStack = ["redo"];

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    // All canvas getContext calls return the shared contextStub from setup.ts.
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas, selectionMask },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Hue/Saturation",
      successMessage: "Hue/Saturation applied",
      renderEditorState,
      showToast,
    });

    // putImageData is called exactly once: tmpCtx.putImageData (adjusted result
    // onto the tmp canvas).  It is never called on the layer canvas directly —
    // that would bypass the selection mask.
    expect(context?.putImageData).toHaveBeenCalledTimes(1);

    // drawImage is called 5 times in total:
    //   2 infrastructure calls (background init + syncLayerSource) +
    //   3 composite calls (mask clip, sourceCanvas restore, tmp overlay)
    expect(context?.drawImage).toHaveBeenCalledTimes(5);

    // The selection mask composite call with offset must be present.
    expect(context?.drawImage).toHaveBeenCalledWith(selectionMask, -layer.x, -layer.y);
    // The source-canvas restore call must be present.
    expect(context?.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0);

    // History, undo, dirty, toast all still fire.
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toEqual([]);
    expect(doc.dirty).toBe(true);
    expect(doc.history[0]).toBe("Hue/Saturation");
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Hue/Saturation applied", "success");
  });

  it("active selection: drawImage uses layer offset when clipping through the selection mask", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    // Place the layer at a non-zero position to verify the offset is forwarded.
    layer.x = 10;
    layer.y = 20;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 100;
    sourceCanvas.height = 100;
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 100;
    selectionMask.height = 100;

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas, selectionMask },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Curves",
      successMessage: "Curves applied",
      renderEditorState,
      showToast,
    });

    // The selection mask must be drawn at (-layer.x, -layer.y) so the global
    // mask coordinates align with the layer-local canvas coordinate system.
    expect(context?.drawImage).toHaveBeenCalledWith(selectionMask, -10, -20);
  });
});
