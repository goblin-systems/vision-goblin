import { describe, expect, it, vi } from "vitest";
import { canDeleteLayer } from "./layers";
import { buildTransformPreview, cloneDocument, cloneLayer, compositeDocumentOnto, createAdjustmentLayer, createBlankDocument, createLayerCanvas, createLayerThumb, createTextFillStyle, createTextLayer, deserializeDocument, extractRasterLayerContentCanvas, getRasterLayerContentBounds, getRasterLayerContentBoundsLocal, renderDocumentClipboardCanvas, renderTextLayer, resizeCanvasDocument, restoreDocumentFromSnapshot, serializeDocument, snapshotDocument } from "./documents";
import { getResizeOffset } from "./geometry";
import type { LinearGradientFill, RadialGradientFill, SerializedDocument, SolidFill, TextFill, TextLayer, TransformDraft } from "./types";
import { getTextFillColor } from "./types";
import { installPixelCanvasMock, readPixel, setPixel } from "../test/pixelCanvasMock";

// FontFace and document.fonts are not available in jsdom — mock them so
// deserializeDocument can call registerCustomFont without errors.
vi.stubGlobal(
  "FontFace",
  vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
  })),
);
if (!document.fonts) {
  Object.defineProperty(document, "fonts", {
    value: { add: vi.fn() },
    writable: true,
  });
}

