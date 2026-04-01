import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { DocumentState, Layer, RasterLayer } from "../../editor/types";
import type { AiController } from "./controller";
import type { AiInpaintingTask, AiImageAsset, AiMaskAsset, AiSegmentationTask, AiTask } from "./types";
import type { AiJobRecord } from "./jobQueue";
import type { AiTaskSuccess } from "./contracts";

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
  buildSelectionMaskAsset: vi.fn((_doc: DocumentState): AiMaskAsset | null => ({
    kind: "mask",
    mimeType: "image/png",
    data: "data:image/png;base64,MASK",
    width: 800,
    height: 600,
  })),
  buildInpaintingTask: vi.fn((image: AiImageAsset, mask: AiMaskAsset, prompt: string, mode: string): AiInpaintingTask => ({
    id: "ai-inpaint-test",
    family: "inpainting",
    prompt,
    input: { image, mask },
    options: { mode: mode as "remove" | "replace" },
  })),
  buildSegmentationTask: vi.fn((mode: string, image: AiImageAsset, prompt?: string): AiSegmentationTask => ({
    id: `ai-seg-${mode}`,
    family: "segmentation",
    prompt,
    input: { image },
    options: { mode: mode as "subject" | "background" | "object" | "background-removal" },
  })),
  buildEnhancementTask: vi.fn(),
  buildGenerationTask: vi.fn(),
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
  waitForJob: vi.fn(),
}));

