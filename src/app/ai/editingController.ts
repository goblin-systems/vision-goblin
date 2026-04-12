import { createLayerCanvas, snapshotDocument, syncLayerSource } from "../../editor/documents";
import { createMaskCanvas, isMaskEmpty, maskBoundingRect } from "../../editor/selection";
import type { DocumentState, Layer, RasterLayer } from "../../editor/types";
import { applyStructuredTextReconstruction } from "../../editor/textReconstruction";
import type { AiController } from "./controller";
import type { AiProviderId } from "./config";
import type { AiInputScope, AiMaskAsset, AiTask } from "./types";
import { aiPromptText, aiPromptTextWithInputScope, aiPromptSelect, aiPromptOutpaintWithInputScope, aiPromptEnhancement, aiPromptRemoveBackgroundWithInputScope, aiPromptThumbnailWithInputScope, aiPromptInputScope, aiPromptReviewText, aiPromptReviewTextPieces } from "./aiPromptModal";
import { DEFAULT_AI_INPUT_SCOPE } from "./inputScope";
import {
  createGuideMaskUnion,
  addRasterLayerFromCanvas,
  applyMaskToLayer,
  applyMaskToSelection,
  artifactToCanvas,
  buildAiProvenance,
  buildBackgroundComposite,
  buildDualColorGuideMaskAsset,
  buildMaskAssetFromCanvas,
  buildScopedCompositeImageAsset,
  buildCutoutCanvas,
  buildEnhancementTask,
  buildGenerationTask,
  buildInpaintingTask,
  buildLayerImageAsset,
  buildSegmentationTask,
  getImageArtifact,
  getMaskArtifact,
  readReferenceImages,
  replaceLayerWithCanvas,
  splitMaskIntoConnectedComponents,
  waitForJob,
} from "./editingSupport";
import { runTwoStageTextReplacement } from "./textReconstruction/flow";
import {
  buildGuideDrivenInpaintingPrompt,
  REMOVE_OBJECT_DEFAULT_PROMPT,
  DEFAULT_BACKGROUND_DESCRIPTION,
  AI_HEALING_PROMPT,
  buildThumbnailTextOverlayPrompt,
} from "./prompts";
import {
  DEFAULT_AI_HEALING_SESSION_CONFIG,
  DEFAULT_ADD_REFLECTION_SESSION_CONFIG,
  DEFAULT_CLONE_OBJECT_SESSION_CONFIG,
  DEFAULT_ADD_SHADOW_SESSION_CONFIG,
  DEFAULT_DENOISE_SESSION_CONFIG,
  DEFAULT_INPAINT_SESSION_CONFIG,
  DEFAULT_MOVE_OBJECT_SESSION_CONFIG,
  DEFAULT_REMOVE_OBJECT_SESSION_CONFIG,
  DEFAULT_REMOVE_REFLECTION_SESSION_CONFIG,
  DEFAULT_REMOVE_SHADOW_SESSION_CONFIG,
  DEFAULT_REPLACE_TEXT_SESSION_CONFIG,
  type AiMaskSessionConfig,
  type AiMaskSessionResult,
} from "./aiMaskSession";
import { prepareMaskedRasterTarget } from "./maskedRasterTarget";

type ToastVariant = "success" | "error" | "info";
type EnhancementMode = "auto-enhance" | "denoise" | "style-transfer" | "restore";

export interface AiEditingControllerDeps {
  aiController: AiController;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  renderCanvas: () => void;
  renderEditorState: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  saveDebugImage: (dataUrl: string, jobName: string, direction: "input" | "output", label: string) => void;
  startAiMaskSession?: (doc: DocumentState, config?: AiMaskSessionConfig) => Promise<AiMaskSessionResult | null>;
  getPrimaryProviderIdForFamily?: (family: AiTask["family"]) => AiProviderId;
  getPreferredModelForFamily?: (family: AiTask["family"]) => string | undefined;
}

export interface AiEditingController {
  bind(): void;
  selectSubject(): Promise<void>;
  selectBackground(): Promise<void>;
  selectObjectByPrompt(): Promise<void>;
  removeBackground(): Promise<void>;
  removeObject(): Promise<void>;
  openAutoEnhanceModal(): void;
  upscaleActiveLayer(): Promise<void>;
  openDenoiseModal(): void;
  inpaintSelection(): Promise<void>;
  outpaintCanvas(): Promise<void>;
  openStyleTransferModal(): void;
  openRestoreModal(): void;
  generateThumbnail(): Promise<void>;
  freeformAi(): Promise<void>;
  addShadow(): Promise<void>;
  removeShadow(): Promise<void>;
  addReflection(): Promise<void>;
  removeReflection(): Promise<void>;
  cloneObject(): Promise<void>;
  moveObject(): Promise<void>;
  replaceRasterText(): Promise<void>;
  aiHealing(): Promise<void>;
}

interface AiTaskLogSummary {
  rawPrompt?: string;
  promptMetadata?: string;
}

const CLONE_OBJECT_MIN_DESTINATION_PIXELS = 24;