describe("editor documents", () => {
  it("creates blank documents with a background layer and editable layer", () => {
    const doc = createBlankDocument("Untitled", 640, 480, 100);
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[0].isBackground).toBe(true);
    expect(doc.layers[1].name).toBe("Layer 1");
    expect(doc.activeLayerId).toBe(doc.layers[1].id);
    expect(doc.selectionRect).toBeNull();
    expect(doc.selectionInverted).toBe(false);
  });

  it("only allows deleting non-background layers", () => {
    const doc = createBlankDocument("Untitled", 640, 480, 100);
    expect(canDeleteLayer(doc, doc.layers[0])).toBe(false);
    expect(canDeleteLayer(doc, doc.layers[1])).toBe(true);
  });

  it("clones documents with new ids and duplicated layers", () => {
    const doc = createBlankDocument("Untitled", 640, 480, 100);
    doc.selectionRect = { x: 10, y: 10, width: 50, height: 40 };
    doc.selectionInverted = true;
    const clone = cloneDocument(doc);
    expect(clone.id).not.toBe(doc.id);
    expect(clone.layers).toHaveLength(doc.layers.length);
    expect(clone.layers[0].id).not.toBe(doc.layers[0].id);
    expect(clone.name).toContain("Copy");
    expect(clone.selectionRect).toEqual(doc.selectionRect);
    expect(clone.selectionInverted).toBe(true);
  });

  it("resizes document canvases using the provided offset", () => {
    const doc = createBlankDocument("Untitled", 100, 80, 100);
    const offset = getResizeOffset("center", 100, 80, 140, 120);
    resizeCanvasDocument(doc, 140, 120, offset);
    expect(doc.width).toBe(140);
    expect(doc.height).toBe(120);
    expect(doc.layers[0].canvas.width).toBe(140);
    expect(doc.layers[0].canvas.height).toBe(120);
  });

  it("creates layer thumbnails at the expected size", () => {
    const layer = {
      id: "layer-1",
      type: "raster" as const,
      name: "Layer",
      canvas: createLayerCanvas(200, 100),
      x: 0,
      y: 0,
      visible: true,
      opacity: 1,
      locked: false,
      effects: [],
    };
    const thumb = createLayerThumb(layer);
    expect(thumb.width).toBe(28);
    expect(thumb.height).toBe(28);
  });

  it("serializes AI provenance on layers", () => {
    const doc = createBlankDocument("Untitled", 320, 240, 100);
    doc.layers[1].aiProvenance = {
      providerId: "openai-compatible",
      model: "gpt-4.1-mini",
      taskId: "task-42",
      family: "enhancement",
      operation: "upscale",
      warnings: ["offline"],
      createdAt: "2026-03-28T00:00:00.000Z",
    };

    const serialized = serializeDocument(doc);

    expect(serialized.layers[1].aiProvenance?.operation).toBe("upscale");
    expect(serialized.layers[1].aiProvenance?.warnings).toEqual(["offline"]);
  });

  it("buildTransformPreview resets context transform to identity after drawing", () => {
    const source = createLayerCanvas(100, 80);
    const draft: TransformDraft = {
      layerId: "layer-1",
      intent: "layer",
      sourceCanvas: source,
      centerX: 50,
      centerY: 40,
      pivotX: 50,
      pivotY: 40,
      scaleX: 1.5,
      scaleY: 1.5,
      rotateDeg: 45,
      skewXDeg: 0,
      skewYDeg: 0,
      snapshot: "data:image/png;base64,AAA",
    };

    const setTransformMock = vi.mocked(source.getContext("2d")!.setTransform);
    setTransformMock.mockClear();

    const result = buildTransformPreview(draft);

    // The canvas context's setTransform must be called at least twice:
    // once with the transform matrix, and once to reset to identity
    expect(setTransformMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The last setTransform call must reset to identity matrix
    const lastCall = setTransformMock.mock.calls[setTransformMock.mock.calls.length - 1];
    expect(lastCall).toEqual([1, 0, 0, 1, 0, 0]);

    // Verify the preview canvas was created
    expect(result.canvas).toBeDefined();
    expect(result.canvas.width).toBeGreaterThan(0);
    expect(result.canvas.height).toBeGreaterThan(0);
  });

  it("reuses the cached preview when the draft inputs are unchanged", () => {
    const source = createLayerCanvas(80, 60);
    const ctx = source.getContext("2d")!;
    vi.mocked(ctx.drawImage).mockClear();
    vi.mocked(ctx.setTransform).mockClear();

    const draft: TransformDraft = {
      layerId: "layer-1",
      intent: "layer",
      sourceCanvas: source,
      centerX: 40,
      centerY: 30,
      pivotX: 40,
      pivotY: 30,
      scaleX: 1.2,
      scaleY: 0.9,
      rotateDeg: 15,
      skewXDeg: 5,
      skewYDeg: -3,
      snapshot: "data:image/png;base64,AAA",
    };

    const first = buildTransformPreview(draft);
    const second = buildTransformPreview(draft);

    expect(second).toBe(first);
    expect(second.canvas).toBe(first.canvas);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.setTransform).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cached preview when transform inputs change", () => {
    const source = createLayerCanvas(80, 60);
    const draft: TransformDraft = {
      layerId: "layer-1",
      intent: "layer",
      sourceCanvas: source,
      centerX: 40,
      centerY: 30,
      pivotX: 40,
      pivotY: 30,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      snapshot: "data:image/png;base64,AAA",
    };

    const first = buildTransformPreview(draft);
    draft.rotateDeg = 30;

    const second = buildTransformPreview(draft);

    expect(second).not.toBe(first);
    expect(second.canvas).not.toBe(first.canvas);
  });

  it("invalidates the cached preview when the source canvas identity or size changes", () => {
    const initialSource = createLayerCanvas(80, 60);
    const replacementSource = createLayerCanvas(120, 90);
    const draft: TransformDraft = {
      layerId: "layer-1",
      intent: "layer",
      sourceCanvas: initialSource,
      centerX: 40,
      centerY: 30,
      pivotX: 40,
      pivotY: 30,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      snapshot: "data:image/png;base64,AAA",
    };

    const first = buildTransformPreview(draft);
    draft.sourceCanvas.width = 100;

    const resizedSourcePreview = buildTransformPreview(draft);
    draft.sourceCanvas = replacementSource;
    draft.centerX = 60;
    draft.centerY = 45;
    draft.pivotX = 60;
    draft.pivotY = 45;

    const replacedSourcePreview = buildTransformPreview(draft);

    expect(resizedSourcePreview).not.toBe(first);
    expect(resizedSourcePreview.canvas).not.toBe(first.canvas);
    expect(replacedSourcePreview).not.toBe(resizedSourcePreview);
    expect(replacedSourcePreview.canvas).not.toBe(resizedSourcePreview.canvas);
  });

  it("skips adjustment-layer temp compositing when degraded rendering requests it", () => {
    const doc = createBlankDocument("Large", 400, 300, 100);
    doc.layers.push(createAdjustmentLayer("Levels", { kind: "levels", params: { inputBlack: 0, inputWhite: 255, gamma: 1 } }));
    const ctx = createLayerCanvas(400, 300).getContext("2d")!;
    vi.mocked(ctx.getImageData).mockClear();
    vi.mocked(ctx.putImageData).mockClear();

    compositeDocumentOnto(ctx, doc, 0, 0, 1, null, { skipAdjustmentLayers: true });

    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it("renders the whole composited canvas for clipboard copy when there is no selection", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Doc", 4, 3, 100, "transparent");
    const layer = doc.layers[1];

    setPixel(layer.canvas, 1, 1, { r: 20, g: 40, b: 60, a: 255 });
    setPixel(layer.canvas, 3, 2, { r: 200, g: 10, b: 90, a: 255 });

    const result = renderDocumentClipboardCanvas(doc);

    expect(result.selectionBounds).toBeNull();
    expect(result.canvas.width).toBe(4);
    expect(result.canvas.height).toBe(3);
    expect(readPixel(result.canvas, 1, 1)).toEqual({ r: 20, g: 40, b: 60, a: 255 });
    expect(readPixel(result.canvas, 3, 2)).toEqual({ r: 200, g: 10, b: 90, a: 255 });
  });

  it("uses the effective selection bounds and transparency for clipboard copy", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    const selectionMask = createLayerCanvas(4, 4);

    setPixel(layer.canvas, 1, 1, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(layer.canvas, 2, 1, { r: 0, g: 255, b: 0, a: 255 });
    setPixel(layer.canvas, 1, 2, { r: 0, g: 0, b: 255, a: 255 });
    setPixel(layer.canvas, 2, 2, { r: 255, g: 255, b: 0, a: 255 });
    setPixel(selectionMask, 1, 1, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(selectionMask, 2, 2, { r: 255, g: 255, b: 255, a: 255 });
    doc.selectionMask = selectionMask;

    const result = renderDocumentClipboardCanvas(doc);

    expect(result.selectionBounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(result.canvas.width).toBe(2);
    expect(result.canvas.height).toBe(2);
    expect(readPixel(result.canvas, 0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(readPixel(result.canvas, 1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(readPixel(result.canvas, 0, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(readPixel(result.canvas, 1, 1)).toEqual({ r: 255, g: 255, b: 0, a: 255 });
  });

  it("applies inverted selection state when preparing clipboard copy", () => {
    installPixelCanvasMock();
    const doc = createBlankDocument("Doc", 3, 2, 100, "transparent");
    const layer = doc.layers[1];
    const selectionMask = createLayerCanvas(3, 2);

    setPixel(layer.canvas, 0, 0, { r: 10, g: 20, b: 30, a: 255 });
    setPixel(layer.canvas, 1, 0, { r: 40, g: 50, b: 60, a: 255 });
    setPixel(layer.canvas, 2, 1, { r: 70, g: 80, b: 90, a: 255 });
    setPixel(selectionMask, 1, 0, { r: 255, g: 255, b: 255, a: 255 });
    doc.selectionMask = selectionMask;
    doc.selectionInverted = true;

    const result = renderDocumentClipboardCanvas(doc);

    expect(result.selectionBounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(result.canvas.width).toBe(3);
    expect(result.canvas.height).toBe(2);
    expect(readPixel(result.canvas, 0, 0)).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    expect(readPixel(result.canvas, 1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(readPixel(result.canvas, 2, 1)).toEqual({ r: 70, g: 80, b: 90, a: 255 });
  });

  it("derives tight raster content bounds from oversized transparent backing canvases", () => {
    installPixelCanvasMock();
    const canvas = createLayerCanvas(20, 12);
    setPixel(canvas, 7, 3, { r: 255, g: 0, b: 0, a: 255 });
    setPixel(canvas, 11, 6, { r: 255, g: 0, b: 0, a: 255 });

    expect(getRasterLayerContentBoundsLocal({ canvas } as any)).toEqual({
      x: 7,
      y: 3,
      width: 5,
      height: 4,
    });
    expect(getRasterLayerContentBounds({ x: 40, y: 18, canvas } as any)).toEqual({
      x: 47,
      y: 21,
      width: 5,
      height: 4,
    });

    const cropped = extractRasterLayerContentCanvas({ canvas } as any);
    expect(cropped.width).toBe(5);
    expect(cropped.height).toBe(4);
    expect(cropped).not.toBe(canvas);
  });
});

describe("text fill, stroke, and gradient support", () => {
  it("creates a text layer with solid fill (default) matching old behavior", () => {
    const layer = createTextLayer("Title", 10, 20);

    expect(layer.textData.fill).toEqual({ type: "solid", color: "#ffffff" });
    expect(layer.textData.stroke).toBeNull();
    expect(layer.textData.fillColor).toBe("#ffffff");
    expect(layer.fillColor).toBe("#ffffff");
    expect(layer.canvas.width).toBeGreaterThan(0);
    expect(layer.canvas.height).toBeGreaterThan(0);
  });

  it("creates a text layer with linear gradient fill and renders without error", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const layer = createTextLayer("Gradient", 0, 0, { fill });

    expect(layer.textData.fill).toEqual(fill);
    expect(layer.textData.fillColor).toBe("#ff0000");
    expect(layer.fillColor).toBe("#ff0000");
    expect(layer.canvas.width).toBeGreaterThan(0);
    expect(layer.canvas.height).toBeGreaterThan(0);
  });

  it("creates a text layer with radial gradient fill and renders without error", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      stops: [
        { offset: 0, color: "#00ff00" },
        { offset: 1, color: "#ff00ff" },
      ],
    };
    const layer = createTextLayer("Radial", 0, 0, { fill });

    expect(layer.textData.fill).toEqual(fill);
    expect(layer.textData.fillColor).toBe("#00ff00");
    expect(layer.fillColor).toBe("#00ff00");
    expect(layer.canvas.width).toBeGreaterThan(0);
    expect(layer.canvas.height).toBeGreaterThan(0);
  });

  it("creates a text layer with stroke and renders without error", () => {
    const layer = createTextLayer("Stroked", 0, 0, {
      stroke: { color: "#ff0000", width: 2 },
    });

    expect(layer.textData.stroke).toEqual({ color: "#ff0000", width: 2 });
    expect(layer.textData.fill).toEqual({ type: "solid", color: "#ffffff" });
    expect(layer.canvas.width).toBeGreaterThan(0);
    expect(layer.canvas.height).toBeGreaterThan(0);
  });

  it("creates a text layer with gradient fill + stroke combined", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 45,
      stops: [
        { offset: 0, color: "#aabbcc" },
        { offset: 0.5, color: "#ddeeff" },
        { offset: 1, color: "#112233" },
      ],
    };
    const layer = createTextLayer("Both", 0, 0, {
      fill,
      stroke: { color: "#000000", width: 3 },
    });

    expect(layer.textData.fill).toEqual(fill);
    expect(layer.textData.stroke).toEqual({ color: "#000000", width: 3 });
    expect(layer.textData.fillColor).toBe("#aabbcc");
    expect(layer.canvas.width).toBeGreaterThan(0);
    expect(layer.canvas.height).toBeGreaterThan(0);
  });

  it("serialization round-trip preserves gradient fill and stroke", async () => {
    const doc = createBlankDocument("Test", 200, 200, 100, "transparent");
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 120,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 0.5, color: "#00ff00" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const textLayer = createTextLayer("Gradient Text", 10, 20, {
      text: "Round-trip",
      fill,
      stroke: { color: "#333333", width: 1.5 },
    });
    doc.layers.push(textLayer);

    const serialized = serializeDocument(doc);
    const serializedTextData = serialized.layers[2].textData;

    expect(serializedTextData?.fill).toEqual(fill);
    expect(serializedTextData?.stroke).toEqual({ color: "#333333", width: 1.5 });

    // Deserialize and verify
    const restored = await deserializeDocument(serialized, null);
    const restoredLayer = restored.layers[2];

    expect(restoredLayer.type).toBe("text");
    if (restoredLayer.type === "text") {
      expect(restoredLayer.textData.fill).toEqual(fill);
      expect(restoredLayer.textData.stroke).toEqual({ color: "#333333", width: 1.5 });
      expect(restoredLayer.textData.fillColor).toBe("#ff0000");
    }
  });

  it("serialization round-trip preserves layer effects on supported layers", async () => {
    const doc = createBlankDocument("Effects", 120, 80, 100, "transparent");
    const textLayer = createTextLayer("Styled", 10, 12, { text: "FX" });
    textLayer.effects = [
      { type: "drop-shadow", color: "#000000", offsetX: 2, offsetY: 3, blur: 8, opacity: 0.4, enabled: true },
      { type: "drop-shadow", color: "#ff0000", offsetX: -1, offsetY: 1, blur: 3, opacity: 0.5, enabled: true },
      { type: "outline", color: "#ffffff", width: 2, opacity: 1, enabled: false },
    ];
    doc.layers.push(textLayer);

    const serialized = serializeDocument(doc);
    expect(serialized.layers[2]?.effects).toEqual(textLayer.effects);

    const restored = await deserializeDocument(serialized, null);
    expect(restored.layers[2]?.effects).toEqual(textLayer.effects);
  });

  it("restoreDocumentFromSnapshot restores style edits for undo/redo flows", async () => {
    const doc = createBlankDocument("Undo", 120, 80, 100, "transparent");
    const textLayer = createTextLayer("Styled", 10, 12, { text: "FX" });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    const before = snapshotDocument(doc);
    textLayer.effects = [
      { type: "outer-glow", color: "#00ffff", blur: 20, spread: 4, opacity: 0.8, enabled: true },
    ];
    const after = snapshotDocument(doc);

    await restoreDocumentFromSnapshot(doc, before);
    expect(doc.layers[2]?.effects).toEqual([]);

    await restoreDocumentFromSnapshot(doc, after);
    expect(doc.layers[2]?.effects).toEqual([
      { type: "outer-glow", color: "#00ffff", blur: 20, spread: 4, opacity: 0.8, enabled: true },
    ]);
  });

  it("backward-compatible deserialization migrates old fillColor to solid fill", async () => {
    // Simulate an old-format serialized document
    const oldPayload: SerializedDocument = {
      name: "Legacy Doc",
      width: 100,
      height: 100,
      zoom: 100,
      panX: 0,
      panY: 0,
      activeLayerId: "text-legacy",
      history: ["Created"],
      sourcePath: null,
      background: "white",
      selectionRect: null,
      selectionInverted: false,
      layers: [
        {
          type: "raster",
          id: "bg-1",
          name: "Background",
          x: 0,
          y: 0,
          visible: true,
          opacity: 1,
          locked: false,
          isBackground: true,
          fillColor: "#ffffff",
          dataUrl: "data:image/png;base64,AAA",
        },
        {
          type: "text",
          id: "text-legacy",
          name: "Old Text",
          x: 10,
          y: 10,
          visible: true,
          opacity: 1,
          locked: false,
          dataUrl: "data:image/png;base64,AAA",
          textData: {
            text: "Hello World",
            fontFamily: "Arial",
            fontSize: 32,
            lineHeight: 1.2,
            kerning: 0,
            rotationDeg: 0,
            skewXDeg: 0,
            skewYDeg: 0,
            alignment: "left",
            // Old format: only fillColor, no fill or stroke
            fillColor: "#ff6600",
            bold: false,
            italic: false,
            boxWidth: null,
          },
        },
      ],
    };

    const doc = await deserializeDocument(oldPayload, null);
    const textLayer = doc.layers[1];

    expect(textLayer.type).toBe("text");
    if (textLayer.type === "text") {
      expect(textLayer.textData.fill).toEqual({ type: "solid", color: "#ff6600" });
      expect(textLayer.textData.stroke).toBeNull();
      expect(textLayer.textData.fillColor).toBe("#ff6600");
    }
  });

  it("backward-compatible deserialization defaults stroke to null when missing", async () => {
    const payload: SerializedDocument = {
      name: "Partial Doc",
      width: 100,
      height: 100,
      zoom: 100,
      panX: 0,
      panY: 0,
      activeLayerId: "text-1",
      history: ["Created"],
      sourcePath: null,
      background: "white",
      selectionRect: null,
      selectionInverted: false,
      layers: [
        {
          type: "text",
          id: "text-1",
          name: "Text",
          x: 0,
          y: 0,
          visible: true,
          opacity: 1,
          locked: false,
          dataUrl: "data:image/png;base64,AAA",
          textData: {
            text: "Test",
            fontFamily: "Georgia",
            fontSize: 24,
            lineHeight: 1.2,
            kerning: 0,
            rotationDeg: 0,
            skewXDeg: 0,
            skewYDeg: 0,
            alignment: "left",
            fill: { type: "solid", color: "#ffffff" },
            // stroke intentionally omitted
            bold: false,
            italic: false,
            boxWidth: null,
          },
        },
      ],
    };

    const doc = await deserializeDocument(payload, null);
    const textLayer = doc.layers[0];

    expect(textLayer.type).toBe("text");
    if (textLayer.type === "text") {
      expect(textLayer.textData.stroke).toBeNull();
    }
  });
});

describe("getTextFillColor utility", () => {
  it("returns the color for a solid fill", () => {
    const fill: SolidFill = { type: "solid", color: "#abcdef" };
    expect(getTextFillColor(fill)).toBe("#abcdef");
  });

  it("returns the first stop color for a linear gradient", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#445566" },
      ],
    };
    expect(getTextFillColor(fill)).toBe("#112233");
  });

  it("returns the first stop color for a radial gradient", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      stops: [
        { offset: 0, color: "#aabb00" },
        { offset: 1, color: "#00aabb" },
      ],
    };
    expect(getTextFillColor(fill)).toBe("#aabb00");
  });

  it("returns fallback for an empty gradient stops array", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [],
    };
    expect(getTextFillColor(fill)).toBe("#ffffff");
  });
});

