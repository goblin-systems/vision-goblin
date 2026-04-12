import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { DocumentState, Layer, RasterLayer } from "../../editor/types";
import { installPixelCanvasMock, readPixel, setPixel } from "../../test/pixelCanvasMock";
import type { AiController } from "./controller";
import type { AiInpaintingTask, AiImageAsset, AiMaskAsset, AiSegmentationTask, AiTask, AiTextReplacementTask } from "./types";
import type { AiJobRecord } from "./jobQueue";
import type { AiTaskSuccess } from "./contracts";
import type { LayerLocalBounds } from "../../editor/documents";

/* ------------------------------------------------------------------ */
/* hoisted mocks – must be declared before vi.mock calls              */
/* ------------------------------------------------------------------ */

const editingSupportMocks = vi.hoisted(() => ({
  buildCompositeImageAsset: vi.fn((_doc: DocumentState): AiImageAsset => ({
    kind: "image",
    mimeType: "image/png",
    data: "data:image/png;base64,COMPOSITE",
    width: 800,
    height: 600,
  })),
  buildScopedCompositeImageAsset: vi.fn((_doc: DocumentState, inputScope: "selected-layers" | "visible-content") => ({
    asset: {
      kind: "image" as const,
      mimeType: "image/png",
      data: inputScope === "selected-layers"
        ? "data:image/png;base64,SELECTED"
        : "data:image/png;base64,COMPOSITE",
      width: 800,
      height: 600,
    },
    inputScope,
    debugLabel: inputScope === "selected-layers" ? "selected-layers" as const : "composite" as const,
  })),
  buildLayerImageAsset: vi.fn((_layer: Layer): AiImageAsset => ({
    kind: "image",
    mimeType: "image/png",
    data: "data:image/png;base64,LAYER",
    width: 200,
    height: 150,
  })),
  buildRasterLayerContentImageAsset: vi.fn((_layer: Layer): { asset: AiImageAsset; boundsLocal: LayerLocalBounds | null } => ({
    asset: {
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,LAYER_CONTENT",
      width: 80,
      height: 24,
    },
    boundsLocal: { x: 120, y: 80, width: 80, height: 24 },
  })),
  buildSelectionMaskAsset: vi.fn((_doc: DocumentState): AiMaskAsset | null => ({
    kind: "mask",
    mimeType: "image/png",
    data: "data:image/png;base64,MASK",
    width: 800,
    height: 600,
  })),
  buildMaskAssetFromCanvas: vi.fn((_canvas: HTMLCanvasElement | null): AiMaskAsset | null => ({
    kind: "mask",
    mimeType: "image/png",
    data: "data:image/png;base64,MASK",
    width: 800,
    height: 600,
  })),
  createGuideMaskUnion: vi.fn(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    return canvas;
  }),
  buildDualColorAiMaskAsset: vi.fn((): AiImageAsset | null => ({
    kind: "image",
    mimeType: "image/png",
    data: "data:image/png;base64,GUIDE",
    width: 800,
    height: 600,
  })),
  buildDualColorGuideMaskAsset: vi.fn((guideMode: string, casterMask: HTMLCanvasElement | null, surfaceMask: HTMLCanvasElement | null): AiMaskAsset | null => {
    if (!surfaceMask) {
      return null;
    }
    if ((guideMode === "shadow-add" || guideMode === "reflection-add" || guideMode === "clone-object" || guideMode === "move-object") && !casterMask) {
      return null;
    }
    return {
      kind: "mask",
      mimeType: "image/png",
      data: "data:image/png;base64,GUIDE",
      width: 800,
      height: 600,
    };
  }),
  buildGuideImageAssetForMode: vi.fn((guideMode: string, casterMask: HTMLCanvasElement | null, surfaceMask: HTMLCanvasElement | null): AiImageAsset | null => {
    if (!surfaceMask) {
      return null;
    }
    if ((guideMode === "shadow-add" || guideMode === "reflection-add" || guideMode === "clone-object" || guideMode === "move-object") && !casterMask) {
      return null;
    }
    return {
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,GUIDE",
      width: 800,
      height: 600,
    };
  }),
  buildInpaintingTask: vi.fn((image: AiImageAsset, mask: AiMaskAsset, prompt: string, mode: string, options?: { guideMode?: "shadow-add" | "shadow-remove" | "reflection-add" | "reflection-remove" | "clone-object" | "move-object" | "heal" }): AiInpaintingTask => ({
    id: "ai-inpaint-test",
    family: "inpainting",
    prompt,
    input: { image, mask },
    options: { mode: mode as "remove" | "replace", guideMode: options?.guideMode },
  })),
  buildSegmentationTask: vi.fn((mode: string, image: AiImageAsset, prompt?: string): AiSegmentationTask => ({
    id: `ai-seg-${mode}`,
    family: "segmentation",
    prompt,
    input: { image },
    options: { mode: mode as "subject" | "background" | "object" | "background-removal" },
  })),
  buildEnhancementTask: vi.fn((operation: string, image: AiImageAsset, options?: { intensity?: number; scaleFactor?: number; prompt?: string; referenceImages?: AiImageAsset[] }) => ({
    id: `ai-enh-${operation}`,
    family: "enhancement" as const,
    prompt: options?.prompt,
    input: {
      image,
      referenceImages: options?.referenceImages,
    },
    options: {
      operation: operation as "auto-enhance" | "upscale" | "denoise" | "restore" | "colorize" | "style-transfer",
      intensity: options?.intensity,
      scaleFactor: options?.scaleFactor,
    },
  })),
  buildGenerationTask: vi.fn(),
  buildTextReplacementTask: vi.fn((image: AiImageAsset, mask: AiMaskAsset, prompt: string): AiTextReplacementTask => ({
    id: "ai-text-replacement-test",
    family: "text-replacement",
    prompt,
    input: { image, mask },
  })),
  canvasToImageAsset: vi.fn((canvas: HTMLCanvasElement): AiImageAsset => ({
    kind: "image",
    mimeType: "image/png",
    data: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  })),
  buildAiProvenance: vi.fn((_result: AiTaskSuccess, operation: string, prompt?: string) => ({
    providerId: "test",
    model: "test-model",
    taskId: "test-task",
    family: "inpainting",
    operation,
    prompt,
    warnings: [],
    createdAt: new Date().toISOString(),
  })),
  getImageArtifact: vi.fn((_result: AiTaskSuccess) => ({
    kind: "image" as const,
    mimeType: "image/png",
    data: "data:image/png;base64,RESULT",
    width: 800,
    height: 600,
  })),
  getJsonArtifact: vi.fn((result: AiTaskSuccess) => result.artifacts.find((artifact) => artifact.kind === "json") ?? null),
  getMaskArtifact: vi.fn(),
  artifactToCanvas: vi.fn(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    return canvas;
  }),
  replaceLayerWithCanvas: vi.fn(),
  addRasterLayerFromCanvas: vi.fn(),
  applyMaskToLayer: vi.fn(),
  applyMaskToSelection: vi.fn(),
  buildCutoutCanvas: vi.fn(),
  buildBackgroundComposite: vi.fn(),
  readReferenceImages: vi.fn(),
  splitMaskIntoConnectedComponents: vi.fn(() => [{
    canvas: document.createElement("canvas"),
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    pixelCount: 10,
  }]),
  waitForJob: vi.fn(),
}));

