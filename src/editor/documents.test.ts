import { describe, expect, it, vi } from "vitest";
import { canDeleteLayer } from "./layers";
import { buildTransformPreview, cloneDocument, createBlankDocument, createLayerCanvas, createLayerThumb, resizeCanvasDocument, serializeDocument } from "./documents";
import { getResizeOffset } from "./geometry";
import type { TransformDraft } from "./types";

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
});
