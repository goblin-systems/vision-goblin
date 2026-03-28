import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTransformController } from "./transformController";
import { makeNewDocument } from "./actions/documentActions";

function installTransformInputs() {
  document.body.innerHTML = `
    <input id="transform-scale-x-input" value="100" />
    <input id="transform-scale-y-input" value="100" />
    <input id="transform-rotate-input" value="0" />
    <input id="transform-skew-x-input" value="0" />
    <input id="transform-skew-y-input" value="0" />
  `;
}

describe("transformController", () => {
  beforeEach(() => {
    installTransformInputs();
  });

  it("creates a centered draft for the active layer", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[0];
    layer.isBackground = false;
    layer.locked = false;
    layer.x = 10;
    layer.y = 20;
    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });

    const draft = controller.ensureDraftForActiveLayer();

    expect(draft?.centerX).toBe(60);
    expect(draft?.centerY).toBe(60);
    expect(draft?.pivotX).toBe(60);
    expect(draft?.pivotY).toBe(60);
  });

  it("updates draft values from bound inputs", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[0];
    layer.isBackground = false;
    layer.locked = false;
    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    controller.ensureDraftForActiveLayer();

    (document.getElementById("transform-scale-x-input") as HTMLInputElement).value = "150";
    (document.getElementById("transform-scale-y-input") as HTMLInputElement).value = "80";
    (document.getElementById("transform-rotate-input") as HTMLInputElement).value = "25";
    controller.updateDraftFromInputs();

    expect(controller.getDraft()?.scaleX).toBe(1.5);
    expect(controller.getDraft()?.scaleY).toBe(0.8);
    expect(controller.getDraft()?.rotateDeg).toBe(25);
  });

  it("clears the draft on cancel", () => {
    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    doc.layers[0].isBackground = false;
    doc.layers[0].locked = false;
    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => doc.layers[0],
      renderEditorState,
      showToast,
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    controller.ensureDraftForActiveLayer();

    controller.cancel();

    expect(controller.getDraft()).toBeNull();
    expect(renderEditorState).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Transform cancelled", "info");
  });
});