export function createAiEditingController(deps: AiEditingControllerDeps): AiEditingController {
  function summarizeTaskForLogging(task: AiTask): AiTaskLogSummary {
    switch (task.family) {
      case "generation": {
        const referenceImage = task.input?.referenceImages?.[0];
        const metadataParts = [
          `target=${task.options?.width ?? "?"}×${task.options?.height ?? "?"}`,
          `references=${task.input?.referenceImages?.length ?? 0}`,
        ];
        if (referenceImage?.width && referenceImage?.height) {
          metadataParts.push(`source=${referenceImage.width}×${referenceImage.height}`);
        }
        return {
          rawPrompt: task.prompt,
          promptMetadata: metadataParts.join(", "),
        };
      }
      case "inpainting":
        {
          const metadataParts = [
            `image=${task.input.image.width ?? "?"}×${task.input.image.height ?? "?"}`,
            `mask=${task.input.mask.width ?? "?"}×${task.input.mask.height ?? "?"}`,
            `mode=${task.options?.mode ?? "replace"}`,
          ];
          if (task.options?.guideMode) {
            metadataParts.push(`guideMode=${task.options.guideMode}`);
          }
          return {
            rawPrompt: task.prompt,
            promptMetadata: metadataParts.join(", "),
          };
        }
      case "segmentation":
        return {
          rawPrompt: task.prompt,
          promptMetadata: `image=${task.input.image.width ?? "?"}×${task.input.image.height ?? "?"}, mode=${task.options?.mode ?? "subject"}${task.input.subjectHint ? `, subjectHint="${task.input.subjectHint}"` : ""}`,
        };
      case "enhancement": {
        const operation = task.options?.operation ?? "auto-enhance";
        const metadataParts = [
          `image=${task.input.image.width ?? "?"}×${task.input.image.height ?? "?"}`,
          `operation=${operation}`,
        ];
        if (task.options?.scaleFactor) {
          metadataParts.push(`scaleFactor=${task.options.scaleFactor}`);
        }
        if (task.input.referenceImages?.length) {
          metadataParts.push(`references=${task.input.referenceImages.length}`);
        }
        return {
          rawPrompt: task.prompt,
          promptMetadata: metadataParts.join(", "),
        };
      }
      case "captioning":
        return {
          rawPrompt: task.prompt,
          promptMetadata: `image=${task.input.image.width ?? "?"}×${task.input.image.height ?? "?"}, detail=${task.options?.detail ?? "detailed"}`,
        };
      default:
        return {};
    }
  }

  async function runTask(title: string, request: Parameters<AiController["queueTask"]>[0]) {
    deps.log(`AI task queued: "${title}" [${request.task.family}] id=${request.task.id}`);
    const taskSummary = summarizeTaskForLogging(request.task);
    if (taskSummary.rawPrompt) {
      deps.log(`AI task raw prompt: "${taskSummary.rawPrompt}"`);
    }
    if (taskSummary.promptMetadata) {
      deps.log(`AI task prompt metadata: ${taskSummary.promptMetadata}`);
    }
    const job = deps.aiController.queueTask(request, title);
    const settled = await waitForJob(deps.aiController, job.id);
    const outcome = settled.taskResult;
    if (!outcome?.ok) {
      deps.log(`AI task failed: "${title}" – ${settled.message || "unknown error"}`, "ERROR");
      deps.showToast(settled.message || "AI task failed.", "error");
      return null;
    }
    deps.log(`AI task completed: "${title}"`);
    return outcome.response;
  }

  function getEditableLayer(): { doc: DocumentState; layer: Layer } | null {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("Open a document first.", "error");
      return null;
    }
    const layer = deps.getActiveLayer(doc);
    if (!layer || layer.locked || layer.type === "adjustment") {
      deps.showToast("Choose an editable layer first.", "error");
      return null;
    }
    return { doc, layer };
  }

  function getEditableRasterLayer(): { doc: DocumentState; layer: RasterLayer } | null {
    const editable = getEditableLayer();
    if (!editable) {
      return null;
    }
    if (editable.layer.type !== "raster") {
      deps.showToast("Choose a raster layer first.", "error");
      return null;
    }
    return { doc: editable.doc, layer: editable.layer };
  }


  async function runSegmentation(
    mode: "subject" | "background" | "object" | "background-removal",
    prompt?: string,
    inputScope: AiInputScope = "visible-content",
  ) {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("Open a document first.", "error");
      return null;
    }
    const scopedAsset = buildScopedInputAsset(doc, inputScope);
    deps.log(`AI segmentation: mode=${mode}, inputScope=${inputScope}, image=${doc.width}×${doc.height}${prompt ? `, prompt="${prompt}"` : ""}`);
    deps.saveDebugImage(scopedAsset.asset.data, "AI selection", "input", scopedAsset.debugLabel);
    const response = await runTask("AI selection", { task: buildSegmentationTask(mode, scopedAsset.asset, prompt) });
    if (!response) {
      return null;
    }
    const artifact = getMaskArtifact(response);
    if (!artifact) {
      deps.showToast("AI selection returned no mask.", "error");
      return null;
    }
    deps.saveDebugImage(artifact.data, "AI selection", "output", "mask");
    const maskCanvas = await artifactToCanvas(artifact, {
      expectedWidth: doc.width,
      expectedHeight: doc.height,
    });
    deps.log("AI segmentation: converted AI white/black mask to alpha-channel mask");
    deps.log(`AI segmentation mask diagnostics: rawArtifact=${artifact.width ?? "unknown"}×${artifact.height ?? "unknown"}, outputCanvas=${maskCanvas.width}×${maskCanvas.height}`);
    const empty = isMaskEmpty(maskCanvas);
    const boundingRect = maskBoundingRect(maskCanvas);
    deps.log(`AI segmentation mask diagnostics: isEmpty=${empty}, boundingRect=${boundingRect ? `{x:${boundingRect.x}, y:${boundingRect.y}, w:${boundingRect.width}, h:${boundingRect.height}}` : "null"}`);
    const maskCtx = maskCanvas.getContext("2d");
    if (maskCtx) {
      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const totalPixels = maskCanvas.width * maskCanvas.height;
      let opaquePixels = 0;
      for (let i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 0) {
          opaquePixels++;
        }
      }
      const coverage = totalPixels > 0 ? ((opaquePixels / totalPixels) * 100).toFixed(2) : "0.00";
      deps.log(`AI segmentation mask diagnostics: pixelCoverage=${coverage}% (${opaquePixels}/${totalPixels})`);
    }
    return {
      response,
      mask: maskCanvas,
    };
  }

  function buildScopedInputAsset(doc: DocumentState, inputScope: AiInputScope) {
    return buildScopedCompositeImageAsset(doc, inputScope);
  }

  async function selectSubject() {
    deps.log("AI select subject: starting");
    const inputScope = await aiPromptInputScope("AI: Select Subject", "Choose input scope");
    if (!inputScope) {
      return;
    }
    const result = await runSegmentation("subject", undefined, inputScope);
    if (!result) {
      return;
    }
    if (!applyMaskToSelection(deps.getActiveDocument()!, result.mask, "AI Select Subject")) {
      deps.showToast("No subject pixels found.", "info");
      return;
    }
    deps.renderEditorState();
    deps.log("AI select subject: completed");
    deps.showToast("AI subject selection is ready to refine.", "success");
  }

  async function selectBackground() {
    deps.log("AI select background: starting");
    const inputScope = await aiPromptInputScope("AI: Select Background", "Choose input scope");
    if (!inputScope) {
      return;
    }
    const result = await runSegmentation("background", "background", inputScope);
    if (!result) {
      return;
    }
    if (!applyMaskToSelection(deps.getActiveDocument()!, result.mask, "AI Select Background")) {
      deps.showToast("No background pixels found.", "info");
      return;
    }
    deps.renderEditorState();
    deps.log("AI select background: completed");
    deps.showToast("AI background selection is ready to refine.", "success");
  }

  async function selectObjectByPrompt() {
    const result = await aiPromptTextWithInputScope("AI: Select Object", "Describe the object to select", "person in the center");
    if (!result) {
      return;
    }
    const { prompt, inputScope } = result;
    deps.log(`AI select object: prompt="${prompt}"`);
    const selection = await runSegmentation("object", prompt, inputScope);
    if (!selection) {
      return;
    }
    if (!applyMaskToSelection(deps.getActiveDocument()!, selection.mask, `AI Select ${prompt}`)) {
      deps.showToast(`Nothing matched '${prompt}'.`, "info");
      return;
    }
    deps.renderEditorState();
    deps.showToast(`Selected '${prompt}'.`, "success");
  }

  async function removeBackground() {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }
    const result = await aiPromptRemoveBackgroundWithInputScope();
    if (!result) {
      return;
    }
    const { mode } = result;
    deps.log(`AI remove background: mode=${mode}, inputScope=${result.inputScope}${mode === "replace" ? `, description="${result.description || "soft studio backdrop"}"` : ""}`);
    const segmentation = await runSegmentation("background-removal", "foreground subject", result.inputScope);
    if (!segmentation) {
      return;
    }
    if (mode === "mask") {
      applyMaskToLayer(editable.doc, editable.layer, segmentation.mask, "AI Background Mask");
      deps.renderEditorState();
      deps.showToast("Background mask applied to the active layer.", "success");
      return;
    }

    const sourceAsset = buildScopedInputAsset(editable.doc, result.inputScope);
    const subjectCanvas = buildCutoutCanvas(await artifactToCanvas({
      kind: "image",
      mimeType: "image/png",
      data: sourceAsset.asset.data,
      width: editable.doc.width,
      height: editable.doc.height,
    }), segmentation.mask);
    if (mode === "transparent") {
      addRasterLayerFromCanvas(
        editable.doc,
        subjectCanvas,
        "Background Removed",
        "AI Remove Background",
        buildAiProvenance(segmentation.response, "background-removal"),
      );
      deps.renderEditorState();
      deps.showToast("Transparent subject layer added.", "success");
      return;
    }

    if (mode === "replace") {
      const prompt = result.description || DEFAULT_BACKGROUND_DESCRIPTION;
      deps.saveDebugImage(sourceAsset.asset.data, "AI background replacement", "input", sourceAsset.debugLabel);
      const backgroundResponse = await runTask("AI background replacement", {
        task: buildGenerationTask(prompt, editable.doc.width, editable.doc.height, [sourceAsset.asset]),
      });
      if (!backgroundResponse) {
        return;
      }
      const backgroundArtifact = getImageArtifact(backgroundResponse);
      if (!backgroundArtifact) {
        deps.showToast("AI background generation returned no image.", "error");
        return;
      }
      deps.saveDebugImage(backgroundArtifact.data, "AI background replacement", "output", "result");
      const backgroundCanvas = await artifactToCanvas(backgroundArtifact, {
        expectedWidth: editable.doc.width,
        expectedHeight: editable.doc.height,
      });
      addRasterLayerFromCanvas(
        editable.doc,
        buildBackgroundComposite(subjectCanvas, backgroundCanvas),
        "Background Replaced",
        "AI Replace Background",
        buildAiProvenance(backgroundResponse, "replace-background", prompt),
      );
      deps.renderEditorState();
      deps.showToast("Background replacement added as a new layer.", "success");
      return;
    }

    deps.showToast("Choose mask, transparent, or replace.", "info");
  }

  async function removeObject() {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }
    const sessionResult = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, DEFAULT_REMOVE_OBJECT_SESSION_CONFIG)
      : null;
    if (!sessionResult) {
      return;
    }
    const mask = buildMaskAssetFromCanvas(sessionResult.surfaceMask);
    if (!mask) {
      deps.showToast("Paint or select the object to remove.", "error");
      return;
    }
    const prompt = REMOVE_OBJECT_DEFAULT_PROMPT;
    const inputScope = sessionResult.inputScope;
    deps.log(`AI remove object: using session mask, inputScope=${inputScope}, ${mask.width ?? 0}×${mask.height ?? 0}`);
    const scopedAsset = buildScopedInputAsset(editable.doc, inputScope);
    const targetRegion = {
      x: editable.layer.x,
      y: editable.layer.y,
      width: editable.layer.canvas.width,
      height: editable.layer.canvas.height,
    };
    deps.saveDebugImage(scopedAsset.asset.data, "AI object removal", "input", scopedAsset.debugLabel);
    deps.saveDebugImage(mask.data, "AI object removal", "input", "mask");
    const response = await runTask("AI object removal", {
      task: buildInpaintingTask(scopedAsset.asset, mask, prompt, "remove"),
    });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI object removal returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI object removal", "output", "result");
    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      await artifactToCanvas(artifact, {
        expectedWidth: editable.doc.width,
        expectedHeight: editable.doc.height,
        extractRegion: targetRegion,
      }),
      "AI Remove Object",
      buildAiProvenance(response, "remove-object", prompt),
    );
    deps.renderEditorState();
    deps.showToast("Object removal applied.", "success");
  }

  async function inpaintSelection() {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }
    const sessionResult = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, DEFAULT_INPAINT_SESSION_CONFIG)
      : null;
    if (!sessionResult) {
      return;
    }
    const mask = buildMaskAssetFromCanvas(sessionResult.surfaceMask);
    if (!mask) {
      deps.showToast("Paint or select the area to inpaint.", "error");
      return;
    }
    const prompt = await aiPromptText("AI: Inpaint Selection", "Describe what should replace the selected area", "add a hat and sunglasses");
    if (!prompt) {
      return;
    }
    const inputScope = sessionResult.inputScope;
    deps.log(`AI inpaint: prompt="${prompt}", inputScope=${inputScope}, image=${editable.doc.width}×${editable.doc.height}, mask=${mask.width ?? 0}×${mask.height ?? 0}`);
    const scopedAsset = buildScopedInputAsset(editable.doc, inputScope);
    const targetRegion = {
      x: editable.layer.x,
      y: editable.layer.y,
      width: editable.layer.canvas.width,
      height: editable.layer.canvas.height,
    };
    deps.saveDebugImage(scopedAsset.asset.data, "AI inpainting", "input", scopedAsset.debugLabel);
    deps.saveDebugImage(mask.data, "AI inpainting", "input", "mask");
    const response = await runTask("AI inpainting", { task: buildInpaintingTask(scopedAsset.asset, mask, prompt, "replace") });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI inpainting returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI inpainting", "output", "result");
    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      await artifactToCanvas(artifact, {
        expectedWidth: editable.doc.width,
        expectedHeight: editable.doc.height,
        extractRegion: targetRegion,
      }),
      "AI Inpaint Selection",
      buildAiProvenance(response, "inpainting", prompt),
    );
    deps.renderEditorState();
    deps.showToast("Inpainting applied.", "success");
  }

  async function replaceRasterText() {
    const editable = getEditableRasterLayer();
    if (!editable) {
      return;
    }

    const sessionResult = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, DEFAULT_REPLACE_TEXT_SESSION_CONFIG)
      : null;
    if (!sessionResult) {
      return;
    }

    const preparedTarget = prepareMaskedRasterTarget({
      doc: editable.doc,
      layer: editable.layer,
      inputScope: sessionResult.inputScope,
      surfaceMask: sessionResult.surfaceMask,
      emptyMaskPolicy: "fill-full-target",
      emptyMaskMessage: "Selection mask is unavailable.",
    });
    if (!preparedTarget.ok) {
      deps.showToast(preparedTarget.error, "error");
      return;
    }
    const { target } = preparedTarget;
    const { selectionBounds, scopedAsset, maskAsset, isLayerScope, contentBoundsLocal } = target;

    deps.log(`AI replace raster text: selection=${JSON.stringify(selectionBounds)}, scope=${isLayerScope ? "layer" : "document"}`);
    deps.saveDebugImage(scopedAsset.asset.data, "AI replace raster text", "input", scopedAsset.debugLabel);
    deps.saveDebugImage(maskAsset.data, "AI replace raster text", "input", "mask");

    const textReplacementProviderId = deps.getPrimaryProviderIdForFamily?.("text-replacement");
    const textReplacementModel = deps.getPreferredModelForFamily?.("text-replacement");

    const result = await runTwoStageTextReplacement(
      {
        runTask: async (title, request) => runTask(title, {
          ...request,
          plannedProviderId: textReplacementProviderId,
          plannedModel: textReplacementModel,
        }),
        showToast: deps.showToast,
      },
      scopedAsset.asset,
      maskAsset,
    );

    if (!result.ok || !result.cleanedImageArtifact || !result.blocks) {
      deps.showToast(result.error ?? "AI text replacement returned invalid output.", "error");
      return;
    }

    deps.saveDebugImage(result.cleanedImageArtifact.data, "AI replace raster text", "output", "cleaned");

    let cleanedCanvas: HTMLCanvasElement;
    if (isLayerScope) {
      cleanedCanvas = await artifactToCanvas(result.cleanedImageArtifact, {
        expectedWidth: target.outputExpectedWidth,
        expectedHeight: target.outputExpectedHeight,
      });
    } else {
      const cleanedFullCanvas = await artifactToCanvas(result.cleanedImageArtifact, {
        expectedWidth: target.outputExpectedWidth,
        expectedHeight: target.outputExpectedHeight,
      });
      cleanedCanvas = target.toLayerCanvas(cleanedFullCanvas);
    }

    // Normalize AI-returned text block coordinates to document-space.
    // For layer-scope: AI coordinates are relative to cropped-content top-left →
    //   offset by layer position plus cropped content origin to get document-space.
    // For doc-scope: AI coordinates are relative to the selection crop →
    //   offset by selection bounds (already in document-space).
    const blockOffsetX = target.blockOffset.x;
    const blockOffsetY = target.blockOffset.y;
    const normalizedBlocks = result.blocks.map((block) => ({
      ...block,
      bounds: {
        x: block.bounds.x + blockOffsetX,
        y: block.bounds.y + blockOffsetY,
        width: block.bounds.width,
        height: block.bounds.height,
      },
    }));

    const reviewedBlocks = normalizedBlocks.length === 1
      ? await (async () => {
        const block = normalizedBlocks[0];
        const messageParts = ["Review and edit the reconstructed text before applying. Handwriting, curved, and decorative text may need manual correction."];
        if (typeof block.confidence === "number") {
          messageParts.push(`Confidence: ${Math.round(block.confidence * 100)}%`);
        }
        if (block.notes) {
          messageParts.push(`Note: ${block.notes}`);
        }
        const review = await aiPromptReviewText(
          "AI: Replace Raster Text",
          messageParts.join(" — "),
          block.text,
        );
        if (!review) {
          return null;
        }
        return [{ ...block, text: review.text }];
      })()
      : await (async () => {
        const hasConfidence = normalizedBlocks.some((b) => typeof b.confidence === "number");
        const hasNotes = normalizedBlocks.some((b) => !!b.notes);
        const messageParts = ["Review and edit each reconstructed text block before applying. Handwriting, curved, and decorative text may need manual correction."];
        if (hasConfidence) {
          const avgConfidence = normalizedBlocks.reduce((sum, b) => sum + (b.confidence ?? 0), 0) / normalizedBlocks.length;
          messageParts.push(`Average confidence: ${Math.round(avgConfidence * 100)}%`);
        }
        if (hasNotes) {
          const blockNotes = normalizedBlocks.filter((b) => b.notes).map((b, i) => `Block ${i + 1}: ${b.notes}`);
          messageParts.push(blockNotes.join("; "));
        }
        const review = await aiPromptReviewTextPieces(
          "AI: Replace Raster Text",
          messageParts.join(" — "),
          normalizedBlocks.map((block) => ({ id: block.id, text: block.text })),
        );
        if (!review) {
          return null;
        }
        const reviewedById = new Map(review.map((piece) => [piece.id, piece.text]));
        return normalizedBlocks
          .map((block) => {
            const text = reviewedById.get(block.id)?.trim() ?? "";
            return text ? { ...block, text } : null;
          })
          .filter((block): block is typeof normalizedBlocks[number] => block !== null);
      })();

    if (!reviewedBlocks || reviewedBlocks.length === 0) {
      deps.showToast("Raster text replacement cancelled.", "info");
      return;
    }

    applyStructuredTextReconstruction(
      editable.doc,
      editable.layer,
      cleanedCanvas,
      reviewedBlocks,
      "AI Replace Raster Text",
      isLayerScope
        ? {
          rasterX: editable.layer.x + (contentBoundsLocal?.x ?? 0),
          rasterY: editable.layer.y + (contentBoundsLocal?.y ?? 0),
        }
        : undefined,
    );

    for (const warning of result.warnings) {
      deps.log(`AI text reconstruction warning: ${warning}`, "WARN");
    }

    deps.renderEditorState();
    deps.showToast(
      reviewedBlocks.length > 1
        ? "Raster text replaced with editable text layers."
        : "Raster text replaced with an editable text layer.",
      "success",
    );
    return;
  }

  async function aiHealing() {
    const editable = getEditableRasterLayer();
    if (!editable) {
      return;
    }

    const sessionResult = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, DEFAULT_AI_HEALING_SESSION_CONFIG)
      : null;
    if (!sessionResult) {
      return;
    }

    const preparedTarget = prepareMaskedRasterTarget({
      doc: editable.doc,
      layer: editable.layer,
      inputScope: sessionResult.inputScope,
      surfaceMask: sessionResult.surfaceMask,
      emptyMaskPolicy: "error",
      emptyMaskMessage: DEFAULT_AI_HEALING_SESSION_CONFIG.channels.surface.validationMessage,
    });
    if (!preparedTarget.ok) {
      deps.showToast(preparedTarget.error, "error");
      return;
    }

    const { target } = preparedTarget;
    deps.log(`ai healing: inputScope=${sessionResult.inputScope}, scope=${target.isLayerScope ? "layer" : "document"}, selection=${JSON.stringify(target.selectionBounds)}`);
    deps.saveDebugImage(target.scopedAsset.asset.data, "AI healing", "input", target.scopedAsset.debugLabel);
    deps.saveDebugImage(target.maskAsset.data, "AI healing", "input", "mask");

    const response = await runTask("AI healing", {
      task: buildInpaintingTask(target.scopedAsset.asset, target.maskAsset, AI_HEALING_PROMPT, "replace"),
    });
    if (!response) {
      return;
    }

    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI Healing returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI healing", "output", "result");

    const resultCanvas = await artifactToCanvas(artifact, {
      expectedWidth: target.outputExpectedWidth,
      expectedHeight: target.outputExpectedHeight,
    });

    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      target.applyMaskedResultToLayerCanvas(resultCanvas),
      "AI Healing",
      buildAiProvenance(response, "healing", AI_HEALING_PROMPT),
    );
    deps.renderEditorState();
    deps.showToast("Healing applied.", "success");
  }

  async function outpaintCanvas() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("Open a document first.", "error");
      return;
    }
    const outpaintInput = await aiPromptOutpaintWithInputScope("AI: Outpaint Canvas", "Configure canvas expansion");
    if (!outpaintInput) {
      return;
    }
    const { prompt, expansion, inputScope } = outpaintInput;
    const { top, right, bottom, left } = expansion;
    const nextWidth = doc.width + left + right;
    const nextHeight = doc.height + top + bottom;
    if (nextWidth === doc.width && nextHeight === doc.height) {
      deps.showToast("Increase at least one canvas side for outpainting.", "info");
      return;
    }
    deps.log(`AI outpaint: inputScope=${inputScope}, expansion top=${top} right=${right} bottom=${bottom} left=${left}, new=${nextWidth}×${nextHeight}, prompt="${prompt}"`);
    const scopedAsset = buildScopedInputAsset(doc, inputScope);
    deps.saveDebugImage(scopedAsset.asset.data, "AI outpainting", "input", scopedAsset.debugLabel);
    const response = await runTask("AI outpainting", {
      task: buildGenerationTask(prompt, nextWidth, nextHeight, [scopedAsset.asset]),
    });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI outpainting returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI outpainting", "output", "result");
    const generatedCanvas = await artifactToCanvas(artifact, {
      expectedWidth: nextWidth,
      expectedHeight: nextHeight,
    });
    doc.undoStack.push(snapshotDocument(doc));
    doc.redoStack = [];
    for (const layer of doc.layers) {
      if (layer.type === "raster") {
        const resized = createLayerCanvas(nextWidth, nextHeight);
        resized.getContext("2d")?.drawImage(layer.canvas, left, top);
        layer.canvas = resized;
        layer.x = 0;
        layer.y = 0;
        syncLayerSource(layer);
      } else {
        layer.x += left;
        layer.y += top;
      }
    }
    doc.width = nextWidth;
    doc.height = nextHeight;
    addRasterLayerFromCanvas(doc, generatedCanvas, "AI Outpaint", "AI Outpaint Canvas", buildAiProvenance(response, "outpainting", prompt), { alreadySnapshotted: true });
    deps.renderEditorState();
    deps.showToast("Outpainted canvas added as a new layer.", "success");
  }

  async function upscaleActiveLayer() {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }
    const factorStr = await aiPromptSelect("AI: Upscale", "Choose upscale factor", [
      { value: "2", label: "2× Upscale" },
      { value: "4", label: "4× Upscale" },
    ]);
    if (!factorStr) {
      return;
    }
    const factor = Number(factorStr);
    const title = `AI upscale ${factor}x`;
    deps.log(`AI upscale: factor=${factor}, layer=${editable.layer.canvas.width}×${editable.layer.canvas.height}`);
    const layerAsset = buildLayerImageAsset(editable.layer);
    deps.saveDebugImage(layerAsset.data, title, "input", "layer");
    const response = await runTask(title, {
      task: buildEnhancementTask("upscale", layerAsset, { scaleFactor: factor, intensity: 1 }),
    });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI upscale returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, title, "output", "result");
    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      await artifactToCanvas(artifact, {
        expectedWidth: editable.layer.canvas.width * factor,
        expectedHeight: editable.layer.canvas.height * factor,
      }),
      `AI Upscale ${factor}x`,
      buildAiProvenance(response, "upscale", `${factor}x upscale`),
    );
    deps.renderEditorState();
    deps.showToast(response.warnings[0] ?? "Upscale applied.", "success");
  }

  async function runEnhancementFlow(mode: EnhancementMode) {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }

    const titles: Record<EnhancementMode, string> = {
      "auto-enhance": "AI Auto Enhance",
      "denoise": "AI Denoise",
      "restore": "AI Restore Photo",
      "style-transfer": "AI Style Transfer",
    };
    const descriptions: Record<EnhancementMode, string> = {
      "auto-enhance": "Adjust settings and apply an AI-assisted enhancement.",
      "denoise": "Adjust settings and apply noise reduction to the active layer.",
      "restore": "Adjust settings and apply AI photo repair and restoration.",
      "style-transfer": "Describe the style to apply to the active layer, optionally using reference images for visual style guidance.",
    };
    const defaults: Record<EnhancementMode, number> = {
      "auto-enhance": 65,
      "denoise": 55,
      "restore": 65,
      "style-transfer": 65,
    };

    const title = titles[mode];
    const result = await aiPromptEnhancement(title, descriptions[mode], {
      showPrompt: mode === "style-transfer",
      showReferenceImages: mode === "style-transfer",
      defaultIntensity: defaults[mode],
       defaultPrompt: mode === "style-transfer" ? "editorial matte film look" : undefined,
      promptLabel: mode === "style-transfer" ? "Style direction" : undefined,
      promptPlaceholder: mode === "style-transfer"
        ? "editorial matte film look"
        : undefined,
      referenceHelpText: mode === "style-transfer"
        ? "Optional. Add reference images when you want Vision Goblin to transfer their visual style onto the source image while preserving the source subject and composition."
        : undefined,
    });

    if (!result) {
      return;
    }

    deps.log(`AI enhancement: mode=${mode}, intensity=${result.intensity}${result.prompt ? `, prompt="${result.prompt}"` : ""}`);
    const referenceImages = mode === "style-transfer" ? await readReferenceImages(result.referenceFiles ?? null) : [];
    const layerAsset = buildLayerImageAsset(editable.layer);
    deps.saveDebugImage(layerAsset.data, title, "input", "layer");
    for (let i = 0; i < referenceImages.length; i++) {
      deps.saveDebugImage(referenceImages[i].data, title, "input", `reference-${i}`);
    }
    const response = await runTask(title, {
      task: buildEnhancementTask(mode, layerAsset, {
        intensity: result.intensity,
        prompt: result.prompt,
        referenceImages,
      }),
    });

    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast(`${title} returned no image.`, "error");
      return;
    }
    deps.saveDebugImage(artifact.data, title, "output", "result");

    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      await artifactToCanvas(artifact, {
        expectedWidth: editable.layer.canvas.width,
        expectedHeight: editable.layer.canvas.height,
      }),
      title,
      buildAiProvenance(response, mode, result.prompt),
    );
    deps.renderEditorState();
    deps.showToast(response.warnings[0] ?? `${title} applied.`, "success");
  }

  async function runDenoiseFlow() {
    const editable = getEditableRasterLayer();
    if (!editable) {
      return;
    }

    const sessionResult = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, DEFAULT_DENOISE_SESSION_CONFIG)
      : null;
    if (!sessionResult) {
      return;
    }

    const preparedTarget = prepareMaskedRasterTarget({
      doc: editable.doc,
      layer: editable.layer,
      inputScope: sessionResult.inputScope,
      surfaceMask: sessionResult.surfaceMask,
      emptyMaskPolicy: "fill-full-target",
      emptyMaskMessage: "Denoise selection mask is unavailable.",
    });
    if (!preparedTarget.ok) {
      deps.showToast(preparedTarget.error, "error");
      return;
    }

    const { target } = preparedTarget;
    deps.log(`AI denoise: inputScope=${sessionResult.inputScope}, strength=${sessionResult.intensity}, scope=${target.isLayerScope ? "layer" : "document"}, fallback=${target.usedFullTargetFallback ? "full-target" : "masked"}, selection=${JSON.stringify(target.selectionBounds)}`);
    deps.saveDebugImage(target.scopedAsset.asset.data, "AI denoise", "input", target.scopedAsset.debugLabel);
    deps.saveDebugImage(target.maskAsset.data, "AI denoise", "input", target.usedFullTargetFallback ? "mask-full-target" : "mask");

    const response = await runTask("AI Denoise", {
      task: buildEnhancementTask("denoise", target.scopedAsset.asset, {
        intensity: sessionResult.intensity / 100,
      }),
    });
    if (!response) {
      return;
    }

    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI Denoise returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI denoise", "output", "result");

    const resultCanvas = await artifactToCanvas(artifact, {
      expectedWidth: target.outputExpectedWidth,
      expectedHeight: target.outputExpectedHeight,
    });

    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      target.applyMaskedResultToLayerCanvas(resultCanvas),
      "AI Denoise",
      buildAiProvenance(response, "denoise"),
    );
    deps.renderEditorState();
    deps.showToast(response.warnings[0] ?? "AI Denoise applied.", "success");
  }

  function openAutoEnhanceModal() {
    void runEnhancementFlow("auto-enhance");
  }

  function openDenoiseModal() {
    void runDenoiseFlow();
  }

  function openStyleTransferModal() {
    void runEnhancementFlow("style-transfer");
  }

  function openRestoreModal() {
    void runEnhancementFlow("restore");
  }

  async function generateThumbnail() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("Open a document first.", "error");
      return;
    }
    const result = await aiPromptThumbnailWithInputScope();
    if (!result) {
      return;
    }
    const [w, h] = result.size.split("x").map(Number);
    let prompt = result.prompt;
    if (result.textOverlay) {
      prompt = buildThumbnailTextOverlayPrompt(prompt, result.textOverlay, result.textPosition ?? "bottom");
    }
    deps.log(`AI thumbnail: size=${result.size}, inputScope=${result.inputScope}, prompt="${result.prompt}"${result.textOverlay ? `, text="${result.textOverlay}" at ${result.textPosition}` : ""}`);
    const scopedAsset = buildScopedInputAsset(doc, result.inputScope);
    deps.saveDebugImage(scopedAsset.asset.data, "AI thumbnail generation", "input", scopedAsset.debugLabel);
    const response = await runTask("AI thumbnail generation", {
      task: buildGenerationTask(prompt, w, h, [scopedAsset.asset]),
    });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI thumbnail generation returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI thumbnail generation", "output", "result");
    addRasterLayerFromCanvas(
      doc,
      await artifactToCanvas(artifact, {
        expectedWidth: w,
        expectedHeight: h,
      }),
      `Thumbnail ${result.size}`,
      "AI Generate Thumbnail",
      buildAiProvenance(response, "generate-thumbnail", prompt),
    );
    deps.renderEditorState();
    deps.showToast("Thumbnail added as a new layer.", "success");
  }

  async function freeformAi() {
    const result = await aiPromptTextWithInputScope("AI: Freeform", "Describe what you want the AI to do with this image", "make it look vintage");
    if (!result) {
      return;
    }
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("Open a document first.", "error");
      return;
    }
    const { prompt, inputScope } = result;
    deps.log(`AI freeform: prompt="${prompt}", inputScope=${inputScope}, doc=${doc.width}×${doc.height}`);
    const scopedAsset = buildScopedInputAsset(doc, inputScope);
    deps.saveDebugImage(scopedAsset.asset.data, "AI freeform", "input", scopedAsset.debugLabel);
    const response = await runTask("AI freeform", {
      task: buildGenerationTask(prompt, doc.width, doc.height, [scopedAsset.asset]),
    });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI freeform returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI freeform", "output", "result");
    addRasterLayerFromCanvas(
      doc,
      await artifactToCanvas(artifact, {
        expectedWidth: doc.width,
        expectedHeight: doc.height,
      }),
      "AI Freeform",
      "AI Freeform",
      buildAiProvenance(response, "freeform", prompt),
    );
    deps.renderEditorState();
    deps.showToast("Freeform AI result added as a new layer.", "success");
  }

  async function addShadow() {
    await runAiMaskGuidedEdit({
      actionLabel: "AI Add Shadow",
      title: "AI shadow generation",
      debugJobName: "AI shadow",
      providerRequirementLabel: "AI Add Shadow",
      blockedProviderMessage: "AI Add Shadow currently requires Google Gemini as the primary inpainting provider.",
      successMessage: "Shadow applied.",
      historyLabel: "AI Add Shadow",
      provenanceOperation: "add-shadow",
      sessionConfig: DEFAULT_ADD_SHADOW_SESSION_CONFIG,
    });
  }

  async function removeShadow() {
    await runAiMaskGuidedEdit({
      actionLabel: "AI Remove Shadow",
      title: "AI shadow removal",
      debugJobName: "AI shadow removal",
      providerRequirementLabel: "AI Remove Shadow",
      blockedProviderMessage: "AI Remove Shadow currently requires Google Gemini as the primary inpainting provider.",
      successMessage: "Shadow removal applied.",
      historyLabel: "AI Remove Shadow",
      provenanceOperation: "remove-shadow",
      sessionConfig: DEFAULT_REMOVE_SHADOW_SESSION_CONFIG,
    });
  }

  async function addReflection() {
    await runAiMaskGuidedEdit({
      actionLabel: "AI Add Reflection",
      title: "AI reflection generation",
      debugJobName: "AI reflection",
      providerRequirementLabel: "AI Add Reflection",
      blockedProviderMessage: "AI Add Reflection currently requires Google Gemini as the primary inpainting provider.",
      successMessage: "Reflection applied.",
      historyLabel: "AI Add Reflection",
      provenanceOperation: "add-reflection",
      sessionConfig: DEFAULT_ADD_REFLECTION_SESSION_CONFIG,
    });
  }

  async function removeReflection() {
    await runAiMaskGuidedEdit({
      actionLabel: "AI Remove Reflection",
      title: "AI reflection removal",
      debugJobName: "AI reflection removal",
      providerRequirementLabel: "AI Remove Reflection",
      blockedProviderMessage: "AI Remove Reflection currently requires Google Gemini as the primary inpainting provider.",
      successMessage: "Reflection removal applied.",
      historyLabel: "AI Remove Reflection",
      provenanceOperation: "remove-reflection",
      sessionConfig: DEFAULT_REMOVE_REFLECTION_SESSION_CONFIG,
    });
  }

  async function cloneObject() {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }
    const primaryInpaintingProvider = deps.getPrimaryProviderIdForFamily?.("inpainting");
    if (primaryInpaintingProvider && primaryInpaintingProvider !== "gemini") {
      deps.log(`ai clone object blocked: primary inpainting provider is ${primaryInpaintingProvider}, but guided object cloning requires Gemini.`, "WARN");
      deps.showToast("AI Clone Object currently requires Google Gemini as the primary inpainting provider.", "error");
      return;
    }

    const guideState = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, DEFAULT_CLONE_OBJECT_SESSION_CONFIG)
      : {
          guideMode: DEFAULT_CLONE_OBJECT_SESSION_CONFIG.guideMode,
          intensity: DEFAULT_CLONE_OBJECT_SESSION_CONFIG.defaults?.intensity ?? 50,
          lightDirection: "auto" as const,
          inputScope: DEFAULT_AI_INPUT_SCOPE,
          casterMask: createMaskCanvas(editable.doc.width, editable.doc.height),
          surfaceMask: createMaskCanvas(editable.doc.width, editable.doc.height),
        };
    if (!guideState) {
      return;
    }

    if (isMaskEmpty(guideState.casterMask)) {
      deps.showToast(DEFAULT_CLONE_OBJECT_SESSION_CONFIG.channels.caster.validationMessage, "error");
      return;
    }
    if (isMaskEmpty(guideState.surfaceMask)) {
      deps.showToast(DEFAULT_CLONE_OBJECT_SESSION_CONFIG.channels.surface.validationMessage, "error");
      return;
    }

    const destinationComponents = splitMaskIntoConnectedComponents(guideState.surfaceMask);
    const cloneDestinations = destinationComponents.filter((component) => component.pixelCount >= CLONE_OBJECT_MIN_DESTINATION_PIXELS);
    const ignoredSpecks = destinationComponents.length - cloneDestinations.length;

    if (cloneDestinations.length === 0) {
      deps.showToast(`AI Clone Object requires at least one destination area larger than ${CLONE_OBJECT_MIN_DESTINATION_PIXELS} pixels. Tiny black specks are ignored.`, "error");
      return;
    }

    const filteredDestinationMask = createGuideMaskUnion(...cloneDestinations.map((component) => component.canvas));
    if (!filteredDestinationMask) {
      deps.showToast("Could not build the clone object destination mask.", "error");
      return;
    }

    const prompt = buildGuideDrivenInpaintingPrompt("clone-object", {
      intensity: guideState.intensity,
      lightDirection: guideState.lightDirection,
    });
    deps.log(`ai clone object: guideMode=${guideState.guideMode}, inputScope=${guideState.inputScope}, destinations=${cloneDestinations.length}, ignoredSpecks=${ignoredSpecks}, execution=single-pass`);

    const scopedAsset = buildScopedInputAsset(editable.doc, guideState.inputScope);
    const targetRegion = {
      x: editable.layer.x,
      y: editable.layer.y,
      width: editable.layer.canvas.width,
      height: editable.layer.canvas.height,
    };
    deps.saveDebugImage(scopedAsset.asset.data, "AI clone object", "input", scopedAsset.debugLabel);

    const editMask = buildDualColorGuideMaskAsset("clone-object", guideState.casterMask, filteredDestinationMask);
    if (!editMask) {
      deps.showToast("Could not build the clone object task assets.", "error");
      return;
    }

    deps.saveDebugImage(editMask.data, "AI clone object", "input", "clone-guide");
    const response = await runTask("AI clone object", {
      task: buildInpaintingTask(scopedAsset.asset, editMask, prompt, "replace", {
        guideMode: "clone-object",
      }),
      fallbackPolicy: "forbid",
    });
    if (!response) {
      return;
    }

    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast("AI Clone Object returned no image.", "error");
      return;
    }
    deps.saveDebugImage(artifact.data, "AI clone object", "output", "result");

    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      await artifactToCanvas(artifact, {
        expectedWidth: editable.doc.width,
        expectedHeight: editable.doc.height,
        extractRegion: targetRegion,
      }),
      "AI Clone Object",
      buildAiProvenance(response, "clone-object", prompt),
    );
    deps.renderEditorState();
    deps.showToast("Object cloned.", "success");
  }

  async function moveObject() {
    await runAiMaskGuidedEdit({
      actionLabel: "AI Move Object",
      title: "AI move object",
      debugJobName: "AI move object",
      providerRequirementLabel: "AI Move Object",
      blockedProviderMessage: "AI Move Object currently requires Google Gemini as the primary inpainting provider.",
      successMessage: "Object moved.",
      historyLabel: "AI Move Object",
      provenanceOperation: "move-object",
      sessionConfig: DEFAULT_MOVE_OBJECT_SESSION_CONFIG,
      validateGuideState: ({ guideState }) => {
        const destinationIslands = splitMaskIntoConnectedComponents(guideState.surfaceMask);
        if (destinationIslands.length > 1) {
          return {
            ok: false,
            toast: "AI Move Object currently supports exactly one destination area. Please keep the black guide as a single connected island.",
          };
        }
        return { ok: true };
      },
      buildTaskAssets: ({ guideState }) => {
        const editMask = buildDualColorGuideMaskAsset("move-object", guideState.casterMask, guideState.surfaceMask);
        if (!editMask) {
          return {
            ok: false,
            toast: "Paint the object to move and one destination area before applying.",
          };
        }
        return {
          ok: true,
          editMask,
        };
      },
    });
  }

  async function runAiMaskGuidedEdit(options: {
    actionLabel: string;
    title: string;
    debugJobName: string;
    providerRequirementLabel: string;
    blockedProviderMessage: string;
    successMessage: string;
    historyLabel: string;
    provenanceOperation: string;
    sessionConfig: AiMaskSessionConfig;
    validateGuideState?: (args: { guideState: AiMaskSessionResult }) => { ok: true } | { ok: false; toast: string };
    buildTaskAssets?: (args: { guideState: AiMaskSessionResult }) =>
      | { ok: true; editMask: AiMaskAsset }
      | { ok: false; toast: string };
  }) {
    const editable = getEditableLayer();
    if (!editable) {
      return;
    }
    const primaryInpaintingProvider = deps.getPrimaryProviderIdForFamily?.("inpainting");
    if (primaryInpaintingProvider && primaryInpaintingProvider !== "gemini") {
      deps.log(`${options.actionLabel.toLowerCase()} blocked: primary inpainting provider is ${primaryInpaintingProvider}, but dual-guide shadow generation requires Gemini.`, "WARN");
      deps.showToast(options.blockedProviderMessage, "error");
      return;
    }
    const guideState = deps.startAiMaskSession
      ? await deps.startAiMaskSession(editable.doc, options.sessionConfig)
      : {
          guideMode: options.sessionConfig.guideMode,
          intensity: options.sessionConfig.defaults?.intensity ?? 50,
          lightDirection: "auto" as const,
          inputScope: DEFAULT_AI_INPUT_SCOPE,
          casterMask: createMaskCanvas(editable.doc.width, editable.doc.height),
          surfaceMask: createMaskCanvas(editable.doc.width, editable.doc.height),
        };
    if (!guideState) {
      return;
    }
    const { guideMode, intensity, lightDirection, inputScope } = guideState;
    if (isMaskEmpty(guideState.surfaceMask)) {
      deps.showToast(options.sessionConfig.channels.surface.validationMessage, "error");
      return;
    }

    const validationResult = options.validateGuideState?.({ guideState });
    if (validationResult && !validationResult.ok) {
      deps.showToast(validationResult.toast, "error");
      return;
    }

    const taskAssets = options.buildTaskAssets?.({ guideState }) ?? (() => {
      const editMask = buildDualColorGuideMaskAsset(guideState.guideMode, guideState.casterMask, guideState.surfaceMask);
      if (!editMask) {
        return {
          ok: false as const,
          toast: "Paint both guides before applying.",
        };
      }
      return {
        ok: true as const,
        editMask,
      };
    })();
    if (!taskAssets.ok) {
      deps.showToast(taskAssets.toast, "error");
      return;
    }

    const prompt = buildGuideDrivenInpaintingPrompt(guideMode, { intensity, lightDirection });
    deps.log(`${options.actionLabel.toLowerCase()}: guideMode=${guideMode}, intensity=${intensity}, lightDirection=${lightDirection}, inputScope=${inputScope}`);
    const scopedAsset = buildScopedInputAsset(editable.doc, inputScope);
    const targetRegion = {
      x: editable.layer.x,
      y: editable.layer.y,
      width: editable.layer.canvas.width,
      height: editable.layer.canvas.height,
    };
    deps.saveDebugImage(scopedAsset.asset.data, options.debugJobName, "input", scopedAsset.debugLabel);
    deps.saveDebugImage(taskAssets.editMask.data, options.debugJobName, "input", "guide-mask");
    const response = await runTask(options.title, {
      task: buildInpaintingTask(scopedAsset.asset, taskAssets.editMask, prompt, "replace", {
        guideMode,
      }),
      fallbackPolicy: "forbid",
    });
    if (!response) {
      return;
    }
    const artifact = getImageArtifact(response);
    if (!artifact) {
      deps.showToast(`${options.providerRequirementLabel} returned no image.`, "error");
      return;
    }
    deps.saveDebugImage(artifact.data, options.debugJobName, "output", "result");
    replaceLayerWithCanvas(
      editable.doc,
      editable.layer,
      await artifactToCanvas(artifact, {
        expectedWidth: editable.doc.width,
        expectedHeight: editable.doc.height,
        extractRegion: targetRegion,
      }),
      options.historyLabel,
      buildAiProvenance(response, options.provenanceOperation, prompt),
    );
    deps.renderEditorState();
    deps.showToast(options.successMessage, "success");
  }

  function bindButton(id: string, handler: () => void | Promise<void>) {
    const button = document.getElementById(id);
    if (!button) {
      return;
    }
    button.addEventListener("click", () => {
      void handler();
    });
  }

  function bind() {
    bindButton("ai-select-subject-btn", selectSubject);
    bindButton("ai-select-background-btn", selectBackground);
    bindButton("ai-select-object-btn", selectObjectByPrompt);
    bindButton("ai-remove-background-btn", removeBackground);
    bindButton("ai-remove-object-btn", removeObject);
    bindButton("ai-auto-enhance-btn", openAutoEnhanceModal);
    bindButton("ai-upscale-btn", upscaleActiveLayer);
    bindButton("ai-denoise-btn", openDenoiseModal);
    bindButton("ai-inpaint-btn", inpaintSelection);
    bindButton("ai-outpaint-btn", outpaintCanvas);
    bindButton("ai-style-transfer-btn", openStyleTransferModal);
    bindButton("ai-restore-btn", openRestoreModal);
    bindButton("ai-thumbnail-btn", generateThumbnail);
    bindButton("ai-freeform-btn", freeformAi);
    bindButton("ai-add-shadow-btn", addShadow);
    bindButton("ai-remove-shadow-btn", removeShadow);
    bindButton("ai-add-reflection-btn", addReflection);
    bindButton("ai-remove-reflection-btn", removeReflection);
    bindButton("ai-clone-object-btn", cloneObject);
    bindButton("ai-move-object-btn", moveObject);
    bindButton("ai-healing-btn", aiHealing);
  }

  return {
    bind,
    selectSubject,
    selectBackground,
    selectObjectByPrompt,
    removeBackground,
    removeObject,
    openAutoEnhanceModal,
    upscaleActiveLayer,
    openDenoiseModal,
    inpaintSelection,
    outpaintCanvas,
    openStyleTransferModal,
    openRestoreModal,
    generateThumbnail,
    freeformAi,
    addShadow,
    removeShadow,
    addReflection,
    removeReflection,
    cloneObject,
    moveObject,
    replaceRasterText,
    aiHealing,
  };
}
