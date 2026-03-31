import type { AiTaskSuccess } from "./contracts";
import type { AiController } from "./controller";
import type { AiJobRecord } from "./jobQueue";
import type { AiArtifact, AiEnhancementTask, AiGenerationTask, AiImageArtifact, AiImageAsset, AiInpaintingTask, AiInputScope, AiMaskArtifact, AiMaskAsset, AiSegmentationTask } from "./types";
import { blobToImage, cloneCanvas, compositeDocumentOnto, createLayerCanvas, snapshotDocument, syncLayerSource } from "../../editor/documents";
import { pushHistory } from "../../editor/history";
import { getSelectedLayerIds } from "../../editor/layers";
import { createMaskCanvas, isMaskEmpty, maskBoundingRect } from "../../editor/selection";
import type { AiProvenanceRecord, DocumentState, Layer, RasterLayer } from "../../editor/types";
import { nextId } from "../../editor/utils";

export interface ScopedImageAssetResult {
  asset: AiImageAsset;
  inputScope: AiInputScope;
  debugLabel: "composite" | "selected-layers";
}

export function buildCompositeImageAsset(doc: DocumentState): AiImageAsset {
  const canvas = createLayerCanvas(doc.width, doc.height);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    compositeDocumentOnto(ctx, doc, 0, 0, 1);
  }
  return canvasToImageAsset(canvas);
}

export function buildSelectedLayersImageAsset(doc: DocumentState): AiImageAsset {
  const selectedLayerIds = new Set(getSelectedLayerIds(doc));
  const canvas = createLayerCanvas(doc.width, doc.height);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    compositeDocumentOnto(
      ctx,
      {
        ...doc,
        layers: doc.layers.filter((layer) => selectedLayerIds.has(layer.id)),
      },
      0,
      0,
      1,
    );
  }
  return canvasToImageAsset(canvas);
}

export function buildScopedCompositeImageAsset(doc: DocumentState, inputScope: AiInputScope): ScopedImageAssetResult {
  if (inputScope === "selected-layers") {
    return {
      asset: buildSelectedLayersImageAsset(doc),
      inputScope,
      debugLabel: "selected-layers",
    };
  }

  return {
    asset: buildCompositeImageAsset(doc),
    inputScope,
    debugLabel: "composite",
  };
}

export function buildLayerImageAsset(layer: Layer): AiImageAsset {
  return canvasToImageAsset(layer.canvas);
}

export function buildSelectionMaskAsset(doc: DocumentState): AiMaskAsset | null {
  if (!doc.selectionMask) {
    return null;
  }
  const normalizedMask = buildBinaryAiMaskCanvas(doc.selectionMask);
  return {
    kind: "mask",
    mimeType: "image/png",
    data: normalizedMask.toDataURL("image/png"),
    width: normalizedMask.width,
    height: normalizedMask.height,
  };
}

function buildBinaryAiMaskCanvas(selectionMask: HTMLCanvasElement): HTMLCanvasElement {
  const normalizedMask = createMaskCanvas(selectionMask.width, selectionMask.height);
  const sourceContext = selectionMask.getContext("2d");
  const targetContext = normalizedMask.getContext("2d");

  if (!sourceContext || !targetContext) {
    return selectionMask;
  }

  const sourceMaskData = sourceContext.getImageData(0, 0, selectionMask.width, selectionMask.height);
  const normalizedMaskData = targetContext.createImageData(selectionMask.width, selectionMask.height);

  for (let i = 0; i < sourceMaskData.data.length; i += 4) {
    const value = sourceMaskData.data[i + 3] > 0 ? 255 : 0;
    normalizedMaskData.data[i] = value;
    normalizedMaskData.data[i + 1] = value;
    normalizedMaskData.data[i + 2] = value;
    normalizedMaskData.data[i + 3] = 255;
  }

  targetContext.putImageData(normalizedMaskData, 0, 0);
  return normalizedMask;
}

