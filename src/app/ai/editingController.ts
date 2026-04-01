import { createLayerCanvas, snapshotDocument, syncLayerSource } from "../../editor/documents";
import { isMaskEmpty, maskBoundingRect } from "../../editor/selection";
import type { DocumentState, Layer } from "../../editor/types";
import type { AiController } from "./controller";
import type { AiInputScope, AiTask } from "./types";
import { aiPromptTextWithInputScope, aiPromptSelect, aiPromptOutpaintWithInputScope, aiPromptEnhancement, aiPromptRemoveBackgroundWithInputScope, aiPromptThumbnailWithInputScope, aiPromptInputScope } from "./aiPromptModal";
import {
  addRasterLayerFromCanvas,
  applyMaskToLayer,
  applyMaskToSelection,
  artifactToCanvas,
  buildAiProvenance,
  buildBackgroundComposite,
  buildScopedCompositeImageAsset,
  buildCutoutCanvas,
  buildEnhancementTask,
  buildGenerationTask,
  buildInpaintingTask,
  buildLayerImageAsset,
  buildSegmentationTask,
  buildSelectionMaskAsset,
  getImageArtifact,
  getMaskArtifact,
  readReferenceImages,
  replaceLayerWithCanvas,
  waitForJob,
} from "./editingSupport";

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
}

interface AiTaskLogSummary {
  rawPrompt?: string;
  promptMetadata?: string;
}

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
        return {
          rawPrompt: task.prompt,
          promptMetadata: `image=${task.input.image.width ?? "?"}×${task.input.image.height ?? "?"}, mask=${task.input.mask.width ?? "?"}×${task.input.mask.height ?? "?"}, mode=${task.options?.mode ?? "replace"}`,
        };
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
      const prompt = result.description || "soft studio backdrop";
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
    let mask = buildSelectionMaskAsset(editable.doc);
    let prompt = "Remove the selected distraction and reconstruct the background.";
    let inputScope: AiInputScope = "visible-content";
    if (mask) {
      deps.log(`AI remove object: using selection mask, ${mask.width ?? 0}×${mask.height ?? 0}`);
    }
    if (!mask) {
      const result = await aiPromptTextWithInputScope("AI: Remove Object", "What should Vision Goblin remove?", "stray person");
      if (!result) {
        deps.showToast("Select something or describe the object to remove.", "info");
        return;
      }
      const { prompt: objectPrompt } = result;
      inputScope = result.inputScope;
      deps.log(`AI remove object: prompt-based detection, prompt="${objectPrompt}"`);
      prompt = `Remove the ${objectPrompt} and reconstruct the background naturally.`;
      const selection = await runSegmentation("object", objectPrompt, inputScope);
      if (!selection) {
        return;
      }
      mask = {
        kind: "mask",
        mimeType: "image/png",
        data: selection.mask.toDataURL("image/png"),
        width: selection.mask.width,
        height: selection.mask.height,
      };
    }
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
    const mask = buildSelectionMaskAsset(editable.doc);
    if (!mask) {
      deps.showToast("Create a selection before using inpainting.", "error");
      return;
    }
    const result = await aiPromptTextWithInputScope("AI: Inpaint Selection", "Describe what should replace the selected area", "add a hat and sunglasses");
    if (!result) {
      return;
    }
    const { prompt, inputScope } = result;
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

  function openAutoEnhanceModal() {
    void runEnhancementFlow("auto-enhance");
  }

  function openDenoiseModal() {
    void runEnhancementFlow("denoise");
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
      prompt += `. Include the text "${result.textOverlay}" positioned at the ${result.textPosition} of the image.`;
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
  };
}
