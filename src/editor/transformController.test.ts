import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransformController } from "./transformController";
import { makeNewDocument } from "./actions/documentActions";
import { buildTransformPreview, createShapeLayer, createTextLayer, deserializeDocument, serializeDocument } from "./documents";
import * as selection from "./selection";
import { drawStroke } from "./canvasPointer";
import type { RasterLayer } from "./types";
import { installPixelCanvasMock, setPixel } from "../test/pixelCanvasMock";

function getLayerCenter(layer: { x: number; y: number; canvas: HTMLCanvasElement }) {
  return {
    x: layer.x + layer.canvas.width / 2,
    y: layer.y + layer.canvas.height / 2,
  };
}

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

  it("uses raster visible-content bounds for transform frame and pivot", () => {
    installPixelCanvasMock();
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const layer = doc.layers[1] as RasterLayer;
    layer.locked = false;
    layer.x = 50;
    layer.y = 30;
    setPixel(layer.canvas, 120, 80, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(layer.canvas, 139, 89, { r: 255, g: 255, b: 255, a: 255 });

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });

    const draft = controller.ensureDraftForActiveLayer();

    expect(draft?.frameBounds).toEqual({ x: 170, y: 110, width: 20, height: 10 });
    expect(draft?.centerX).toBe(180);
    expect(draft?.centerY).toBe(115);
    expect(draft?.pivotX).toBe(180);
    expect(draft?.pivotY).toBe(115);
  });

  it("uses a cropped raster source canvas so identity preview stays anchored to visible content", () => {
    installPixelCanvasMock();
    const doc = makeNewDocument("Doc", 400, 300, 100, "transparent");
    const layer = doc.layers[1] as RasterLayer;
    layer.locked = false;
    layer.x = 120;
    layer.y = 70;
    setPixel(layer.canvas, 150, 40, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(layer.canvas, 179, 64, { r: 255, g: 255, b: 255, a: 255 });

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });

    const draft = controller.ensureDraftForActiveLayer();

    expect(draft).not.toBeNull();
    expect(draft?.frameBounds).toEqual({ x: 270, y: 110, width: 30, height: 25 });
    expect(draft?.sourceCanvas.width).toBe(30);
    expect(draft?.sourceCanvas.height).toBe(25);
    expect(draft?.sourceCanvas.width).not.toBe(layer.canvas.width);
    expect(draft?.sourceCanvas.height).not.toBe(layer.canvas.height);

    const preview = buildTransformPreview(draft!);
    expect(preview.x).toBe(270);
    expect(preview.y).toBe(110);
    expect(preview.width).toBe(30);
    expect(preview.height).toBe(25);
  });

  it("falls back to full raster canvas bounds when the raster is empty", () => {
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const layer = doc.layers[1] as RasterLayer;
    layer.locked = false;
    layer.x = 25;
    layer.y = 15;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });

    const draft = controller.ensureDraftForActiveLayer();

    expect(draft?.frameBounds).toEqual({ x: 25, y: 15, width: layer.canvas.width, height: layer.canvas.height });
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

  it("ignores geometric inputs for text-layout drafts", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = createTextLayer("Text", 10, 10, { text: "Hello", boxWidth: 120 });
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;
    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    controller.ensureDraft(doc, layer, "text-layout");

    (document.getElementById("transform-scale-x-input") as HTMLInputElement).value = "150";
    (document.getElementById("transform-scale-y-input") as HTMLInputElement).value = "80";
    (document.getElementById("transform-rotate-input") as HTMLInputElement).value = "25";
    (document.getElementById("transform-skew-x-input") as HTMLInputElement).value = "10";
    (document.getElementById("transform-skew-y-input") as HTMLInputElement).value = "5";
    controller.updateDraftFromInputs();

    expect(controller.getDraft()?.scaleX).toBe(1);
    expect(controller.getDraft()?.scaleY).toBe(1);
    expect(controller.getDraft()?.rotateDeg).toBe(0);
    expect(controller.getDraft()?.skewXDeg).toBe(0);
    expect(controller.getDraft()?.skewYDeg).toBe(0);
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

  it("commits text scale and rotation natively so the layer stays editable", async () => {
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const textLayer = createTextLayer("Headline", 24, 32, { text: "Editable", fontSize: 36, boxWidth: 160 });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => textLayer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraftForActiveLayer();
    if (!draft) {
      throw new Error("Expected transform draft");
    }

    draft.scaleX = 1.4;
    draft.scaleY = 0.8;
    draft.rotateDeg = 18;

    controller.commit();

    expect(textLayer.textData.scaleX).toBeCloseTo(1.4);
    expect(textLayer.textData.scaleY).toBeCloseTo(0.8);
    expect(textLayer.textData.rotationDeg).toBeCloseTo(18);
    expect(textLayer.type).toBe("text");
    expect(textLayer.textData.text).toBe("Editable");

    const reopened = await deserializeDocument(serializeDocument(doc), null);
    const reopenedLayer = reopened.layers.find((layer) => layer.id === textLayer.id);
    expect(reopenedLayer?.type).toBe("text");
    if (!reopenedLayer || reopenedLayer.type !== "text") {
      throw new Error("Expected reopened text layer");
    }
    expect(reopenedLayer.textData.text).toBe("Editable");
    expect(reopenedLayer.textData.scaleX).toBeCloseTo(1.4);
    expect(reopenedLayer.textData.scaleY).toBeCloseTo(0.8);
    expect(reopenedLayer.textData.rotationDeg).toBeCloseTo(18);
  });

  it("commits text skew natively so the layer stays editable", async () => {
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const textLayer = createTextLayer("Headline", 24, 32, { text: "Editable", fontSize: 36, boxWidth: 160 });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => textLayer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraftForActiveLayer();
    if (!draft) {
      throw new Error("Expected transform draft");
    }

    draft.skewXDeg = 7;
    draft.skewYDeg = -4;

    controller.commit();

    expect(textLayer.textData.skewXDeg).toBeCloseTo(7);
    expect(textLayer.textData.skewYDeg).toBeCloseTo(-4);

    const reopened = await deserializeDocument(serializeDocument(doc), null);
    const reopenedLayer = reopened.layers.find((layer) => layer.id === textLayer.id);
    expect(reopenedLayer?.type).toBe("text");
    if (!reopenedLayer || reopenedLayer.type !== "text") {
      throw new Error("Expected reopened text layer");
    }
    expect(reopenedLayer.textData.skewXDeg).toBeCloseTo(7);
    expect(reopenedLayer.textData.skewYDeg).toBeCloseTo(-4);
  });

  it("commits text layout transforms as box-width-only changes", () => {
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const textLayer = createTextLayer("Headline", 24, 32, { text: "Editable", fontSize: 36, boxWidth: 160 });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => textLayer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraft(doc, textLayer, "text-layout");
    const initialX = textLayer.x;
    const initialY = textLayer.y;

    draft.textBoxWidth = 220;
    draft.previewOverride = {
      canvas: textLayer.canvas,
      x: initialX + 10,
      y: initialY + 6,
      width: textLayer.canvas.width,
      height: textLayer.canvas.height,
    };
    draft.scaleX = 1.5;
    draft.scaleY = 0.75;
    draft.rotateDeg = 20;

    controller.commit();

    expect(textLayer.textData.boxWidth).toBe(220);
    expect(textLayer.textData.scaleX).toBe(1);
    expect(textLayer.textData.scaleY).toBe(1);
    expect(textLayer.textData.rotationDeg).toBe(0);
    expect(textLayer.x).toBe(initialX + 10);
    expect(textLayer.y).toBe(initialY + 6);
  });

  it("commits text layout height changes and preserves them through reopen", async () => {
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const textLayer = createTextLayer("Headline", 24, 32, { text: "Editable", fontSize: 36, boxWidth: 160, boxHeight: 80 });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => textLayer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraft(doc, textLayer, "text-layout");
    draft.textBoxWidth = 220;
    draft.textBoxHeight = 110;
    draft.previewOverride = {
      canvas: textLayer.canvas,
      x: textLayer.x,
      y: textLayer.y + 8,
      width: textLayer.canvas.width,
      height: textLayer.canvas.height,
    };

    controller.commit();

    expect(textLayer.textData.boxWidth).toBe(220);
    expect(textLayer.textData.boxHeight).toBe(110);

    const reopened = await deserializeDocument(serializeDocument(doc), null);
    const reopenedLayer = reopened.layers.find((layer) => layer.id === textLayer.id);
    expect(reopenedLayer?.type).toBe("text");
    if (!reopenedLayer || reopenedLayer.type !== "text") {
      throw new Error("Expected reopened text layer");
    }
    expect(reopenedLayer.textData.boxHeight).toBe(110);
    expect(reopenedLayer.textData.boxWidth).toBe(220);
  });

  it("commits text layout transforms with independent width and height draft values", () => {
    const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
    const textLayer = createTextLayer("Headline", 24, 32, { text: "Editable", fontSize: 36, boxWidth: 160, boxHeight: 80 });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => textLayer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraft(doc, textLayer, "text-layout");
    draft.textBoxWidth = 210;
    draft.textBoxHeight = 118;
    draft.previewOverride = {
      canvas: textLayer.canvas,
      x: textLayer.x + 12,
      y: textLayer.y + 9,
      width: 210,
      height: 118,
    };

    controller.commit();

    expect(textLayer.textData.boxWidth).toBe(210);
    expect(textLayer.textData.boxHeight).toBe(118);
    expect(textLayer.x).toBe(draft.previewOverride.x);
    expect(textLayer.y).toBe(draft.previewOverride.y);
  });

  it("commits shape resize and rotation natively so style fields survive reopen", async () => {
    const doc = makeNewDocument("Doc", 320, 240, 100, "transparent");
    const shapeLayer = createShapeLayer("Card", "rectangle", 48, 36);
    shapeLayer.shapeData.fillColor = "#224466";
    shapeLayer.shapeData.strokeColor = "#F0E68C";
    shapeLayer.shapeData.strokeWidth = 7;
    shapeLayer.shapeData.cornerRadius = 24;
    doc.layers.push(shapeLayer);
    doc.activeLayerId = shapeLayer.id;

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => shapeLayer,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraftForActiveLayer();
    if (!draft) {
      throw new Error("Expected transform draft");
    }

    draft.scaleX = 1.5;
    draft.scaleY = 0.75;
    draft.rotateDeg = 30;

    controller.commit();

    expect(shapeLayer.type).toBe("shape");
    expect(shapeLayer.shapeData.width).toBe(330);
    expect(shapeLayer.shapeData.height).toBe(120);
    expect(shapeLayer.shapeData.rotationDeg).toBeCloseTo(30);
    expect(shapeLayer.shapeData.fillColor).toBe("#224466");
    expect(shapeLayer.shapeData.strokeColor).toBe("#F0E68C");
    expect(shapeLayer.shapeData.strokeWidth).toBe(7);
    expect(shapeLayer.shapeData.cornerRadius).toBe(24);

    const reopened = await deserializeDocument(serializeDocument(doc), null);
    const reopenedLayer = reopened.layers.find((layer) => layer.id === shapeLayer.id);
    expect(reopenedLayer?.type).toBe("shape");
    if (!reopenedLayer || reopenedLayer.type !== "shape") {
      throw new Error("Expected reopened shape layer");
    }
    expect(reopenedLayer.shapeData.width).toBe(330);
    expect(reopenedLayer.shapeData.height).toBe(120);
    expect(reopenedLayer.shapeData.rotationDeg).toBeCloseTo(30);
    expect(reopenedLayer.shapeData.fillColor).toBe("#224466");
    expect(reopenedLayer.shapeData.strokeColor).toBe("#F0E68C");
    expect(reopenedLayer.shapeData.strokeWidth).toBe(7);
    expect(reopenedLayer.shapeData.cornerRadius).toBe(24);
  });

  it("starts a shared shape draft for multi-selected editable shapes and excludes locked or background layers", () => {
    const doc = makeNewDocument("Doc", 640, 480, 100, "transparent");
    const backgroundLayer = doc.layers[0];
    const shapeA = createShapeLayer("A", "rectangle", 20, 40);
    const shapeB = createShapeLayer("B", "ellipse", 320, 180);
    const lockedShape = createShapeLayer("Locked", "rectangle", 120, 120);
    lockedShape.locked = true;
    doc.layers.push(shapeA, shapeB, lockedShape);
    doc.activeLayerId = shapeB.id;
    doc.selectedLayerIds = [shapeA.id, backgroundLayer.id, lockedShape.id, shapeB.id];

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => shapeB,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });

    const draft = controller.ensureDraftForActiveLayer();

    expect(draft?.previewLayerIds).toEqual([shapeA.id, shapeB.id]);
    expect(draft?.groupMembers?.map((member) => member.layerId)).toEqual([shapeA.id, shapeB.id]);
    expect(draft?.frameBounds).toEqual({
      x: Math.min(shapeA.x, shapeB.x),
      y: Math.min(shapeA.y, shapeB.y),
      width: Math.max(shapeA.x + shapeA.canvas.width, shapeB.x + shapeB.canvas.width) - Math.min(shapeA.x, shapeB.x),
      height: Math.max(shapeA.y + shapeA.canvas.height, shapeB.y + shapeB.canvas.height) - Math.min(shapeA.y, shapeB.y),
    });
  });

  it("commits multi-shape group moves while preserving relative offsets", () => {
    const doc = makeNewDocument("Doc", 640, 480, 100, "transparent");
    const shapeA = createShapeLayer("A", "rectangle", 24, 36);
    const shapeB = createShapeLayer("B", "ellipse", 300, 180);
    doc.layers.push(shapeA, shapeB);
    doc.activeLayerId = shapeB.id;
    doc.selectedLayerIds = [shapeA.id, shapeB.id];

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => shapeB,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraftForActiveLayer();
    if (!draft) {
      throw new Error("Expected group transform draft");
    }
    const centerA = getLayerCenter(shapeA);
    const centerB = getLayerCenter(shapeB);
    const initialOffset = { x: centerB.x - centerA.x, y: centerB.y - centerA.y };

    draft.centerX += 48;
    draft.centerY -= 22;
    draft.pivotX += 48;
    draft.pivotY -= 22;

    controller.commit();

    const movedCenterA = getLayerCenter(shapeA);
    const movedCenterB = getLayerCenter(shapeB);
    expect(movedCenterA.x - centerA.x).toBeCloseTo(48, 6);
    expect(movedCenterA.y - centerA.y).toBeCloseTo(-22, 6);
    expect(movedCenterB.x - centerB.x).toBeCloseTo(48, 6);
    expect(movedCenterB.y - centerB.y).toBeCloseTo(-22, 6);
    expect(movedCenterB.x - movedCenterA.x).toBeCloseTo(initialOffset.x, 6);
    expect(movedCenterB.y - movedCenterA.y).toBeCloseTo(initialOffset.y, 6);
    expect(doc.selectedLayerIds).toEqual([shapeA.id, shapeB.id]);
  });

  it("commits multi-shape scale and rotate natively so shapes stay editable after reopen", async () => {
    const doc = makeNewDocument("Doc", 800, 600, 100, "transparent");
    const shapeA = createShapeLayer("A", "rectangle", 40, 60);
    const shapeB = createShapeLayer("B", "ellipse", 360, 220);
    shapeA.shapeData.fillColor = "#224466";
    shapeA.shapeData.strokeColor = "#F0E68C";
    shapeA.shapeData.strokeWidth = 7;
    shapeA.shapeData.cornerRadius = 30;
    shapeB.shapeData.fillColor = "#AA5500";
    shapeB.shapeData.strokeColor = "#FFFFFF";
    shapeB.shapeData.strokeWidth = 5;
    doc.layers.push(shapeA, shapeB);
    doc.activeLayerId = shapeB.id;
    doc.selectedLayerIds = [shapeA.id, shapeB.id];

    const controller = createTransformController({
      getActiveDocument: () => doc,
      getActiveLayer: () => shapeB,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      getInput: (id) => document.getElementById(id) as HTMLInputElement,
    });
    const draft = controller.ensureDraftForActiveLayer();
    if (!draft) {
      throw new Error("Expected group transform draft");
    }

    draft.scaleX = 1.25;
    draft.scaleY = 0.5;
    draft.rotateDeg = 30;

    controller.commit();

    expect(shapeA.type).toBe("shape");
    expect(shapeB.type).toBe("shape");
    expect(shapeA.shapeData.width).toBe(275);
    expect(shapeA.shapeData.height).toBe(80);
    expect(shapeA.shapeData.rotationDeg).toBeCloseTo(30);
    expect(shapeA.shapeData.fillColor).toBe("#224466");
    expect(shapeA.shapeData.strokeColor).toBe("#F0E68C");
    expect(shapeA.shapeData.strokeWidth).toBe(7);
    expect(shapeA.shapeData.cornerRadius).toBe(30);
    expect(shapeB.shapeData.width).toBe(275);
    expect(shapeB.shapeData.height).toBe(80);
    expect(shapeB.shapeData.rotationDeg).toBeCloseTo(30);
    expect(shapeB.shapeData.fillColor).toBe("#AA5500");
    expect(shapeB.shapeData.strokeColor).toBe("#FFFFFF");
    expect(shapeB.shapeData.strokeWidth).toBe(5);

    const reopened = await deserializeDocument(serializeDocument(doc), null);
    const reopenedShapeA = reopened.layers.find((layer) => layer.id === shapeA.id);
    const reopenedShapeB = reopened.layers.find((layer) => layer.id === shapeB.id);
    expect(reopenedShapeA?.type).toBe("shape");
    expect(reopenedShapeB?.type).toBe("shape");
    if (!reopenedShapeA || reopenedShapeA.type !== "shape" || !reopenedShapeB || reopenedShapeB.type !== "shape") {
      throw new Error("Expected reopened shape layers");
    }
    expect(reopenedShapeA.shapeData.width).toBe(275);
    expect(reopenedShapeA.shapeData.height).toBe(80);
    expect(reopenedShapeA.shapeData.rotationDeg).toBeCloseTo(30);
    expect(reopenedShapeA.shapeData.fillColor).toBe("#224466");
    expect(reopenedShapeA.shapeData.strokeColor).toBe("#F0E68C");
    expect(reopenedShapeA.shapeData.strokeWidth).toBe(7);
    expect(reopenedShapeA.shapeData.cornerRadius).toBe(30);
    expect(reopenedShapeB.shapeData.width).toBe(275);
    expect(reopenedShapeB.shapeData.height).toBe(80);
    expect(reopenedShapeB.shapeData.rotationDeg).toBeCloseTo(30);
    expect(reopenedShapeB.shapeData.fillColor).toBe("#AA5500");
    expect(reopenedShapeB.shapeData.strokeColor).toBe("#FFFFFF");
    expect(reopenedShapeB.shapeData.strokeWidth).toBe(5);
  });
});
