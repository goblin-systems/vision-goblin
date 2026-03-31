import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import { createSelectionController } from "./selectionController";
import { createMaskCanvas, fillMask } from "./selection";

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
