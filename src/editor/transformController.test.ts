import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransformController } from "./transformController";
import { makeNewDocument } from "./actions/documentActions";
import * as selection from "./selection";
import { drawStroke } from "./canvasPointer";
import type { RasterLayer } from "./types";

function createMaskWithSelectedRect(width: number, height: number, rect: { x: number; y: number; width: number; height: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
  }
  const imageData = new ImageData(data, width, height);
  const context = {
    getImageData: vi.fn(() => imageData),
  };
  return { canvas, context };
}

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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("transforms document selection state when committing a transform", () => {
    const doc = makeNewDocument("Doc", 20, 20, 100, "transparent");
    const layer = doc.layers[1] as RasterLayer;
    layer.locked = false;
    layer.x = 4;
    layer.y = 3;
    doc.activeLayerId = layer.id;
    const originalSelectionRect = { x: 2, y: 2, width: 4, height: 4 };
    doc.selectionRect = originalSelectionRect;
    doc.selectionPath = { points: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }], closed: true };
    const originalSelectionMask = document.createElement("canvas");
    originalSelectionMask.width = doc.width;
    originalSelectionMask.height = doc.height;
    doc.selectionMask = originalSelectionMask;

    const normalizedMask = document.createElement("canvas");
    normalizedMask.width = doc.width;
    normalizedMask.height = doc.height;
    const { canvas: transformedMask, context: transformedContext } = createMaskWithSelectedRect(20, 20, { x: 8, y: 6, width: 3, height: 2 });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContextSpy.mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
      if (this === transformedMask && contextId === "2d") {
        return transformedContext as unknown as CanvasRenderingContext2D;
      }
      return originalGetContext.call(this, contextId) as ReturnType<typeof originalGetContext>;
    });

    const normalizeSpy = vi.spyOn(selection, "normalizeSelectionToMask").mockReturnValue(normalizedMask);
    const transformSpy = vi.spyOn(selection, "transformMaskInDocumentSpace").mockReturnValue(transformedMask);
    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraftForActiveLayer();
    if (!draft) {
      throw new Error("Expected transform draft");
    }
    draft.scaleX = 1.5;
    draft.scaleY = 1.25;
    draft.rotateDeg = 20;

    controller.commit();

    expect(normalizeSpy).toHaveBeenCalledWith(doc.width, doc.height, originalSelectionRect, doc.selectionShape, expect.any(Object), originalSelectionMask);
    expect(transformSpy).toHaveBeenCalledWith(normalizedMask, doc.width, doc.height, expect.objectContaining({ a: expect.any(Number), d: expect.any(Number) }), draft.pivotX, draft.pivotY);
    expect(doc.selectionMask).toBe(transformedMask);
    expect(doc.selectionRect).toEqual({ x: 8, y: 6, width: 3, height: 2 });
    expect(doc.selectionPath).toBeNull();
  });

  it("uses the transformed selection mask for downstream masked brush strokes", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const layer = doc.layers[1] as RasterLayer;
    layer.locked = false;
    layer.x = 5;
    layer.y = 7;
    doc.activeLayerId = layer.id;
    doc.selectionRect = { x: 1, y: 1, width: 4, height: 4 };
    doc.selectionMask = document.createElement("canvas");
    doc.selectionMask.width = doc.width;
    doc.selectionMask.height = doc.height;

    const normalizedMask = document.createElement("canvas");
    normalizedMask.width = doc.width;
    normalizedMask.height = doc.height;
    const { canvas: transformedMask, context: transformedContext } = createMaskWithSelectedRect(24, 24, { x: 10, y: 9, width: 4, height: 4 });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContextSpy.mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
      if (this === transformedMask && contextId === "2d") {
        return transformedContext as unknown as CanvasRenderingContext2D;
      }
      return originalGetContext.call(this, contextId) as ReturnType<typeof originalGetContext>;
    });

    vi.spyOn(selection, "normalizeSelectionToMask").mockReturnValue(normalizedMask);
    vi.spyOn(selection, "transformMaskInDocumentSpace").mockReturnValue(transformedMask);
    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    controller.ensureDraftForActiveLayer();
    controller.commit();

    const sharedContext = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    vi.mocked(sharedContext.drawImage).mockClear();

    drawStroke(layer, 11, 10, 12, 11, "brush", 4, 1, "#ff00ff", doc.selectionRect, doc.selectionInverted, doc.selectionShape, doc.selectionPath, doc.selectionMask);

    expect(sharedContext.drawImage).toHaveBeenCalledWith(transformedMask, -layer.x, -layer.y);
  });
});
