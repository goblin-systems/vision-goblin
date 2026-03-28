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
});