export function canvasToImageAsset(canvas: HTMLCanvasElement): AiImageAsset {
  return {
    kind: "image",
    mimeType: "image/png",
    data: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

export function buildSegmentationTask(mode: NonNullable<AiSegmentationTask["options"]>["mode"], image: AiImageAsset, prompt?: string): AiSegmentationTask {
  return {
    id: `ai-seg-${crypto.randomUUID()}`,
    family: "segmentation",
    prompt,
    input: { image, subjectHint: prompt },
    options: { mode },
  };
}

export function buildEnhancementTask(operation: NonNullable<AiEnhancementTask["options"]>["operation"], image: AiImageAsset, options: {
  intensity?: number;
  scaleFactor?: number;
  prompt?: string;
  referenceImages?: AiImageAsset[];
} = {}): AiEnhancementTask {
  return {
    id: `ai-enh-${crypto.randomUUID()}`,
    family: "enhancement",
    prompt: options.prompt,
    input: {
      image,
      referenceImages: options.referenceImages,
    },
    options: {
      operation,
      intensity: options.intensity,
      scaleFactor: options.scaleFactor,
    },
  };
}

export function buildInpaintingTask(image: AiImageAsset, mask: AiMaskAsset, prompt: string, mode: NonNullable<AiInpaintingTask["options"]>["mode"]): AiInpaintingTask {
  return {
    id: `ai-inpaint-${crypto.randomUUID()}`,
    family: "inpainting",
    prompt,
    input: { image, mask },
    options: { mode },
  };
}

export function buildGenerationTask(prompt: string, width: number, height: number, referenceImages?: AiImageAsset[]): AiGenerationTask {
  return {
    id: `ai-gen-${crypto.randomUUID()}`,
    family: "generation",
    prompt,
    input: referenceImages?.length ? { referenceImages } : undefined,
    options: { width, height, imageCount: 1 },
  };
}

export function waitForJob(aiController: AiController, jobId: string): Promise<AiJobRecord> {
  return new Promise((resolve) => {
    const unsubscribe = aiController.subscribeJobs(() => {
      const job = aiController.getJob(jobId);
      if (!job) {
        return;
      }
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        unsubscribe();
        resolve(job);
      }
    });
  });
}

export interface ArtifactCanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtifactToCanvasOptions {
  expectedWidth?: number;
  expectedHeight?: number;
  extractRegion?: ArtifactCanvasRegion;
}

export async function artifactToCanvas(
  artifact: AiImageArtifact | AiMaskArtifact,
  options: ArtifactToCanvasOptions = {},
): Promise<HTMLCanvasElement> {
  const image = await blobToImage(await (await fetch(artifact.data)).blob());
  const canvas = createLayerCanvas(
    options.expectedWidth ?? artifact.width ?? image.naturalWidth,
    options.expectedHeight ?? artifact.height ?? image.naturalHeight,
  );
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const widthScale = canvas.width / image.naturalWidth;
    const heightScale = canvas.height / image.naturalHeight;
    const scale = Math.max(widthScale, heightScale);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  }

  if (!options.extractRegion) {
    return canvas;
  }

  const { x, y, width, height } = options.extractRegion;
  const extracted = createLayerCanvas(width, height);
  extracted.getContext("2d")?.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return extracted;
}

export function getImageArtifact(result: AiTaskSuccess): AiImageArtifact | null {
  return result.artifacts.find((artifact): artifact is AiImageArtifact => artifact.kind === "image") ?? null;
}

export function getMaskArtifact(result: AiTaskSuccess): AiMaskArtifact | null {
  return result.artifacts.find((artifact): artifact is AiMaskArtifact => artifact.kind === "mask") ?? null;
}

export function buildAiProvenance(result: AiTaskSuccess, operation: string, prompt?: string): AiProvenanceRecord {
  return {
    providerId: result.providerId,
    model: result.model,
    taskId: result.taskId,
    family: result.family,
    operation,
    prompt,
    warnings: [...result.warnings],
    createdAt: new Date().toISOString(),
  };
}

export function applyMaskToSelection(doc: DocumentState, mask: HTMLCanvasElement, historyLabel: string): boolean {
  if (isMaskEmpty(mask)) {
    return false;
  }
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  doc.selectionRect = maskBoundingRect(mask);
  doc.selectionShape = "rect";
  doc.selectionInverted = false;
  doc.selectionPath = null;
  doc.selectionMask = cloneCanvas(mask);
  doc.dirty = true;
  pushHistory(doc, historyLabel);
  return true;
}

export function applyMaskToLayer(doc: DocumentState, layer: Layer, mask: HTMLCanvasElement, historyLabel: string) {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.mask = cloneCanvas(mask);
  doc.dirty = true;
  pushHistory(doc, historyLabel);
}

export function replaceLayerWithCanvas(doc: DocumentState, layer: Layer, canvas: HTMLCanvasElement, historyLabel: string, provenance?: AiProvenanceRecord) {
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  layer.canvas = cloneCanvas(canvas);
  syncLayerSource(layer);
  layer.aiProvenance = provenance;
  if (layer.x === 0 && layer.y === 0 && canvas.width >= doc.width && canvas.height >= doc.height) {
    doc.width = canvas.width;
    doc.height = canvas.height;
  }
  doc.dirty = true;
  pushHistory(doc, historyLabel);
}

export function addRasterLayerFromCanvas(
  doc: DocumentState,
  canvas: HTMLCanvasElement,
  name: string,
  historyLabel: string,
  provenance?: AiProvenanceRecord,
  options: { alreadySnapshotted?: boolean } = {},
): RasterLayer {
  if (!options.alreadySnapshotted) {
    doc.undoStack.push(snapshotDocument(doc));
    doc.redoStack = [];
  }
  const layer: RasterLayer = {
    id: nextId("layer"),
    type: "raster",
    name,
    canvas: cloneCanvas(canvas),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    effects: [],
    aiProvenance: provenance,
  };
  syncLayerSource(layer);
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  doc.dirty = true;
  pushHistory(doc, historyLabel);
  return layer;
}

export function buildCutoutCanvas(source: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const output = createLayerCanvas(source.width, source.height);
  const ctx = output.getContext("2d");
  if (ctx) {
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  return output;
}

export function buildBackgroundComposite(subject: HTMLCanvasElement, background: HTMLCanvasElement): HTMLCanvasElement {
  const output = createLayerCanvas(background.width, background.height);
  const ctx = output.getContext("2d");
  if (ctx) {
    ctx.drawImage(background, 0, 0, output.width, output.height);
    ctx.drawImage(subject, 0, 0);
  }
  return output;
}

export async function readReferenceImages(files: FileList | null): Promise<AiImageAsset[]> {
  const entries = Array.from(files ?? []);
  return Promise.all(entries.map(async (file) => ({
    kind: "image" as const,
    mimeType: file.type || "image/png",
    data: await readFileAsDataUrl(file),
  })));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