describe("createTextFillStyle", () => {
  it("sets fillStyle to color string for solid fill", () => {
    const canvas = createLayerCanvas(100, 50);
    const ctx = canvas.getContext("2d")!;
    const fill: SolidFill = { type: "solid", color: "#ff0000" };

    createTextFillStyle(ctx, fill, 100, 50);

    expect(ctx.fillStyle).toBe("#ff0000");
  });

  it("calls createLinearGradient for linear gradient fill", () => {
    const canvas = createLayerCanvas(200, 100);
    const ctx = canvas.getContext("2d")!;
    const spy = vi.spyOn(ctx, "createLinearGradient");
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };

    createTextFillStyle(ctx, fill, 200, 100);

    expect(spy).toHaveBeenCalled();
  });

  it("calls createRadialGradient for radial gradient fill", () => {
    const canvas = createLayerCanvas(200, 100);
    const ctx = canvas.getContext("2d")!;
    const spy = vi.spyOn(ctx, "createRadialGradient");
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      stops: [
        { offset: 0, color: "#00ff00" },
        { offset: 1, color: "#ff00ff" },
      ],
      centerX: 0.25,
      centerY: 0.75,
    };

    createTextFillStyle(ctx, fill, 200, 100);

    expect(spy).toHaveBeenCalledWith(50, 75, 0, 50, 75, expect.any(Number));
  });
});