const promptMocks = vi.hoisted(() => ({
  aiPromptText: vi.fn(async () => "test prompt"),
  aiPromptTextWithInputScope: vi.fn(async (): Promise<{ prompt: string; inputScope: "selected-layers" | "visible-content" }> => ({ prompt: "test prompt", inputScope: "selected-layers" })),
  aiPromptSelect: vi.fn(),
  aiPromptReviewText: vi.fn(async (): Promise<{ text: string } | null> => ({ text: "test prompt" })),
  aiPromptReviewTextPieces: vi.fn(async (title: string, message: string, pieces: Array<{ id: string; text: string }>) => pieces.map((piece) => ({ ...piece, text: `${piece.text} reviewed` }))),
  aiPromptOutpaintWithInputScope: vi.fn(),
  aiPromptEnhancement: vi.fn(),
  aiPromptRemoveBackgroundWithInputScope: vi.fn(),
  aiPromptThumbnailWithInputScope: vi.fn(),
}));

vi.mock("./editingSupport", () => editingSupportMocks);
vi.mock("./aiPromptModal", () => promptMocks);

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSuccessResponse(): AiTaskSuccess {
  return {
    ok: true,
    providerId: "openai-compatible",
    family: "inpainting",
    taskId: "task-123",
    model: "test-model",
    artifacts: [{
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,RESULT",
      width: 800,
      height: 600,
    }],
    warnings: [],
  };
}

function makeCompletedJob(response: AiTaskSuccess): AiJobRecord {
  return {
    id: "job-1",
    title: "test",
    kind: "task",
    status: "completed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptedProviderIds: ["openai-compatible"],
    attemptCount: 1,
    canRetry: false,
    canCancel: false,
    message: "Done",
    taskResult: {
      ok: true,
      attemptedProviderIds: ["openai-compatible"],
      primaryProviderId: "openai-compatible",
      fallbackProviderIds: [],
      fallbackUsed: false,
      degradedMode: false,
      response,
    },
  };
}

function makeLayer(overrides: Partial<RasterLayer> = {}): RasterLayer {
  const canvas = document.createElement("canvas");
  canvas.width = overrides.canvas?.width ?? 200;
  canvas.height = overrides.canvas?.height ?? 150;
  return {
    id: "layer-1",
    type: "raster",
    name: "Test Layer",
    canvas,
    x: 50,
    y: 30,
    visible: true,
    opacity: 1,
    locked: false,
    effects: [],
    ...overrides,
  };
}

function makeDocument(layer: RasterLayer): DocumentState {
  const selectionMask = document.createElement("canvas");
  selectionMask.width = 800;
  selectionMask.height = 600;
  setPixel(selectionMask, 120, 120, { r: 255, g: 255, b: 255, a: 255 });

  return {
    id: "doc-1",
    name: "Test",
    width: 800,
    height: 600,
    zoom: 1,
    panX: 0,
    panY: 0,
    dirty: false,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    history: [],
    historyIndex: 0,
    sourcePath: null,
    projectPath: null,
    background: "white",
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: { x: 100, y: 100, width: 200, height: 200 },
    selectionShape: "rect",
    selectionInverted: false,
    selectionPath: null,
    selectionMask,
    guides: [],
    customFonts: [],
  };
}

function makeStructuredTextResponse(blocks: unknown[]): AiTaskSuccess {
  return {
    ok: true,
    providerId: "openai-compatible",
    family: "text-replacement",
    taskId: "text-reconstruction-task-123",
    model: "test-model",
    artifacts: [{
      kind: "json",
      role: "text-reconstruction",
      mimeType: "application/json",
      text: JSON.stringify({
        schemaVersion: "f4.2/v1",
        blocks,
      }),
    }],
    warnings: [],
  };
}

/** Combined text-replacement response: one response with both a cleaned image artifact and a structured JSON artifact. */
function makeCombinedTextReplacementResponse(blocks: unknown[]): AiTaskSuccess {
  return {
    ok: true,
    providerId: "openai-compatible",
    family: "text-replacement",
    taskId: "text-replacement-task-123",
    model: "test-model",
    artifacts: [
      {
        kind: "image",
        mimeType: "image/png",
        data: "data:image/png;base64,CLEANED",
        width: 800,
        height: 600,
      },
      {
        kind: "json",
        role: "text-reconstruction",
        mimeType: "application/json",
        text: JSON.stringify({
          schemaVersion: "f4.2/v1",
          blocks,
        }),
      },
    ],
    warnings: [],
  };
}

/** Inpainting-only response for stage 1 of two-stage text replacement. */
function makeInpaintingResponse(): AiTaskSuccess {
  return {
    ok: true,
    providerId: "openai-compatible",
    family: "inpainting",
    taskId: "inpainting-task-123",
    model: "test-model",
    artifacts: [{
      kind: "image",
      mimeType: "image/png",
      data: "data:image/png;base64,CLEANED",
      width: 800,
      height: 600,
    }],
    warnings: [],
  };
}

/** Text-reconstruction-only response for stage 2 of two-stage text replacement. */
function makeTextReconstructionResponse(blocks: unknown[]): AiTaskSuccess {
  return {
    ok: true,
    providerId: "openai-compatible",
    family: "text-replacement",
    taskId: "text-reconstruction-task-456",
    model: "test-model",
    artifacts: [{
      kind: "json",
      role: "text-reconstruction",
      mimeType: "application/json",
      text: JSON.stringify({
        schemaVersion: "f4.2/v1",
        blocks,
      }),
    }],
    warnings: [],
  };
}

/** Sets up mock jobs for the two-stage text replacement flow (inpainting + text reconstruction). */
function setupTwoStageTextReplacementMocks(aiCtrl: AiController, blocks: unknown[]) {
  const inpaintingJob = makeCompletedJob(makeInpaintingResponse());
  const reconstructionJob = makeCompletedJob(makeTextReconstructionResponse(blocks));
  editingSupportMocks.waitForJob
    .mockResolvedValueOnce(inpaintingJob)
    .mockResolvedValueOnce(reconstructionJob);
  (aiCtrl.queueTask as Mock)
    .mockReturnValueOnce(inpaintingJob)
    .mockReturnValueOnce(reconstructionJob);
}

function makeCaptioningResponse(text: string): AiTaskSuccess {
  return {
    ok: true,
    providerId: "openai-compatible",
    family: "captioning",
    taskId: "caption-task-123",
    model: "test-model",
    artifacts: [{
      kind: "text",
      role: "caption",
      text,
    }],
    warnings: [],
  };
}

function makePaintedMaskCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  setPixel(canvas, 10, 10, { r: 255, g: 255, b: 255, a: 255 });
  return canvas;
}

/** Creates a mask canvas with painted pixels that overlap the default layer bounds (x:50, y:30, w:200, h:150). */
function makeOverlappingMaskCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  setPixel(canvas, 100, 100, { r: 255, g: 255, b: 255, a: 255 });
  return canvas;
}

