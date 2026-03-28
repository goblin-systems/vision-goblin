import { describe, expect, it } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { applyRefineEdgeOutput, commitSelectionMask } from "./selectionToolsController";

describe("selectionToolsController helpers", () => {
  it("commits a non-empty selection mask into document selection state", () => {
    const doc = makeNewDocument("Doc", 12, 10, 100, "transparent");
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 12;
    selectionMask.height = 10;
    const context = selectionMask.getContext("2d") as unknown as { getImageData: { mockReturnValue: (value: unknown) => void } };
    const data = new Uint8ClampedArray(12 * 10 * 4);
    data[(1 * 4)] = 255;
    data[(1 * 4) + 1] = 255;
    data[(1 * 4) + 2] = 255;
    data[(1 * 4) + 3] = 255;
    context.getImageData.mockReturnValue({ data, width: 12, height: 10 });

    const committed = commitSelectionMask(doc, selectionMask, "Select by Color Range");

    expect(committed).toBe(true);
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toEqual([]);
    expect(doc.selectionMask).toBe(selectionMask);
    expect(doc.selectionRect).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    expect(doc.history[0]).toBe("Select by Color Range");
  });

  it("skips empty masks without mutating history", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    const context = selectionMask.getContext("2d") as unknown as { getImageData: { mockReturnValue: (value: unknown) => void } };
    context.getImageData.mockReturnValue({
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
    });

    const initialHistory = [...doc.history];

    expect(commitSelectionMask(doc, selectionMask, "Ignored")).toBe(false);
    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toEqual(initialHistory);
  });

  it("writes refine-edge output into the active layer mask", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const refinedMask = document.createElement("canvas");
    refinedMask.width = 10;
    refinedMask.height = 10;

    applyRefineEdgeOutput(doc, refinedMask, "mask");

    expect(doc.layers.find((layer) => layer.id === doc.activeLayerId)?.mask).toBe(refinedMask);
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Refine Edge");
  });
});