describe("renderTextLayer backward compatibility", () => {
  it("syncs fill from fillColor when fill is missing (legacy code path)", () => {
    // Simulate a text layer created by old code without fill
    const layer: TextLayer = {
      id: "text-compat",
      type: "text",
      name: "Compat",
      canvas: createLayerCanvas(1, 1),
      x: 0,
      y: 0,
      visible: true,
      opacity: 1,
      locked: false,
      textData: {
        text: "Hello",
        fontFamily: "Arial",
        fontSize: 24,
        lineHeight: 1.2,
        kerning: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        alignment: "left",
        fillColor: "#ff0000",
        bold: false,
        italic: false,
        boxWidth: null,
      } as any, // intentionally omitting fill/stroke to simulate legacy
    };

    renderTextLayer(layer);

    expect(layer.textData.fill).toEqual({ type: "solid", color: "#ff0000" });
    expect(layer.textData.stroke).toBeNull();
    expect(layer.fillColor).toBe("#ff0000");
  });

  it("syncs solid fill color when fillColor is changed by external code", () => {
    const layer = createTextLayer("Test", 0, 0);
    expect(layer.textData.fill).toEqual({ type: "solid", color: "#ffffff" });

    // Simulate inspector changing fillColor without updating fill
    layer.textData.fillColor = "#00ff00";
    renderTextLayer(layer);

    expect(layer.textData.fill).toEqual({ type: "solid", color: "#00ff00" });
    expect(layer.fillColor).toBe("#00ff00");
  });

  it("does not override gradient fill when fillColor changes", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const layer = createTextLayer("Gradient", 0, 0, { fill });

    // fillColor is derived from fill
    expect(layer.textData.fillColor).toBe("#ff0000");

    // Even if something writes fillColor, gradient fill is not overridden
    // (the sync only happens when fill.type is "solid")
    layer.textData.fillColor = "#999999";
    renderTextLayer(layer);

    // The gradient fill should remain unchanged
    expect(layer.textData.fill.type).toBe("linear-gradient");
    expect(layer.textData.fill).toEqual(fill);
  });
});