function makeMaskSessionResult(overrides?: Partial<{
  guideMode: "shadow-add" | "shadow-remove" | "reflection-add" | "reflection-remove" | "clone-object" | "move-object" | "inpaint" | "remove-object" | "replace-text" | "heal" | "denoise";
  intensity: number;
  lightDirection: "auto" | "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left" | "top-left";
  inputScope: "selected-layers" | "visible-content";
  surfaceMask: HTMLCanvasElement;
}>) {
  return {
    guideMode: overrides?.guideMode ?? "shadow-add",
    intensity: overrides?.intensity ?? 50,
    lightDirection: overrides?.lightDirection ?? "auto",
    inputScope: overrides?.inputScope ?? "visible-content",
    casterMask: makePaintedMaskCanvas(),
    surfaceMask: overrides?.surfaceMask ?? makePaintedMaskCanvas(),
  };
}

function makeMockAiController(): AiController {
  return {
    bind: vi.fn(),
    render: vi.fn(),
    focusSettings: vi.fn(async () => {}),
    focusJobs: vi.fn(async () => {}),
    subscribeJobs: vi.fn(() => () => {}),
    getJob: vi.fn(() => null),
    queueTask: vi.fn(() => makeCompletedJob(makeSuccessResponse())),
    queueValidation: vi.fn(() => makeCompletedJob(makeSuccessResponse())),
    discoverModels: vi.fn(async () => {}),
  };
}

/* ------------------------------------------------------------------ */
/* tests                                                              */
/* ------------------------------------------------------------------ */

