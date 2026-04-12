import type { AiTaskSuccess } from "./contracts";
import type { AiController } from "./controller";
import type { AiJobRecord } from "./jobQueue";
import type { AiArtifact, AiEnhancementTask, AiGenerationTask, AiGuideMode, AiImageArtifact, AiImageAsset, AiInpaintingTask, AiInputScope, AiJsonArtifact, AiMaskArtifact, AiMaskAsset, AiSegmentationTask, AiTextReplacementTask } from "./types";
import {
  blobToImage,
  cloneCanvas,
  compositeDocumentOnto,
  createLayerCanvas,
  extractRasterLayerContentCanvas,
  getRasterLayerContentBoundsLocal,
  snapshotDocument,
  syncLayerSource,
  type LayerLocalBounds,
} from "../../editor/documents";
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

export interface RasterLayerContentImageAssetResult {
  asset: AiImageAsset;
  boundsLocal: LayerLocalBounds | null;
}

export interface GuideConnectedComponent {
  canvas: HTMLCanvasElement;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pixelCount: number;
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

export function buildRasterLayerContentImageAsset(layer: RasterLayer): RasterLayerContentImageAssetResult {
  const boundsLocal = getRasterLayerContentBoundsLocal(layer);
  const canvas = extractRasterLayerContentCanvas(layer, boundsLocal);
  return {
    asset: canvasToImageAsset(canvas),
    boundsLocal,
  };
}

export function buildMaskAssetFromCanvas(maskCanvas: HTMLCanvasElement | null): AiMaskAsset | null {
  if (!maskCanvas || isMaskEmpty(maskCanvas)) {
    return null;
  }
  const normalizedMask = buildBinaryAiMaskCanvas(maskCanvas);
  return {
    kind: "mask",
    mimeType: "image/png",
    data: normalizedMask.toDataURL("image/png"),
    width: normalizedMask.width,
    height: normalizedMask.height,
  };
}

export function buildSelectionMaskAsset(doc: DocumentState): AiMaskAsset | null {
  return buildMaskAssetFromCanvas(doc.selectionMask);
}

export function buildDualColorAiMaskAsset(casterMask: HTMLCanvasElement | null, surfaceMask: HTMLCanvasElement | null): AiImageAsset | null {
  if (!casterMask || !surfaceMask || isMaskEmpty(casterMask) || isMaskEmpty(surfaceMask)) {
    return null;
  }

  const width = casterMask.width;
  const height = casterMask.height;
  if (surfaceMask.width !== width || surfaceMask.height !== height) {
    return null;
  }

  const guideCanvas = createLayerCanvas(width, height);
  const guideContext = guideCanvas.getContext("2d");
  const casterContext = casterMask.getContext("2d");
  const surfaceContext = surfaceMask.getContext("2d");
  if (!guideContext || !casterContext || !surfaceContext) {
    return null;
  }

  const casterData = casterContext.getImageData(0, 0, width, height).data;
  const surfaceData = surfaceContext.getImageData(0, 0, width, height).data;
  const guideImageData = guideContext.createImageData(width, height);

  for (let i = 0; i < guideImageData.data.length; i += 4) {
    const hasCaster = casterData[i + 3] > 0;
    const hasSurface = surfaceData[i + 3] > 0;
    if (hasCaster) {
      guideImageData.data[i] = 255;
      guideImageData.data[i + 1] = 0;
      guideImageData.data[i + 2] = 0;
      guideImageData.data[i + 3] = 255;
    } else if (hasSurface) {
      guideImageData.data[i] = 0;
      guideImageData.data[i + 1] = 0;
      guideImageData.data[i + 2] = 0;
      guideImageData.data[i + 3] = 255;
    } else {
      guideImageData.data[i] = 255;
      guideImageData.data[i + 1] = 255;
      guideImageData.data[i + 2] = 255;
      guideImageData.data[i + 3] = 255;
    }
  }

  guideContext.putImageData(guideImageData, 0, 0);
  return canvasToImageAsset(guideCanvas);
}

export function buildGuideImageAssetForMode(
  guideMode: AiGuideMode,
  casterMask: HTMLCanvasElement | null,
  surfaceMask: HTMLCanvasElement | null,
): AiImageAsset | null {
  if (!surfaceMask || isMaskEmpty(surfaceMask)) {
    return null;
  }

  switch (guideMode) {
    case "shadow-remove":
    case "reflection-remove": {
      const width = surfaceMask.width;
      const height = surfaceMask.height;
      if (casterMask && (casterMask.width !== width || casterMask.height !== height)) {
        return null;
      }

      const guideCanvas = createLayerCanvas(width, height);
      const guideContext = guideCanvas.getContext("2d");
      const surfaceContext = surfaceMask.getContext("2d");
      const casterContext = casterMask?.getContext("2d") ?? null;
      if (!guideContext || !surfaceContext) {
        return null;
      }

      const surfaceData = surfaceContext.getImageData(0, 0, width, height).data;
      const casterData = casterContext?.getImageData(0, 0, width, height).data ?? null;
      const guideImageData = guideContext.createImageData(width, height);

      for (let i = 0; i < guideImageData.data.length; i += 4) {
        const hasCaster = casterData ? casterData[i + 3] > 0 : false;
        const hasSurface = surfaceData[i + 3] > 0;
        if (hasCaster) {
          guideImageData.data[i] = 255;
          guideImageData.data[i + 1] = 0;
          guideImageData.data[i + 2] = 0;
          guideImageData.data[i + 3] = 255;
        } else if (hasSurface) {
          guideImageData.data[i] = 0;
          guideImageData.data[i + 1] = 0;
          guideImageData.data[i + 2] = 0;
          guideImageData.data[i + 3] = 255;
        } else {
          guideImageData.data[i] = 255;
          guideImageData.data[i + 1] = 255;
          guideImageData.data[i + 2] = 255;
          guideImageData.data[i + 3] = 255;
        }
      }

      guideContext.putImageData(guideImageData, 0, 0);
      return canvasToImageAsset(guideCanvas);
    }
    default:
      return buildDualColorAiMaskAsset(casterMask, surfaceMask);
  }
}

export function buildDualColorGuideMaskAsset(
  guideMode: AiGuideMode,
  casterMask: HTMLCanvasElement | null,
  surfaceMask: HTMLCanvasElement | null,
): AiMaskAsset | null {
  const guideImage = buildGuideImageAssetForMode(guideMode, casterMask, surfaceMask);
  if (!guideImage) return null;
  return {
    kind: "mask",
    mimeType: guideImage.mimeType,
    data: guideImage.data,
    width: guideImage.width,
    height: guideImage.height,
  };
}

export function createGuideMaskIntersection(maskA: HTMLCanvasElement, maskB: HTMLCanvasElement): HTMLCanvasElement | null {
  if (maskA.width !== maskB.width || maskA.height !== maskB.height) {
    return null;
  }

  const sourceA = maskA.getContext("2d");
  const sourceB = maskB.getContext("2d");
  const output = createMaskCanvas(maskA.width, maskA.height);
  const target = output.getContext("2d");

  if (!sourceA || !sourceB || !target) {
    return null;
  }

  const aData = sourceA.getImageData(0, 0, maskA.width, maskA.height).data;
  const bData = sourceB.getImageData(0, 0, maskB.width, maskB.height).data;
  const outData = target.createImageData(maskA.width, maskA.height);

  for (let i = 0; i < outData.data.length; i += 4) {
    const selected = aData[i + 3] > 0 && bData[i + 3] > 0;
    if (!selected) {
      continue;
    }
    outData.data[i] = 255;
    outData.data[i + 1] = 255;
    outData.data[i + 2] = 255;
    outData.data[i + 3] = 255;
  }

  target.putImageData(outData, 0, 0);
  return output;
}

export function createGuideMaskUnion(...masks: Array<HTMLCanvasElement | null | undefined>): HTMLCanvasElement | null {
  const validMasks = masks.filter((mask): mask is HTMLCanvasElement => !!mask);
  if (validMasks.length === 0) {
    return null;
  }

  const [{ width, height }] = validMasks;
  if (validMasks.some((mask) => mask.width !== width || mask.height !== height)) {
    return null;
  }

  const contexts = validMasks.map((mask) => mask.getContext("2d"));
  if (contexts.some((context) => !context)) {
    return null;
  }

  const output = createMaskCanvas(width, height);
  const target = output.getContext("2d");
  if (!target) {
    return null;
  }

  const sourceData = contexts.map((context) => context!.getImageData(0, 0, width, height).data);
  const outputData = target.createImageData(width, height);

  for (let i = 0; i < outputData.data.length; i += 4) {
    const selected = sourceData.some((data) => data[i + 3] > 0);
    if (!selected) {
      continue;
    }
    outputData.data[i] = 255;
    outputData.data[i + 1] = 255;
    outputData.data[i + 2] = 255;
    outputData.data[i + 3] = 255;
  }

  target.putImageData(outputData, 0, 0);
  return output;
}

export function splitMaskIntoConnectedComponents(maskCanvas: HTMLCanvasElement | null): GuideConnectedComponent[] {
  if (!maskCanvas || isMaskEmpty(maskCanvas)) {
    return [];
  }

  const context = maskCanvas.getContext("2d");
  if (!context) {
    return [];
  }

  const { width, height } = maskCanvas;
  const source = context.getImageData(0, 0, width, height).data;
  const visited = new Uint8Array(width * height);
  const components: GuideConnectedComponent[] = [];
  const queue = new Int32Array(width * height);

  const toIndex = (x: number, y: number) => y * width + x;
  const isFilled = (index: number) => source[(index * 4) + 3] > 0;

  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const startIndex = toIndex(startX, startY);
      if (visited[startIndex] || !isFilled(startIndex)) {
        continue;
      }

      let queueStart = 0;
      let queueEnd = 0;
      queue[queueEnd++] = startIndex;
      visited[startIndex] = 1;

      const pixels: number[] = [];
      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;

      while (queueStart < queueEnd) {
        const currentIndex = queue[queueStart++];
        const x = currentIndex % width;
        const y = Math.floor(currentIndex / width);
        pixels.push(currentIndex);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbors = [
          x > 0 ? currentIndex - 1 : -1,
          x + 1 < width ? currentIndex + 1 : -1,
          y > 0 ? currentIndex - width : -1,
          y + 1 < height ? currentIndex + width : -1,
        ];

        for (const neighborIndex of neighbors) {
          if (neighborIndex < 0 || visited[neighborIndex] || !isFilled(neighborIndex)) {
            continue;
          }
          visited[neighborIndex] = 1;
          queue[queueEnd++] = neighborIndex;
        }
      }

      const componentCanvas = createMaskCanvas(width, height);
      const componentContext = componentCanvas.getContext("2d");
      if (!componentContext) {
        continue;
      }
      const componentData = componentContext.createImageData(width, height);
      for (const pixelIndex of pixels) {
        const offset = pixelIndex * 4;
        componentData.data[offset] = 255;
        componentData.data[offset + 1] = 255;
        componentData.data[offset + 2] = 255;
        componentData.data[offset + 3] = 255;
      }
      componentContext.putImageData(componentData, 0, 0);

      components.push({
        canvas: componentCanvas,
        bounds: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        pixelCount: pixels.length,
      });
    }
  }

  return components.sort((a, b) => {
    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }
    if (a.bounds.y !== b.bounds.y) {
      return a.bounds.y - b.bounds.y;
    }
    return a.bounds.x - b.bounds.x;
  });
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
    const value = sourceMaskData.data[i + 3] > 0 ? 0 : 255;
    normalizedMaskData.data[i] = value;
    normalizedMaskData.data[i + 1] = value;
    normalizedMaskData.data[i + 2] = value;
    normalizedMaskData.data[i + 3] = 255;
  }

  targetContext.putImageData(normalizedMaskData, 0, 0);
  return normalizedMask;
}