const promptMocks = vi.hoisted(() => ({
  aiPromptText: vi.fn(async () => "test prompt"),
  aiPromptTextWithInputScope: vi.fn(async (): Promise<{ prompt: string; inputScope: "selected-layers" | "visible-content" }> => ({ prompt: "test prompt", inputScope: "visible-content" })),
  aiPromptSelect: vi.fn(),
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
    selectionMask: document.createElement("canvas"),
    guides: [],
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
    layer = makeLayer({ x: 50, y: 30 });
    doc = makeDocument(layer);
    aiController = makeMockAiController();

    const response = makeSuccessResponse();
    editingSupportMocks.waitForJob.mockResolvedValue(makeCompletedJob(response));
  });

  describe("inpaintSelection", () => {
    it("sends visible content by default", async () => {
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

      await controller.inpaintSelection();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "replace",
      );
      expect(editingSupportMocks.buildLayerImageAsset).not.toHaveBeenCalled();
    });

    it("sends selected layers when the modal chooses selected layers", async () => {
      promptMocks.aiPromptTextWithInputScope.mockResolvedValueOnce({
        prompt: "test prompt",
        inputScope: "selected-layers",
      });

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
      });

      await controller.inpaintSelection();

      expect(layer.x).toBe(50);
      expect(layer.y).toBe(30);
    });

    it("calls replaceLayerWithCanvas with the AI result", async () => {
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
    it("sends visible content by default when using an existing selection", async () => {
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

      await controller.removeObject();

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
      });

      await controller.removeObject();

      expect(layer.x).toBe(50);
      expect(layer.y).toBe(30);
    });

    it("falls back to prompt-based segmentation when no selection exists", async () => {
      doc.selectionMask = null;
      editingSupportMocks.buildSelectionMaskAsset.mockReturnValueOnce(null);

      const segMask = document.createElement("canvas");
      segMask.width = 800;
      segMask.height = 600;
      editingSupportMocks.getMaskArtifact.mockReturnValue({
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,SEGMASK",
        width: 800,
        height: 600,
      });
      editingSupportMocks.artifactToCanvas
        .mockResolvedValueOnce(segMask)
        .mockResolvedValueOnce(document.createElement("canvas"));

      const segResponse = makeSuccessResponse();
      segResponse.family = "segmentation" as "inpainting";
      segResponse.artifacts = [{
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,SEGMASK",
        width: 800,
        height: 600,
      }];

      const segJob = makeCompletedJob(segResponse);
      const inpaintJob = makeCompletedJob(makeSuccessResponse());
      editingSupportMocks.waitForJob
        .mockResolvedValueOnce(segJob)
        .mockResolvedValueOnce(inpaintJob);

      (aiController.queueTask as Mock)
        .mockReturnValueOnce(segJob)
        .mockReturnValueOnce(inpaintJob);

      promptMocks.aiPromptTextWithInputScope.mockResolvedValueOnce({ prompt: "stray person", inputScope: "visible-content" });

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

      await controller.removeObject();

      // Even with segmentation fallback, inpainting should use composite image
      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "visible-content");
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,COMPOSITE" }),
        expect.anything(),
        expect.any(String),
        "remove",
      );
    });

    it("uses selected layers for segmentation and inpainting when prompt flow chooses that scope", async () => {
      doc.selectionMask = null;
      editingSupportMocks.buildSelectionMaskAsset.mockReturnValueOnce(null);

      const segMask = document.createElement("canvas");
      segMask.width = 800;
      segMask.height = 600;
      editingSupportMocks.getMaskArtifact.mockReturnValue({
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,SEGMASK",
        width: 800,
        height: 600,
      });
      editingSupportMocks.artifactToCanvas
        .mockResolvedValueOnce(segMask)
        .mockResolvedValueOnce(document.createElement("canvas"));

      const segResponse = makeSuccessResponse();
      segResponse.family = "segmentation" as "inpainting";
      segResponse.artifacts = [{
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,SEGMASK",
        width: 800,
        height: 600,
      }];

      const segJob = makeCompletedJob(segResponse);
      const inpaintJob = makeCompletedJob(makeSuccessResponse());
      editingSupportMocks.waitForJob
        .mockResolvedValueOnce(segJob)
        .mockResolvedValueOnce(inpaintJob);

      (aiController.queueTask as Mock)
        .mockReturnValueOnce(segJob)
        .mockReturnValueOnce(inpaintJob);

      promptMocks.aiPromptTextWithInputScope.mockResolvedValueOnce({ prompt: "stray person", inputScope: "selected-layers" });

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

      await controller.removeObject();

      expect(editingSupportMocks.buildScopedCompositeImageAsset).toHaveBeenCalledWith(doc, "selected-layers");
      expect(editingSupportMocks.buildSegmentationTask).toHaveBeenCalledWith(
        "object",
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        "stray person",
      );
      expect(editingSupportMocks.buildInpaintingTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: "data:image/png;base64,SELECTED" }),
        expect.anything(),
        expect.any(String),
        "remove",
      );
    });

    it("calls replaceLayerWithCanvas with the AI result", async () => {
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
    });

    it("logs task queued and completed for inpainting", async () => {
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

    it("logs selection mask path for removeObject with existing selection", async () => {
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

      await controller.removeObject();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("AI remove object: using selection mask"),
      );
    });

    it("logs prompt-based detection path for removeObject without selection", async () => {
      doc.selectionMask = null;
      editingSupportMocks.buildSelectionMaskAsset.mockReturnValueOnce(null);

      const segMask = document.createElement("canvas");
      segMask.width = 800;
      segMask.height = 600;
      editingSupportMocks.getMaskArtifact.mockReturnValue({
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,SEGMASK",
        width: 800,
        height: 600,
      });
      editingSupportMocks.artifactToCanvas
        .mockResolvedValueOnce(segMask)
        .mockResolvedValueOnce(document.createElement("canvas"));

      const segResponse = makeSuccessResponse();
      segResponse.family = "segmentation" as "inpainting";
      segResponse.artifacts = [{
        kind: "mask",
        mimeType: "image/png",
        data: "data:image/png;base64,SEGMASK",
        width: 800,
        height: 600,
      }];

      const segJob = makeCompletedJob(segResponse);
      const inpaintJob = makeCompletedJob(makeSuccessResponse());
      editingSupportMocks.waitForJob
        .mockResolvedValueOnce(segJob)
        .mockResolvedValueOnce(inpaintJob);

      (aiController.queueTask as Mock)
        .mockReturnValueOnce(segJob)
        .mockReturnValueOnce(inpaintJob);

      promptMocks.aiPromptTextWithInputScope.mockResolvedValueOnce({ prompt: "stray person", inputScope: "visible-content" });

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

      await controller.removeObject();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('AI remove object: prompt-based detection, prompt="stray person"'),
      );
    });

    it("logs ERROR when a task fails", async () => {
      const failedJob = makeCompletedJob(makeSuccessResponse());
      failedJob.taskResult!.ok = false;
      failedJob.taskResult!.response = undefined as never;
      failedJob.message = "Provider unavailable";
      editingSupportMocks.waitForJob.mockReset();
      editingSupportMocks.waitForJob.mockResolvedValue(failedJob);

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

      await controller.inpaintSelection();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("AI task failed"),
        "ERROR",
      );
    });
  });

  describe("debug image saving", () => {
    it("saves composite input, mask input, and result output for inpaintSelection", async () => {
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
      });

      await controller.inpaintSelection();

      expect(saveDebugImage).toHaveBeenCalledWith(
        "data:image/png;base64,COMPOSITE",
        "AI inpainting",
        "input",
        "composite",
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
      });

      await controller.inpaintSelection();

      // Verify the job name matches the task title used in runTask
      const calls = saveDebugImage.mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]).toEqual(["data:image/png;base64,COMPOSITE", "AI inpainting", "input", "composite"]);
      expect(calls[1]).toEqual(["data:image/png;base64,MASK", "AI inpainting", "input", "mask"]);
      expect(calls[2]).toEqual(["data:image/png;base64,RESULT", "AI inpainting", "output", "result"]);
    });
  });
});
