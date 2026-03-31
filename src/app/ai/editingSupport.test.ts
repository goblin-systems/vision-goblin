import { beforeEach, describe, expect, it, vi } from "vitest";
import { artifactToCanvas, buildEnhancementTask, buildGenerationTask, buildSegmentationTask, buildAiProvenance, buildScopedCompositeImageAsset, buildSelectedLayersImageAsset, buildSelectionMaskAsset } from "./editingSupport";
import * as documents from "../../editor/documents";
import type { DocumentState, RasterLayer } from "../../editor/types";

function makeLayer(id: string, visible = true): RasterLayer {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  return {
    id,
    type: "raster",
    name: id,
    canvas,
    x: 0,
    y: 0,
    visible,
    opacity: 1,
    locked: false,
    effects: [],
  };
}

function makeDocument(layers: RasterLayer[]): DocumentState {
  return {
    id: "doc-1",
    name: "Test",
    width: 200,
    height: 100,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: false,
    layers,
    activeLayerId: layers[0]?.id ?? "",
    selectedLayerIds: [],
    history: [],
    sourcePath: null,
    projectPath: null,
    background: "white",
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: null,
    selectionShape: "rect",
    selectionInverted: false,
    selectionPath: null,
    selectionMask: null,
    guides: [],
  };
}

interface MockCanvasContext {
  drawImage: ReturnType<typeof vi.fn>;
  createImageData: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
}

function createMockCanvasContext(imageData: ImageData): MockCanvasContext {
  return {
    drawImage: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => new ImageData(width, height)),
    getImageData: vi.fn(() => imageData),
    putImageData: vi.fn(),
  };
}