/**
 * Convert an AI-generated mask (white=selected, black=not-selected, all pixels alpha=255)
 * to the internal alpha-channel mask format (selected=alpha 255, not-selected=alpha 0).
 *
 * Note: `buildBinaryAiMaskCanvas` produces black=selected (outgoing masks sent to AI)
 * while this function converts white=selected (incoming masks returned by AI) to alpha.
 * They serve opposite directions in the pipeline, not a direct inverse.
 */
export function convertAiMaskToAlphaMask(aiMask: HTMLCanvasElement): HTMLCanvasElement {
  const output = createMaskCanvas(aiMask.width, aiMask.height);
  const sourceContext = aiMask.getContext("2d");
  const targetContext = output.getContext("2d");

  if (!sourceContext || !targetContext) {
    return aiMask;
  }

  const sourceData = sourceContext.getImageData(0, 0, aiMask.width, aiMask.height);
  const outputData = targetContext.createImageData(aiMask.width, aiMask.height);

  for (let i = 0; i < sourceData.data.length; i += 4) {
    const selected = sourceData.data[i] > 127;
    outputData.data[i] = selected ? 255 : 0;
    outputData.data[i + 1] = selected ? 255 : 0;
    outputData.data[i + 2] = selected ? 255 : 0;
    outputData.data[i + 3] = selected ? 255 : 0;
  }

  targetContext.putImageData(outputData, 0, 0);
  return output;
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

export function buildInpaintingTask(
  image: AiImageAsset,
  mask: AiMaskAsset,
  prompt: string,
  mode: NonNullable<AiInpaintingTask["options"]>["mode"],
  options: {
    guideMode?: AiGuideMode;
  } = {},
): AiInpaintingTask {
  return {
    id: `ai-inpaint-${crypto.randomUUID()}`,
    family: "inpainting",
    prompt,
    input: { image, mask },
    options: { mode, guideMode: options.guideMode },
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

export function buildTextReplacementTask(
  image: AiImageAsset,
  mask: AiMaskAsset,
  prompt: string,
  options: { schemaVersion?: string } = {},
): AiTextReplacementTask {
  return {
    id: `ai-text-replacement-${crypto.randomUUID()}`,
    family: "text-replacement",
    prompt,
    input: { image, mask },
    options: { schemaVersion: options.schemaVersion },
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
    if (artifact.kind === "mask") {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    } else {
      const widthScale = canvas.width / image.naturalWidth;
      const heightScale = canvas.height / image.naturalHeight;
      const scale = Math.max(widthScale, heightScale);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const offsetX = (canvas.width - drawWidth) / 2;
      const offsetY = (canvas.height - drawHeight) / 2;
      ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
    }
  }

  if (artifact.kind === "mask") {
    return convertAiMaskToAlphaMask(canvas);
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

export function getJsonArtifact(result: AiTaskSuccess, role?: AiJsonArtifact["role"]): AiJsonArtifact | null {
  return result.artifacts.find((artifact): artifact is AiJsonArtifact => artifact.kind === "json" && (role ? artifact.role === role : true)) ?? null;
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
  const boundingRect = maskBoundingRect(mask);
  doc.selectionRect = boundingRect;
  console.log(`[AI] applyMaskToSelection: boundingRect=${boundingRect ? `{x:${boundingRect.x}, y:${boundingRect.y}, w:${boundingRect.width}, h:${boundingRect.height}}` : "null"}`);
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