describe("text decoration: underline and strikethrough", () => {
  it("createTextLayer defaults underline and strikethrough to false", () => {
    const layer = createTextLayer("Plain", 0, 0);
    expect(layer.textData.underline).toBe(false);
    expect(layer.textData.strikethrough).toBe(false);
  });

  it("createTextLayer with underline: true produces a valid layer", () => {
    const layer = createTextLayer("Underlined", 0, 0, { underline: true });
    expect(layer.textData.underline).toBe(true);
    expect(layer.textData.strikethrough).toBe(false);
    expect(layer.type).toBe("text");
  });

  it("createTextLayer with strikethrough: true produces a valid layer", () => {
    const layer = createTextLayer("Struck", 0, 0, { strikethrough: true });
    expect(layer.textData.strikethrough).toBe(true);
    expect(layer.textData.underline).toBe(false);
    expect(layer.type).toBe("text");
  });

  it("renderTextLayer paints underline decoration pixels", () => {
    installPixelCanvasMock();
    const layer = createTextLayer("U", 0, 0, { underline: true, fontSize: 32 });
    renderTextLayer(layer);

    // The underline should be near y = fontSize * 0.92 ≈ 29
    const underlineY = Math.round(32 * 0.92);
    // Check that at least one pixel along the underline row is painted
    let found = false;
    for (let x = 0; x < layer.canvas.width; x++) {
      const pixel = readPixel(layer.canvas, x, underlineY);
      if (pixel.a > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("renderTextLayer paints strikethrough decoration pixels", () => {
    installPixelCanvasMock();
    const layer = createTextLayer("S", 0, 0, { strikethrough: true, fontSize: 32 });
    renderTextLayer(layer);

    // The strikethrough should be near y = fontSize * 0.55 ≈ 18
    const strikeY = Math.round(32 * 0.55);
    let found = false;
    for (let x = 0; x < layer.canvas.width; x++) {
      const pixel = readPixel(layer.canvas, x, strikeY);
      if (pixel.a > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("renderTextLayer does not paint decoration pixels when neither is set", () => {
    installPixelCanvasMock();
    // Use a single-character text to minimize glyph pixels
    const layerWithDecor = createTextLayer("I", 0, 0, { underline: true, fontSize: 32 });
    renderTextLayer(layerWithDecor);
    const layerWithout = createTextLayer("I", 0, 0, { underline: false, strikethrough: false, fontSize: 32 });
    renderTextLayer(layerWithout);

    // The underline row should differ between the two
    const underlineY = Math.round(32 * 0.92);
    let decorPixels = 0;
    let plainPixels = 0;
    const width = Math.min(layerWithDecor.canvas.width, layerWithout.canvas.width);
    for (let x = 0; x < width; x++) {
      if (readPixel(layerWithDecor.canvas, x, underlineY).a > 0) decorPixels++;
      if (readPixel(layerWithout.canvas, x, underlineY).a > 0) plainPixels++;
    }
    // The underlined version should have more opaque pixels in the underline row
    expect(decorPixels).toBeGreaterThan(plainPixels);
  });

  it("clips text overflow when boxHeight is fixed", () => {
    installPixelCanvasMock();
    const layer = createTextLayer("Clip", 0, 0, {
      text: "One Two Three Four Five Six Seven Eight",
      fontSize: 24,
      boxWidth: 80,
      boxHeight: 40,
    });

    renderTextLayer(layer);

    expect(layer.canvas.height).toBe(40);
    let hasBottomPixels = false;
    for (let x = 0; x < layer.canvas.width; x++) {
      if (readPixel(layer.canvas, x, layer.canvas.height - 1).a > 0) {
        hasBottomPixels = true;
        break;
      }
    }
    expect(hasBottomPixels).toBe(true);
  });

  it("serializes and deserializes boxHeight for text layers", async () => {
    const doc = createBlankDocument("Text Height", 200, 200, 100, "transparent");
    const textLayer = createTextLayer("Caption", 10, 20, {
      text: "Round-trip",
      boxWidth: 100,
      boxHeight: 72,
    });
    doc.layers.push(textLayer);

    const serialized = serializeDocument(doc);
    expect(serialized.layers[2].textData?.boxHeight).toBe(72);

    const restored = await deserializeDocument(serialized, null);
    const restoredLayer = restored.layers[2];
    expect(restoredLayer.type).toBe("text");
    if (restoredLayer.type === "text") {
      expect(restoredLayer.textData.boxHeight).toBe(72);
      expect(restoredLayer.textData.boxWidth).toBe(100);
    }
  });

  it("backward compat: old text data without underline/strikethrough defaults to false", () => {
    const layer: TextLayer = {
      id: "text-bc",
      type: "text",
      name: "Legacy",
      canvas: createLayerCanvas(1, 1),
      x: 0,
      y: 0,
      visible: true,
      opacity: 1,
      locked: false,
      textData: {
        text: "Hello",
        fontFamily: "Arial",
        fontSize: 24,
        lineHeight: 1.2,
        kerning: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        alignment: "left",
        fillColor: "#ffffff",
        bold: false,
        italic: false,
        boxWidth: null,
      } as any, // intentionally omitting underline/strikethrough/fill/stroke to simulate legacy
    };

    renderTextLayer(layer);

    expect(layer.textData.underline).toBe(false);
    expect(layer.textData.strikethrough).toBe(false);
  });

  it("compositing applies blendMode to the canvas context", () => {
    const doc = createBlankDocument("Blend", 100, 80, 100);
    doc.layers[1].blendMode = "multiply";
    const canvas = createLayerCanvas(100, 80);
    const ctx = canvas.getContext("2d")!;

    compositeDocumentOnto(ctx, doc, 0, 0, 1, null);

    expect(ctx.globalCompositeOperation).toBe("multiply");
  });

  it("compositing uses default source-over when blendMode is undefined", () => {
    const doc = createBlankDocument("Default", 100, 80, 100);
    // No blendMode set — should stay source-over
    const canvas = createLayerCanvas(100, 80);
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";

    compositeDocumentOnto(ctx, doc, 0, 0, 1, null);

    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("serializes and deserializes blendMode on layers", async () => {
    const doc = createBlankDocument("Blend", 100, 80, 100);
    doc.layers[1].blendMode = "screen";

    const serialized = serializeDocument(doc);
    expect(serialized.layers[1].blendMode).toBe("screen");

    const { deserializeDocument } = await import("./documents");
    const restored = await deserializeDocument(serialized, null);
    expect(restored.layers[1].blendMode).toBe("screen");
  });

  it("deserializes old documents without blendMode gracefully", async () => {
    const oldPayload: SerializedDocument = {
      name: "Legacy",
      width: 100,
      height: 80,
      zoom: 100,
      panX: 0,
      panY: 0,
      activeLayerId: "layer-1",
      history: ["Created"],
      sourcePath: null,
      background: "white",
      selectionRect: null,
      selectionInverted: false,
      layers: [
        {
          id: "bg",
          name: "Background",
          x: 0,
          y: 0,
          visible: true,
          opacity: 1,
          locked: false,
          isBackground: true,
          fillColor: "#ffffff",
          dataUrl: "data:image/png;base64,AAA",
        },
        {
          id: "layer-1",
          name: "Layer 1",
          x: 0,
          y: 0,
          visible: true,
          opacity: 1,
          locked: false,
          dataUrl: "data:image/png;base64,AAA",
          // No blendMode — simulates pre-blend-mode document
        },
      ],
    };

    const { deserializeDocument } = await import("./documents");
    const doc = await deserializeDocument(oldPayload, null);
    expect(doc.layers[1].blendMode).toBeUndefined();
  });

  it("cloneLayer preserves blendMode", () => {
    const doc = createBlankDocument("Clone", 100, 80, 100);
    doc.layers[1].blendMode = "overlay";
    const cloned = cloneLayer(doc.layers[1]);
    expect(cloned.blendMode).toBe("overlay");
  });
});

describe("customFonts serialization", () => {
  it("serializeDocument includes customFonts when present", () => {
    const doc = createBlankDocument("Fonts", 100, 100, 100);
    doc.customFonts = [
      { family: "My Font", dataUrl: "data:font/ttf;base64,AAA", fileName: "MyFont.ttf" },
    ];

    const serialized = serializeDocument(doc);

    expect(serialized.customFonts).toEqual([
      { family: "My Font", dataUrl: "data:font/ttf;base64,AAA", fileName: "MyFont.ttf" },
    ]);
  });

  it("serializeDocument omits customFonts when empty", () => {
    const doc = createBlankDocument("NoFonts", 100, 100, 100);

    const serialized = serializeDocument(doc);

    expect(serialized.customFonts).toBeUndefined();
  });

  it("deserializeDocument restores customFonts", async () => {
    const doc = createBlankDocument("Fonts", 100, 100, 100);
    doc.customFonts = [
      { family: "Test Sans", dataUrl: "data:font/ttf;base64,BBB", fileName: "TestSans.ttf" },
    ];

    const serialized = serializeDocument(doc);

    const { deserializeDocument } = await import("./documents");
    const restored = await deserializeDocument(serialized, null);

    expect(restored.customFonts).toEqual([
      { family: "Test Sans", dataUrl: "data:font/ttf;base64,BBB", fileName: "TestSans.ttf" },
    ]);
  });

  it("deserializeDocument defaults customFonts to empty for old documents", async () => {
    const oldPayload: SerializedDocument = {
      name: "Legacy",
      width: 100,
      height: 100,
      zoom: 100,
      panX: 0,
      panY: 0,
      activeLayerId: "bg",
      history: ["Created"],
      sourcePath: null,
      background: "white",
      selectionRect: null,
      selectionInverted: false,
      layers: [
        {
          id: "bg",
          name: "Background",
          x: 0,
          y: 0,
          visible: true,
          opacity: 1,
          locked: false,
          isBackground: true,
          dataUrl: "data:image/png;base64,AAA",
        },
      ],
      // No customFonts field — simulates old document
    };

    const { deserializeDocument } = await import("./documents");
    const doc = await deserializeDocument(oldPayload, null);

    expect(doc.customFonts).toEqual([]);
  });

  it("createBlankDocument initializes customFonts to empty array", () => {
    const doc = createBlankDocument("New", 200, 200, 100);
    expect(doc.customFonts).toEqual([]);
  });
});