describe("ai editing support", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports selection masks as opaque black and white while preserving dimensions", () => {
    const originalCreateElement = document.createElement.bind(document);
    const doc = makeDocument([makeLayer("layer-a")]);
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 3;
    selectionMask.height = 2;

    const sourcePixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 0,
      255, 255, 255, 32,
      255, 255, 255, 0,
      255, 255, 255, 255,
      255, 255, 255, 0,
    ]);

    const sourceContext = createMockCanvasContext(new ImageData(sourcePixels, 3, 2));
    const exportedMask = document.createElement("canvas");
    const exportedContext = createMockCanvasContext(new ImageData(3, 2));
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContextSpy.mockImplementation(function (this: HTMLCanvasElement) {
      if (this === selectionMask) {
        return sourceContext as unknown as CanvasRenderingContext2D;
      }
      if (this === exportedMask) {
        return exportedContext as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    const dataUrlSpy = vi.spyOn(exportedMask, "toDataURL").mockReturnValue("data:image/png;base64,BINARY_MASK");
    const createElementSpy = vi.spyOn(document, "createElement");
    createElementSpy.mockImplementation(((tagName: string) => {
      if (tagName === "canvas") {
        return exportedMask;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    doc.selectionMask = selectionMask;

    const asset = buildSelectionMaskAsset(doc);

    expect(asset).toEqual({
      kind: "mask",
      mimeType: "image/png",
      data: "data:image/png;base64,BINARY_MASK",
      width: 3,
      height: 2,
    });
    expect(exportedMask.width).toBe(3);
    expect(exportedMask.height).toBe(2);
    expect(exportedContext.putImageData).toHaveBeenCalledTimes(1);
    const normalized = exportedContext.putImageData.mock.calls[0][0] as ImageData;
    expect(Array.from(normalized.data)).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    expect(dataUrlSpy).toHaveBeenCalledWith("image/png");
  });

  it("returns null when no selection mask exists", () => {
    const doc = makeDocument([makeLayer("layer-a")]);

    expect(buildSelectionMaskAsset(doc)).toBeNull();
  });

  it("builds segmentation tasks with the requested mode", () => {
    const task = buildSegmentationTask("object", {
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAA",
      width: 64,
      height: 32,
    }, "red mug");

    expect(task.family).toBe("segmentation");
    expect(task.options?.mode).toBe("object");
    expect(task.prompt).toBe("red mug");
  });

  it("builds enhancement tasks with intensity and scaling", () => {
    const task = buildEnhancementTask("upscale", {
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAA",
      width: 80,
      height: 60,
    }, { intensity: 0.7, scaleFactor: 2 });

    expect(task.options?.operation).toBe("upscale");
    expect(task.options?.intensity).toBe(0.7);
    expect(task.options?.scaleFactor).toBe(2);
  });

  it("creates provenance records from completed AI tasks", () => {
    const provenance = buildAiProvenance({
      ok: true,
      providerId: "openai-compatible",
      family: "generation",
      taskId: "task-1",
      model: "stub-deterministic-v2",
      artifacts: [],
      warnings: ["offline"],
    }, "style-transfer", "film look");

    expect(provenance.operation).toBe("style-transfer");
    expect(provenance.prompt).toBe("film look");
    expect(provenance.warnings).toEqual(["offline"]);
  });

  it("builds generation tasks with reference images", () => {
    const task = buildGenerationTask("expand the skyline", 1200, 800, [{
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAA",
    }]);

    expect(task.options?.width).toBe(1200);
    expect(task.input?.referenceImages).toHaveLength(1);
  });

  it("builds restore enhancement tasks with correct operation", () => {
    const task = buildEnhancementTask("restore", {
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,BBB",
      width: 200,
      height: 150,
    }, { intensity: 0.8 });

    expect(task.family).toBe("enhancement");
    expect(task.options?.operation).toBe("restore");
    expect(task.options?.intensity).toBe(0.8);
    expect(task.input.image.width).toBe(200);
  });

  it("builds generation tasks for thumbnail with specific dimensions and reference", () => {
    const task = buildGenerationTask("psychedelic background, surprised face with open mouth", 256, 256, [{
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,CCC",
      width: 1024,
      height: 768,
    }]);

    expect(task.family).toBe("generation");
    expect(task.prompt).toBe("psychedelic background, surprised face with open mouth");
    expect(task.options?.width).toBe(256);
    expect(task.options?.height).toBe(256);
    expect(task.input?.referenceImages).toHaveLength(1);
    expect(task.input?.referenceImages?.[0].width).toBe(1024);
  });

  it("artifactToCanvas uses expected output dimensions instead of returned natural size", async () => {
    const image = { naturalWidth: 300, naturalHeight: 200 } as HTMLImageElement;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      blob: async () => new Blob(["img"], { type: "image/png" }),
    } as Response);
    vi.spyOn(documents, "blobToImage").mockResolvedValue(image);

    const canvas = await artifactToCanvas({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAA",
    }, {
      expectedWidth: 800,
      expectedHeight: 600,
    });
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it("artifactToCanvas preserves aspect ratio by fitting on the longer expected side", async () => {
    const image = { naturalWidth: 1200, naturalHeight: 600 } as HTMLImageElement;
    const fittedCanvasContext = createMockCanvasContext(new ImageData(1, 1));
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContextSpy.mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
      if (contextId !== "2d") {
        return null;
      }
      if (this.width === 800 && this.height === 600) {
        return fittedCanvasContext as unknown as CanvasRenderingContext2D;
      }
      return originalGetContext.call(this, contextId) as CanvasRenderingContext2D | null;
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      blob: async () => new Blob(["img"], { type: "image/png" }),
    } as Response);
    vi.spyOn(documents, "blobToImage").mockResolvedValue(image);

    const canvas = await artifactToCanvas({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAA",
    }, {
      expectedWidth: 800,
      expectedHeight: 600,
    });

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(fittedCanvasContext.drawImage).toHaveBeenCalledWith(image, -200, 0, 1200, 600);
  });

  it("artifactToCanvas can extract a layer-sized region from a document-sized AI result", async () => {
    const image = { naturalWidth: 1200, naturalHeight: 600 } as HTMLImageElement;
    const fittedCanvasContext = createMockCanvasContext(new ImageData(1, 1));
    const extractedCanvasContext = createMockCanvasContext(new ImageData(1, 1));
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContextSpy.mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
      if (contextId !== "2d") {
        return null;
      }
      if (this.width === 800 && this.height === 600) {
        return fittedCanvasContext as unknown as CanvasRenderingContext2D;
      }
      if (this.width === 200 && this.height === 150) {
        return extractedCanvasContext as unknown as CanvasRenderingContext2D;
      }
      return originalGetContext.call(this, contextId) as CanvasRenderingContext2D | null;
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      blob: async () => new Blob(["img"], { type: "image/png" }),
    } as Response);
    vi.spyOn(documents, "blobToImage").mockResolvedValue(image);

    const canvas = await artifactToCanvas({
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,AAA",
    }, {
      expectedWidth: 800,
      expectedHeight: 600,
      extractRegion: { x: 50, y: 30, width: 200, height: 150 },
    });

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
    expect(fittedCanvasContext.drawImage).toHaveBeenCalledWith(image, -200, 0, 1200, 600);
    expect(extractedCanvasContext.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
      50,
      30,
      200,
      150,
      0,
      0,
      200,
      150,
    );
  });

  it("buildSelectedLayersImageAsset composites only the selected layers", () => {
    const selectedA = makeLayer("layer-a");
    const selectedB = makeLayer("layer-b");
    const unselected = makeLayer("layer-c");
    const doc = makeDocument([selectedA, selectedB, unselected]);
    doc.activeLayerId = selectedA.id;
    doc.selectedLayerIds = [selectedA.id, selectedB.id];

    const compositeSpy = vi.spyOn(documents, "compositeDocumentOnto");

    const asset = buildSelectedLayersImageAsset(doc);

    expect(asset.width).toBe(200);
    expect(asset.height).toBe(100);
    expect(compositeSpy).toHaveBeenCalledTimes(1);
    expect(compositeSpy.mock.calls[0][1].layers.map((layer) => layer.id)).toEqual(["layer-a", "layer-b"]);
  });

  it("buildScopedCompositeImageAsset returns selected-layers asset metadata", () => {
    const doc = makeDocument([makeLayer("layer-a")]);
    const selectedSpy = vi.spyOn(documents, "compositeDocumentOnto");

    const result = buildScopedCompositeImageAsset(doc, "selected-layers");

    expect(result.inputScope).toBe("selected-layers");
    expect(result.debugLabel).toBe("selected-layers");
    expect(result.asset.width).toBe(200);
    expect(selectedSpy).toHaveBeenCalledTimes(1);
  });
});