describe("AI editing controller – inpainting coordinate alignment", () => {
  let layer: RasterLayer;
  let doc: DocumentState;
  let aiController: AiController;

  beforeEach(() => {
    vi.clearAllMocks();
    installPixelCanvasMock();
    layer = makeLayer({ x: 50, y: 30 });
    doc = makeDocument(layer);
    aiController = makeMockAiController();

    const response = makeSuccessResponse();
    editingSupportMocks.waitForJob.mockResolvedValue(makeCompletedJob(response));
  });

  describe("inpaintSelection", () => {
    it("uses the mask session input scope and no longer opens a duplicate scope prompt", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "inpaint" }));
      expect(promptMocks.aiPromptText).toHaveBeenCalledWith(
        "AI: Inpaint Selection",
        "Describe what should replace the selected area",
        "add a hat and sunglasses",
      );
      expect(promptMocks.aiPromptTextWithInputScope).not.toHaveBeenCalled();
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        expect.anything(),
        expect.any(String),
        "replace",
      );
      expect(editingSupportMocks.buildLayerImageAsset).not.toHaveBeenCalled();
    });

    it("sends selected layers when the session chooses selected layers", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));

      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        expect.anything(),
        expect.any(String),
        "replace",
      );
    });

    it("preserves layer coordinates after inpainting", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint" }));
      const { createAiEditingController } = await import("./editingController");

      expect(layer.x).toBe(50);
      expect(layer.y).toBe(30);

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(layer.x).toBe(50);
      expect(layer.y).toBe(30);
    });

    it("calls replaceLayerWithCanvas with the AI result", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(editingSupportMocks.artifactToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          expectedWidth: 800,
          expectedHeight: 600,
          extractRegion: { x: 50, y: 30, width: 200, height: 150 },
        }),
      );
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Inpaint Selection",
        expect.objectContaining({ operation: "inpainting" }),
      );
    });
  });

  describe("removeObject", () => {
    it("sends visible content by default when using a session", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "remove-object" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeObject();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "remove-object" }));
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "remove",
      );
      expect(editingSupportMocks.buildLayerImageAsset).not.toHaveBeenCalled();
    });

    it("preserves layer coordinates after object removal", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "remove-object" }));
      const { createAiEditingController } = await import("./editingController");

      expect(layer.x).toBe(50);
      expect(layer.y).toBe(30);

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeObject();

      expect(layer.x).toBe(50);
      expect(layer.y).toBe(30);
    });

    it("uses selected layers when session chooses that scope", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "remove-object", inputScope: "selected-layers" }));

      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeObject();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        expect.anything(),
        expect.any(String),
        "remove",
      );
    });

    it("calls replaceLayerWithCanvas with the AI result", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "remove-object" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeObject();

      expect(editingSupportMocks.artifactToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          expectedWidth: 800,
          expectedHeight: 600,
          extractRegion: { x: 50, y: 30, width: 200, height: 150 },
        }),
      );
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Remove Object",
        expect.objectContaining({ operation: "remove-object" }),
      );
    });
  });

  describe("replaceRasterText", () => {
    it("reconstructs the selected region from structured JSON, reviews text, then inserts an editable text layer", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Original\nText",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const renderEditorState = vi.fn();
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas() }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState,
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(promptMocks.aiPromptReviewText).toHaveBeenCalledWith(
        "AI: Replace Raster Text",
        "Review and edit the reconstructed text before applying. Handwriting, curved, and decorative text may need manual correction.",
        "Original\nText",
      );
      expect(editingSupportMocks.buildTextReplacementTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
      );
      expect(doc.layers).toHaveLength(2);
      expect(doc.layers[1]?.type).toBe("text");
      expect(doc.activeLayerId).toBe(doc.layers[1]?.id);
      expect(doc.layers[1]?.type === "text" ? doc.layers[1].textData.text : null).toBe("test prompt");
      expect(renderEditorState).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith("Raster text replaced with an editable text layer.", "success");
    });

    it("uses full raster layer bounds when no mask is painted", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Original\nText",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const renderEditorState = vi.fn();
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const blankMask = document.createElement("canvas");
      blankMask.width = 800;
      blankMask.height = 600;
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: blankMask }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState,
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(editingSupportMocks.buildTextReplacementTask).toHaveBeenCalledTimes(1);
      expect(renderEditorState).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith("Raster text replaced with an editable text layer.", "success");
    });

    it("cancels without document changes when the review modal is dismissed", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Original Text",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);
      promptMocks.aiPromptReviewText.mockResolvedValueOnce(null);

      const renderEditorState = vi.fn();
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas() }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState,
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(editingSupportMocks.buildTextReplacementTask).toHaveBeenCalledTimes(1);
      expect(doc.layers).toHaveLength(1);
      expect(doc.activeLayerId).toBe(layer.id);
      expect(renderEditorState).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith("Raster text replacement cancelled.", "info");
    });

    it("uses structured grouping for nearby differently styled blocks and inserts multiple editable layers", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "piece-1",
          text: "First",
          bounds: { x: 10, y: 10, width: 35, height: 18 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
        {
          id: "piece-2",
          text: "Second",
          bounds: { x: 90, y: 10, width: 45, height: 18 },
          style: { fill: { type: "solid", color: "#d62828" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const { createAiEditingController } = await import("./editingController");

      layer.canvas.width = 300;
      layer.canvas.height = 120;
      layer.x = 100;
      layer.y = 100;
      const layerCtx = layer.canvas.getContext("2d");
      if (!layerCtx) {
        throw new Error("Expected layer context");
      }
      layerCtx.fillStyle = "#111111";
      layerCtx.fillRect(10, 10, 35, 18);
      layerCtx.fillStyle = "#d62828";
      layerCtx.fillRect(90, 10, 45, 18);

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas() }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(promptMocks.aiPromptReviewText).not.toHaveBeenCalled();
      expect(promptMocks.aiPromptReviewTextPieces).toHaveBeenCalledWith(
        "AI: Replace Raster Text",
        "Review and edit each reconstructed text block before applying. Handwriting, curved, and decorative text may need manual correction.",
        [
          { id: "piece-1", text: "First" },
          { id: "piece-2", text: "Second" },
        ],
      );
      const textLayers = doc.layers.filter((entry) => entry.type === "text");
      expect(textLayers).toHaveLength(2);
      expect(textLayers[0]?.type === "text" ? textLayers[0].textData.text : null).toBe("First reviewed");
      expect(textLayers[1]?.type === "text" ? textLayers[1].textData.text : null).toBe("Second reviewed");
      expect(textLayers[0]?.type === "text" ? textLayers[0].textData.fillColor : null).toBe("#111111");
      expect(textLayers[1]?.type === "text" ? textLayers[1].textData.fillColor : null).toBe("#d62828");
      expect(doc.selectedLayerIds).toEqual(textLayers.map((entry) => entry.id));
    });

    it("fails closed on malformed structured JSON without document mutation", async () => {
      const malformedTextReconResponse: AiTaskSuccess = {
        ok: true,
        providerId: "openai-compatible",
        family: "text-replacement",
        taskId: "text-replacement-task-malformed",
        model: "test-model",
        artifacts: [
          {
            kind: "json",
            role: "text-reconstruction",
            mimeType: "application/json",
            text: "{ not-json }",
          },
        ],
        warnings: [],
      };
      const inpaintingJob = makeCompletedJob(makeInpaintingResponse());
      const malformedJob = makeCompletedJob(malformedTextReconResponse);
      editingSupportMocks.waitForJob
        .mockResolvedValueOnce(inpaintingJob)
        .mockResolvedValueOnce(malformedJob);
      (aiController.queueTask as Mock)
        .mockReturnValueOnce(inpaintingJob)
        .mockReturnValueOnce(malformedJob);
      const showToast = vi.fn();

      const { createAiEditingController } = await import("./editingController");

      layer.canvas.width = 300;
      layer.canvas.height = 120;
      layer.x = 100;
      layer.y = 100;
      const layerCtx = layer.canvas.getContext("2d");
      if (!layerCtx) {
        throw new Error("Expected layer context");
      }
      layerCtx.fillStyle = "#111111";
      layerCtx.fillRect(10, 10, 90, 20);

      editingSupportMocks.artifactToCanvas.mockImplementationOnce(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 300;
        canvas.height = 120;
        return canvas;
      });

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas() }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(promptMocks.aiPromptReviewText).not.toHaveBeenCalled();
      expect(promptMocks.aiPromptReviewTextPieces).not.toHaveBeenCalled();
      expect(doc.layers).toHaveLength(1);
      expect(showToast).toHaveBeenCalledWith("AI text reconstruction returned invalid JSON.", "error");
    });

    it("keeps single-block review behavior when structured response has one block", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "single",
          text: "Single block",
          bounds: { x: 10, y: 10, width: 90, height: 20 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas() }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(promptMocks.aiPromptReviewText).toHaveBeenCalledWith(
        "AI: Replace Raster Text",
        "Review and edit the reconstructed text before applying. Handwriting, curved, and decorative text may need manual correction.",
        "Single block",
      );
      expect(promptMocks.aiPromptReviewTextPieces).not.toHaveBeenCalled();
      const textLayers = doc.layers.filter((entry) => entry.type === "text");
      expect(textLayers).toHaveLength(1);
      expect(textLayers[0]?.type === "text" ? textLayers[0].textData.text : null).toBe("test prompt");
    });

    it("uses selected-layers scope when the mask session chooses it", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Original Text",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas(), inputScope: "selected-layers" }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({
        guideMode: "replace-text",
        defaults: expect.objectContaining({ inputScope: "selected-layers" }),
      }));
      expect(editingSupportMocks.buildScopedCompositeImageAsset).not.toHaveBeenCalled();
      expect(editingSupportMocks.buildLayerImageAsset).not.toHaveBeenCalled();
      expect(editingSupportMocks.buildRasterLayerContentImageAsset).toHaveBeenCalledWith(layer);
    });

    it("layer-scope uses cropped content dimensions for cleaned image instead of document dimensions", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Original Text",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      editingSupportMocks.artifactToCanvas.mockImplementationOnce(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 24;
        return canvas;
      });

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas(), inputScope: "selected-layers" }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(editingSupportMocks.artifactToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          expectedWidth: 80,
          expectedHeight: 24,
        }),
      );
      expect(editingSupportMocks.artifactToCanvas).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          expectedWidth: 800,
          expectedHeight: 600,
        }),
      );
    });

    it("layer-scope offsets text blocks by layer position instead of selection bounds", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Offset Test",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      editingSupportMocks.artifactToCanvas.mockImplementationOnce(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 24;
        return canvas;
      });

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas(), inputScope: "selected-layers" }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      // layer.x = 50, layer.y = 30
      // contentBoundsLocal = { x: 120, y: 80 }
      // block.bounds.x = 10, block.bounds.y = 12
      // For layer-scope, normalizedBlock.bounds = { x: 10 + 50 + 120, y: 12 + 30 + 80 } = { x: 180, y: 122 }
      // createTextLayer places the layer at Math.round(normalizedBlock.bounds.x/y)
      const textLayer = doc.layers.find((entry) => entry.type === "text");
      expect(textLayer).toBeDefined();
      expect(textLayer!.x).toBe(180);
      expect(textLayer!.y).toBe(122);
    });

    it("layer-scope translates the mask into cropped-content coordinates", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Mask Shift",
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, 170, 110, { r: 255, g: 255, b: 255, a: 255 });

      const capturedMasks: HTMLCanvasElement[] = [];
      editingSupportMocks.buildMaskAssetFromCanvas.mockImplementation((canvas: HTMLCanvasElement | null) => {
        if (canvas) {
          capturedMasks.push(canvas);
        }
        return canvas
          ? {
            kind: "mask",
            mimeType: "image/png",
            data: "data:image/png;base64,MASK",
            width: canvas.width,
            height: canvas.height,
          }
          : null;
      });

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: sourceMask, inputScope: "selected-layers" }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      const translatedMask = capturedMasks[capturedMasks.length - 1];
      expect(translatedMask?.width).toBe(80);
      expect(translatedMask?.height).toBe(24);
      const translatedCtx = translatedMask?.getContext("2d");
      expect(translatedCtx).not.toBeNull();
      const alpha = translatedCtx?.getImageData(0, 0, translatedMask!.width, translatedMask!.height).data[3];
      expect(alpha).toBe(255);
    });

    it("layer-scope does not pass extractRegion to artifactToCanvas for cleaned image", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "No Extract",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      editingSupportMocks.artifactToCanvas.mockImplementationOnce(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 24;
        return canvas;
      });

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas(), inputScope: "selected-layers" }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      // For layer-scope the cleaned image is already layer-sized, so artifactToCanvas
      // should receive layer dimensions and NO extractRegion option.
      const artifactCalls = editingSupportMocks.artifactToCanvas.mock.calls;
      expect(artifactCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = artifactCalls[artifactCalls.length - 1] as unknown[];
      const options = lastCall[1] as Record<string, unknown> | undefined;
      expect(options).toBeDefined();
      expect(options!.expectedWidth).toBe(80);
      expect(options!.expectedHeight).toBe(24);
      expect(options).not.toHaveProperty("extractRegion");
    });

    it("doc-scope uses document dimensions and calls extractCanvasRegion for cleaned image", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Doc Scope Test",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
        },
      ]);

      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas(), inputScope: "visible-content" }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      // For doc-scope, artifactToCanvas should receive document dimensions
      expect(editingSupportMocks.artifactToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          expectedWidth: 800,
          expectedHeight: 600,
        }),
      );
      // And buildScopedCompositeImageAsset should be used instead of buildLayerImageAsset
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildLayerImageAsset).not.toHaveBeenCalled();
    });

    it("includes confidence and notes in the single-block review message", async () => {
      setupTwoStageTextReplacementMocks(aiController, [
        {
          id: "block-1",
          text: "Original",
          bounds: { x: 10, y: 12, width: 120, height: 30 },
          style: { fill: { type: "solid", color: "#111111" } },
          transform: { rotationDeg: 0, scaleX: 1, scaleY: 1, skewXDeg: 0, skewYDeg: 0 },
          confidence: 0.85,
          notes: "partially obscured",
        },
      ]);

      const renderEditorState = vi.fn();
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "replace-text", surfaceMask: makeOverlappingMaskCanvas() }));
      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState,
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.replaceRasterText();

      expect(promptMocks.aiPromptReviewText).toHaveBeenCalledWith(
        "AI: Replace Raster Text",
        expect.stringContaining("Confidence: 85%"),
        "Original",
      );
      expect(promptMocks.aiPromptReviewText).toHaveBeenCalledWith(
        "AI: Replace Raster Text",
        expect.stringContaining("Note: partially obscured"),
        "Original",
      );
    });
  });

  describe("aiHealing", () => {
    it("opens the shared healing mask session and runs a single inpainting pass", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "heal", inputScope: "selected-layers", surfaceMask: makeOverlappingMaskCanvas() }));
      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, 170, 110, { r: 255, g: 255, b: 255, a: 255 });
      startAiMaskSession.mockResolvedValueOnce(makeMaskSessionResult({
        guideMode: "heal",
        inputScope: "selected-layers",
        surfaceMask: sourceMask,
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.aiHealing();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "heal" }));
      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({
        defaults: expect.objectContaining({ inputScope: "selected-layers" }),
      }));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,LAYER_CONTENT" }),
        expect.anything(),
        expect.stringContaining("Heal and reconstruct the masked region naturally"),
        "replace",
      );
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Healing",
        expect.objectContaining({ operation: "healing" }),
      );
    });

    it("rejects a blank healing mask", async () => {
      const blankMask = document.createElement("canvas");
      blankMask.width = 800;
      blankMask.height = 600;
      const showToast = vi.fn();
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "heal", surfaceMask: blankMask }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.aiHealing();

      expect(showToast).toHaveBeenCalledWith("Paint or select the area to heal before continuing.", "error");
      expect(editingSupportMocks.buildInpaintingTask).not.toHaveBeenCalled();
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });

    it("uses selected-layers scope and applies the result as an undoable AI raster edit", async () => {
      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, 170, 110, { r: 255, g: 255, b: 255, a: 255 });
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "heal",
        inputScope: "selected-layers",
        surfaceMask: sourceMask,
      }));
      const renderEditorState = vi.fn();
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState,
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.aiHealing();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).not.toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildRasterLayerContentImageAsset).toHaveBeenCalledWith(layer);
      expect(showToast).toHaveBeenCalledWith("Healing applied.", "success");
    });

    it("preserves unmasked pixels when healing writes back in visible-content scope", async () => {
      setPixel(layer.canvas, 2, 2, { r: 10, g: 20, b: 30, a: 255 });
      setPixel(layer.canvas, 3, 2, { r: 40, g: 50, b: 60, a: 255 });

      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, layer.x + 2, layer.y + 2, { r: 255, g: 255, b: 255, a: 255 });

      editingSupportMocks.artifactToCanvas.mockImplementationOnce(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        setPixel(canvas, layer.x + 2, layer.y + 2, { r: 200, g: 210, b: 220, a: 255 });
        setPixel(canvas, layer.x + 3, layer.y + 2, { r: 150, g: 160, b: 170, a: 255 });
        return canvas;
      });

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "heal",
        inputScope: "visible-content",
        surfaceMask: sourceMask,
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.aiHealing();

      const mergedCanvas = editingSupportMocks.replaceLayerWithCanvas.mock.calls[0]?.[2] as HTMLCanvasElement | undefined;
      expect(mergedCanvas).toBeInstanceOf(HTMLCanvasElement);
      expect(readPixel(mergedCanvas!, 2, 2)).toMatchObject({ r: 200, g: 210, b: 220, a: 255 });
      expect(readPixel(mergedCanvas!, 3, 2)).toMatchObject({ r: 40, g: 50, b: 60, a: 255 });
    });

    it("preserves unmasked pixels when healing writes back in selected-layers scope", async () => {
      setPixel(layer.canvas, 120, 80, { r: 10, g: 20, b: 30, a: 255 });
      setPixel(layer.canvas, 124, 82, { r: 40, g: 50, b: 60, a: 255 });

      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, 170, 110, { r: 255, g: 255, b: 255, a: 255 });

      editingSupportMocks.artifactToCanvas.mockImplementationOnce(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 24;
        setPixel(canvas, 0, 0, { r: 200, g: 210, b: 220, a: 255 });
        setPixel(canvas, 4, 2, { r: 150, g: 160, b: 170, a: 255 });
        return canvas;
      });

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "heal",
        inputScope: "selected-layers",
        surfaceMask: sourceMask,
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.aiHealing();

      const mergedCanvas = editingSupportMocks.replaceLayerWithCanvas.mock.calls[0]?.[2] as HTMLCanvasElement | undefined;
      expect(mergedCanvas).toBeInstanceOf(HTMLCanvasElement);
      expect(readPixel(mergedCanvas!, 120, 80)).toMatchObject({ r: 200, g: 210, b: 220, a: 255 });
      expect(readPixel(mergedCanvas!, 124, 82)).toMatchObject({ r: 40, g: 50, b: 60, a: 255 });
    });
  });

  describe("openDenoiseModal", () => {
    it("opens the unified denoise mask session and runs enhancement-family denoise on selected layers", async () => {
      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, 170, 110, { r: 255, g: 255, b: 255, a: 255 });
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "denoise",
        inputScope: "selected-layers",
        intensity: 72,
        surfaceMask: sourceMask,
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      controller.openDenoiseModal();
      await vi.waitFor(() => {
        expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalled();
      });

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "denoise" }));
      expect(editingSupportMocks.buildRasterLayerContentImageAsset).toHaveBeenCalledWith(layer);
      expect(editingSupportMocks.buildScopedCompositeImageAsset).not.toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildEnhancementTask).toHaveBeenCalledWith(
        "denoise",
        expect.objectContaining({ data: "data:image/png;base64,LAYER_CONTENT" }),
        expect.objectContaining({ intensity: 0.72 }),
      );
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Denoise",
        expect.objectContaining({ operation: "denoise" }),
      );
    });

    it("falls back to full-target denoise when the session mask is blank", async () => {
      const blankMask = document.createElement("canvas");
      blankMask.width = 800;
      blankMask.height = 600;
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "denoise",
        inputScope: "visible-content",
        surfaceMask: blankMask,
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      controller.openDenoiseModal();
      await vi.waitFor(() => {
        expect(aiController.queueTask).toHaveBeenCalled();
      });

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildEnhancementTask).toHaveBeenCalledWith(
        "denoise",
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.objectContaining({ intensity: 0.5 }),
      );
      expect(aiController.queueTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({
            family: "enhancement",
            options: expect.objectContaining({ operation: "denoise" }),
          }),
        }),
        "AI Denoise",
      );
    });

    it("applies visible-content scoped denoise back to the active raster layer", async () => {
      const sourceMask = document.createElement("canvas");
      sourceMask.width = 800;
      sourceMask.height = 600;
      setPixel(sourceMask, 100, 100, { r: 255, g: 255, b: 255, a: 255 });
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "denoise",
        inputScope: "visible-content",
        intensity: 60,
        surfaceMask: sourceMask,
      }));
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      controller.openDenoiseModal();
      await vi.waitFor(() => {
        expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalled();
      });

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Denoise",
        expect.objectContaining({ operation: "denoise" }),
      );
      expect(showToast).toHaveBeenCalledWith("AI Denoise applied.", "success");
    });
  });

  describe("addShadow", () => {
    it("sends visible content by default", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "shadow-add" }));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({
          guideMode: "shadow-add",
        }),
      );
      expect(aiController.queueTask).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackPolicy: "forbid" }),
        "AI shadow generation",
      );
    });


    it("sends selected layers when unified session chooses selected-layers", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ inputScope: "selected-layers" }));

      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
    });

    it("calls replaceLayerWithCanvas with the AI result", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(editingSupportMocks.artifactToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          expectedWidth: 800,
          expectedHeight: 600,
          extractRegion: { x: 50, y: 30, width: 200, height: 150 },
        }),
      );
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Add Shadow",
        expect.objectContaining({ operation: "add-shadow" }),
      );
    });

    it("launches without any existing selection", async () => {
      doc.selectionMask = null;
      doc.selectionRect = null;
      doc.selectionPath = null;

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());

      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "shadow-add" }));
      expect(editingSupportMocks.buildDualColorGuideMaskAsset).toHaveBeenCalledWith("shadow-add", expect.any(HTMLCanvasElement), expect.any(HTMLCanvasElement));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalled();
    });

    it("ignores any existing document selection when starting guided shadow painting", async () => {
      const selectionMask = document.createElement("canvas");
      selectionMask.width = 800;
      selectionMask.height = 600;
      doc.selectionMask = selectionMask;
      doc.selectionRect = { x: 100, y: 100, width: 200, height: 200 };

      const guideState = {
        ...makeMaskSessionResult(),
      };
      const startAiMaskSession = vi.fn(async () => guideState);
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "shadow-add" }));
      expect(editingSupportMocks.buildDualColorGuideMaskAsset).toHaveBeenCalledWith("shadow-add", expect.any(HTMLCanvasElement), guideState.surfaceMask);
    });

    it("uses the completed shadow guide surface mask for inpainting", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());

      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "shadow-add" }));
      expect(editingSupportMocks.buildDualColorGuideMaskAsset).toHaveBeenCalledWith("shadow-add", expect.any(HTMLCanvasElement), expect.any(HTMLCanvasElement));
    });

    it("saves debug images for input, mask, and result", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());
      const { createAiEditingController } = await import("./editingController");
      const saveDebugImage = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage,
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(saveDebugImage).toHaveBeenCalledTimes(3);
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,COMPOSITE",
        "AI shadow",
        "input",
        "composite",
      );
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,GUIDE",
        "AI shadow",
        "input",
        "guide-mask",
      );
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,RESULT",
        "AI shadow",
        "output",
        "result",
      );
    });

    it("blocks guided shadow generation when Gemini is not the primary inpainting provider", async () => {
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        getPrimaryProviderIdForFamily: () => "openai-compatible",
      });

      await controller.addShadow();

      expect(showToast).toHaveBeenCalledWith(
        "AI Add Shadow currently requires Google Gemini as the primary inpainting provider.",
        "error",
      );
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });

    it("uses approximate guide language for natural shadow generation without inventing objects", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[0][2] as string;
      expect(prompt).toContain("black marks the approximate existing surface area where the shadow should land and darken the underlying pixels");
      expect(prompt).toContain("Do not trace either painted guide as an exact contour");
      expect(prompt).toContain("believable perspective, contact, softness, blur, and falloff");
      expect(prompt).toContain("must not be rendered as a decal, cutout, silhouette, solid shape");
      expect(prompt).toContain("Do not invent any new objects or geometry anywhere in the image");
      expect(prompt).toContain("Only darken existing content inside the black guide region");
      expect(prompt).not.toContain("binary edit mask");
    });

    it("uses settings returned by the unified session", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        intensity: 80,
        lightDirection: "bottom-left",
        inputScope: "selected-layers",
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[0][2] as string;
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(prompt).toContain("The light source is coming from the bottom-left.");
      expect(prompt).toContain("Shadow intensity: 80%.");
    });

    it("does nothing when the unified session is cancelled", async () => {
      const startAiMaskSession = vi.fn(async () => null);
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "shadow-add" }));
      expect(editingSupportMocks.buildScopedCompositeImageAsset).not.toHaveBeenCalled();
      expect(editingSupportMocks.buildInpaintingTask).not.toHaveBeenCalled();
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });
  });

  describe("removeShadow", () => {
    it("sends visible content by default", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "shadow-remove" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeShadow();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "shadow-remove" }));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({
          guideMode: "shadow-remove",
        }),
      );
      expect(aiController.queueTask).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackPolicy: "forbid" }),
        "AI shadow removal",
      );
    });


  it("uses the unified remove-shadow session config and settings", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({
        guideMode: "shadow-remove",
        intensity: 82,
        inputScope: "selected-layers",
      }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeShadow();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[0][2] as string;
      expect(prompt).toContain("black marks the existing shadow area to lighten or remove");
      expect(prompt).toContain("any red markings are optional extra context");
      expect(prompt).toContain("Do not depend on red markings being present");
      expect(prompt).toContain("Only edit pixels inside the black guide region");
      expect(prompt).toContain("Do not alter, erase, distort, relight, or replace non-shadow content outside the black-marked area");
      expect(prompt).toContain("Shadow reduction strength: 82%.");
    });

    it("allows remove-shadow task assembly when only the black guide is painted", async () => {
      const emptyCasterMask = document.createElement("canvas");
      emptyCasterMask.width = 800;
      emptyCasterMask.height = 600;
      const startAiMaskSession = vi.fn(async () => ({
        ...makeMaskSessionResult({ guideMode: "shadow-remove" }),
        casterMask: emptyCasterMask,
      }));
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeShadow();

      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({ guideMode: "shadow-remove" }),
      );
      expect(showToast).not.toHaveBeenCalledWith("Paint both guides before applying.", "error");
      expect(aiController.queueTask).toHaveBeenCalled();
    });

    it("calls replaceLayerWithCanvas with the AI result", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "shadow-remove" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeShadow();

      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Remove Shadow",
        expect.objectContaining({ operation: "remove-shadow" }),
      );
    });

    it("blocks remove shadow when Gemini is not the primary inpainting provider", async () => {
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        getPrimaryProviderIdForFamily: () => "openai-compatible",
      });

      await controller.removeShadow();

      expect(showToast).toHaveBeenCalledWith(
        "AI Remove Shadow currently requires Google Gemini as the primary inpainting provider.",
        "error",
      );
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });
  });

  describe("reflection workflows", () => {
    it("addReflection uses guide mask with red source and black target semantics", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "reflection-add", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addReflection();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "reflection-add" }));
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({ guideMode: "reflection-add" }),
      );
      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[editingSupportMocks.buildInpaintingTask.mock.calls.length - 1]?.[2] as string;
      expect(prompt).toContain("red marks the source object or bright cause of the reflection or glare");
      expect(prompt).toContain("black marks the target region where that reflection or glare should appear");
      expect(prompt).toContain("Only modify existing content inside the black guide region");
    });

    it("removeReflection is black-required, red-optional, and uses guide mask", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "reflection-remove" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeReflection();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "reflection-remove" }));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({ guideMode: "reflection-remove" }),
      );
      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[editingSupportMocks.buildInpaintingTask.mock.calls.length - 1]?.[2] as string;
      expect(prompt).toContain("black marks the reflection or glare area to clean up");
      expect(prompt).toContain("red markings are optional extra context");
      expect(prompt).toContain("Do not depend on red markings being present");
      expect(prompt).toContain("Only edit pixels inside the black guide region");
    });

    it("allows removeReflection task assembly when only the black guide is painted", async () => {
      const emptyCasterMask = document.createElement("canvas");
      emptyCasterMask.width = 800;
      emptyCasterMask.height = 600;
      const startAiMaskSession = vi.fn(async () => ({
        ...makeMaskSessionResult({ guideMode: "reflection-remove" }),
        casterMask: emptyCasterMask,
      }));
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeReflection();

      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({ guideMode: "reflection-remove" }),
      );
      expect(showToast).not.toHaveBeenCalledWith("Paint both guides before applying.", "error");
      expect(aiController.queueTask).toHaveBeenCalled();
    });
  });

  describe("moveObject", () => {
    it("sends a move-object guide contract with composite input and merged edit mask", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "move-object" }));
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.moveObject();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "move-object" }));
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildDualColorGuideMaskAsset).toHaveBeenCalledWith("move-object", expect.any(HTMLCanvasElement), expect.any(HTMLCanvasElement));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({
          guideMode: "move-object",
        }),
      );
      expect(aiController.queueTask).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackPolicy: "forbid" }),
        "AI move object",
      );
    });


    it("rejects multiple disconnected destination islands with a clear toast", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "move-object" }));
      editingSupportMocks.splitMaskIntoConnectedComponents.mockReturnValueOnce([
        { canvas: document.createElement("canvas"), bounds: { x: 0, y: 0, width: 4, height: 4 }, pixelCount: 10 },
        { canvas: document.createElement("canvas"), bounds: { x: 20, y: 20, width: 4, height: 4 }, pixelCount: 8 },
      ]);
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.moveObject();

      expect(showToast).toHaveBeenCalledWith(
        "AI Move Object currently supports exactly one destination area. Please keep the black guide as a single connected island.",
        "error",
      );
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });

    it("blocks move object when Gemini is not the primary inpainting provider", async () => {
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        getPrimaryProviderIdForFamily: () => "openai-compatible",
      });

      await controller.moveObject();

      expect(showToast).toHaveBeenCalledWith(
        "AI Move Object currently requires Google Gemini as the primary inpainting provider.",
        "error",
      );
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });

    it("uses move-object prompt semantics and logs metadata", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "move-object", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.moveObject();

      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[0][2] as string;
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(prompt).toContain("Preserve the identity of that exact object while relocating it");
      expect(prompt).toContain("heal and reconstruct the revealed background naturally");
      expect(prompt).toContain("leave no duplicate, ghost, outline, residue, or partial remnant behind");
      expect(prompt).toContain("Place exactly one instance of the same object inside the black destination region");
      expect(prompt).toContain("do not hallucinate new objects or unrelated scene content");
      expect(log).toHaveBeenCalledWith(
        'AI task prompt metadata: image=800×600, mask=800×600, mode=replace, guideMode=move-object',
      );
    });
  });

  describe("cloneObject", () => {
    it("runs one masked inpainting pass for all meaningful destination regions and applies the result once", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "clone-object", inputScope: "selected-layers" }));
      editingSupportMocks.splitMaskIntoConnectedComponents.mockReturnValueOnce([
        { canvas: document.createElement("canvas"), bounds: { x: 10, y: 10, width: 12, height: 12 }, pixelCount: 80 },
        { canvas: document.createElement("canvas"), bounds: { x: 120, y: 90, width: 10, height: 10 }, pixelCount: 60 },
      ]);
      const log = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.cloneObject();

      expect(startAiMaskSession).toHaveBeenCalledWith(doc, expect.objectContaining({ guideMode: "clone-object" }));
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(editingSupportMocks.createGuideMaskUnion).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.createGuideMaskUnion).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        expect.any(HTMLCanvasElement),
      );
      expect(editingSupportMocks.buildDualColorGuideMaskAsset).toHaveBeenCalledWith("clone-object", expect.any(HTMLCanvasElement), expect.any(HTMLCanvasElement));
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        expect.anything(),
        expect.any(String),
        "replace",
        expect.objectContaining({ guideMode: "clone-object" }),
      );
      const prompt = editingSupportMocks.buildInpaintingTask.mock.calls[0][2] as string;
      expect(prompt).toContain("Multiple separate black destination islands may indicate multiple requested copies");
      expect(prompt).toContain("create one natural-looking copy inside each meaningful black destination island as part of this single edit");
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledWith(
        doc,
        layer,
        expect.any(HTMLCanvasElement),
        "AI Clone Object",
        expect.objectContaining({ operation: "clone-object" }),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("destinations=2, ignoredSpecks=0"),
      );
    });


    it("filters tiny destination specks before processing", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "clone-object", inputScope: "selected-layers" }));
      editingSupportMocks.splitMaskIntoConnectedComponents.mockReturnValueOnce([
        { canvas: document.createElement("canvas"), bounds: { x: 2, y: 2, width: 8, height: 8 }, pixelCount: 40 },
        { canvas: document.createElement("canvas"), bounds: { x: 30, y: 30, width: 1, height: 1 }, pixelCount: 10 },
      ]);
      const log = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.cloneObject();

      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.createGuideMaskUnion).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("destinations=1, ignoredSpecks=1, execution=single-pass"),
      );
    });

    it("allows many destination islands while still using a single AI request", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "clone-object" }));
      editingSupportMocks.splitMaskIntoConnectedComponents.mockReturnValueOnce(Array.from({ length: 7 }, (_, index) => ({
        canvas: document.createElement("canvas"),
        bounds: { x: index * 10, y: 0, width: 4, height: 4 },
        pixelCount: 50,
      })));
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.cloneObject();

      expect(showToast).toHaveBeenCalledWith("Object cloned.", "success");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledTimes(1);
      expect(aiController.queueTask).toHaveBeenCalledTimes(1);
      expect(editingSupportMocks.replaceLayerWithCanvas).toHaveBeenCalledTimes(1);
    });

    it("blocks clone object when Gemini is not the primary inpainting provider", async () => {
      const showToast = vi.fn();
      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast,
        log: vi.fn(),
        saveDebugImage: vi.fn(),
        getPrimaryProviderIdForFamily: () => "openai-compatible",
      });

      await controller.cloneObject();

      expect(showToast).toHaveBeenCalledWith(
        "AI Clone Object currently requires Google Gemini as the primary inpainting provider.",
        "error",
      );
      expect(aiController.queueTask).not.toHaveBeenCalled();
    });
  });

  describe("debug logging", () => {
    it("opens style-transfer with style-specific prompt copy and defaults", async () => {
      promptMocks.aiPromptEnhancement.mockResolvedValueOnce(null);

      const { createAiEditingController } = await import("./editingController");

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage: vi.fn(),
      });

      controller.openStyleTransferModal();
      await Promise.resolve();

      expect(promptMocks.aiPromptEnhancement).toHaveBeenCalledWith(
        "AI Style Transfer",
        "Describe the style to apply to the active layer, optionally using reference images for visual style guidance.",
        expect.objectContaining({
          showPrompt: true,
          showReferenceImages: true,
          defaultIntensity: 65,
          promptLabel: "Style direction",
          promptPlaceholder: "editorial matte film look",
          defaultPrompt: "editorial matte film look",
          referenceHelpText: "Optional. Add reference images when you want Vision Goblin to transfer their visual style onto the source image while preserving the source subject and composition.",
        }),
      );
    });

    it("logs raw prompt separately from generation prompt metadata", async () => {
      promptMocks.aiPromptThumbnailWithInputScope.mockResolvedValueOnce({
        size: "256x256",
        prompt: "psychedelic background, surprised face with open mouth",
        inputScope: "visible-content",
      });

      editingSupportMocks.buildGenerationTask.mockReturnValueOnce({
        id: "ai-gen-test",
        family: "generation",
        prompt: "psychedelic background, surprised face with open mouth",
        input: {
          referenceImages: [{
            kind: "image",
            mimeType: "image/png",
            data: "data:image/png;base64,COMPOSITE",
            width: 800,
            height: 600,
          }],
        },
        options: { width: 256, height: 256, imageCount: 1 },
      });

      const generationResponse: AiTaskSuccess = {
        ...makeSuccessResponse(),
        family: "generation",
      };
      editingSupportMocks.waitForJob.mockResolvedValueOnce(makeCompletedJob(generationResponse));

      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
      });

      await controller.generateThumbnail();

      expect(log).toHaveBeenCalledWith(
        'AI task raw prompt: "psychedelic background, surprised face with open mouth"',
      );
      expect(log).toHaveBeenCalledWith(
        "AI task prompt metadata: target=256×256, references=1, source=800×600",
      );
    });

    it("logs inpaint details including prompt, image dims, and mask dims", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('AI inpaint: prompt="test prompt"'),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("image=800×600"),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("mask=800×600"),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("inputScope=selected-layers"),
      );
    });

    it("logs task queued and completed for inpainting", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/AI task queued: "AI inpainting" \[inpainting\]/),
      );
      expect(log).toHaveBeenCalledWith(
        'AI task raw prompt: "test prompt"',
      );
      expect(log).toHaveBeenCalledWith(
        "AI task prompt metadata: image=800×600, mask=800×600, mode=replace",
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('AI task completed: "AI inpainting"'),
      );
    });

    it("logs guide mode metadata for add shadow inpainting tasks", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult());
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.addShadow();

      expect(log).toHaveBeenCalledWith(
        'AI task prompt metadata: image=800×600, mask=800×600, mode=replace, guideMode=shadow-add',
      );
    });

    it("logs guide mode metadata for remove shadow inpainting tasks", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "shadow-remove" }));
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeShadow();

      expect(log).toHaveBeenCalledWith(
        'AI task prompt metadata: image=800×600, mask=800×600, mode=replace, guideMode=shadow-remove',
      );
    });

    it("logs session mask path for removeObject", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "remove-object" }));
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.removeObject();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("AI remove object: using session mask"),
      );
    });

    it("logs ERROR when a task fails", async () => {
      const failedJob = makeCompletedJob(makeSuccessResponse());
      failedJob.taskResult!.ok = false;
      failedJob.taskResult!.response = undefined as never;
      failedJob.message = "Provider unavailable";
      editingSupportMocks.waitForJob.mockReset();
      editingSupportMocks.waitForJob.mockResolvedValue(failedJob);

      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");
      const log = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log,
        saveDebugImage: vi.fn(),
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("AI task failed"),
        "ERROR",
      );
    });
  });

  describe("debug image saving", () => {
    it("saves composite input, mask input, and result output for inpaintSelection", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");
      const saveDebugImage = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage,
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,SELECTED",
        "AI inpainting",
        "input",
        "selected-layers",
      );
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,MASK",
        "AI inpainting",
        "input",
        "mask",
      );
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,RESULT",
        "AI inpainting",
        "output",
        "result",
      );
    });

    it("saves composite input, mask input, and result output for removeObject", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "remove-object" }));
      const { createAiEditingController } = await import("./editingController");
      const saveDebugImage = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage,
        startAiMaskSession,
      });

      await controller.removeObject();

      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,COMPOSITE",
        "AI object removal",
        "input",
        "composite",
      );
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,MASK",
        "AI object removal",
        "input",
        "mask",
      );
      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,RESULT",
        "AI object removal",
        "output",
        "result",
      );
    });

    it("uses correct job names and labels matching the task titles", async () => {
      const startAiMaskSession = vi.fn(async () => makeMaskSessionResult({ guideMode: "inpaint", inputScope: "selected-layers" }));
      const { createAiEditingController } = await import("./editingController");
      const saveDebugImage = vi.fn();

      const controller = createAiEditingController({
        aiController,
        getActiveDocument: () => doc,
        getActiveLayer: () => layer,
        renderCanvas: vi.fn(),
        renderEditorState: vi.fn(),
        showToast: vi.fn(),
        log: vi.fn(),
        saveDebugImage,
        startAiMaskSession,
      });

      await controller.inpaintSelection();

      // Verify the job name matches the task title used in runTask
      const calls = saveDebugImage.mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]).toEqual(["data:image/png;base64,SELECTED", "AI inpainting", "input", "selected-layers"]);
      expect(calls[1]).toEqual(["data:image/png;base64,MASK", "AI inpainting", "input", "mask"]);
      expect(calls[2]).toEqual(["data:image/png;base64,RESULT", "AI inpainting", "output", "result"]);
    });
  });
});
