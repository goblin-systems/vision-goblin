import { cloneCanvas, createLayerCanvas, type LayerLocalBounds } from "../../editor/documents";
import { createMaskCanvas, maskBoundingRect } from "../../editor/selection";
import type { DocumentState, RasterLayer } from "../../editor/types";
import type { AiImageAsset, AiInputScope, AiMaskAsset } from "./types";
import {
  buildMaskAssetFromCanvas,
  buildRasterLayerContentImageAsset,
  buildScopedCompositeImageAsset,
  type ScopedImageAssetResult,
} from "./editingSupport";

export type EmptyMaskPolicy = "error" | "fill-full-target";

export interface RasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreparedMaskedRasterTarget {
  scopedAsset: ScopedImageAssetResult | { asset: AiImageAsset; debugLabel: "layer-content" };
  maskCanvas: HTMLCanvasElement;
  maskAsset: AiMaskAsset;
  selectionBounds: RasterRect;
  usedFullTargetFallback: boolean;
  isLayerScope: boolean;
  contentBoundsLocal: LayerLocalBounds | null;
  outputExpectedWidth: number;
  outputExpectedHeight: number;
  blockOffset: { x: number; y: number };
  toLayerCanvas: (resultCanvas: HTMLCanvasElement) => HTMLCanvasElement;
  applyMaskedResultToLayerCanvas: (resultCanvas: HTMLCanvasElement) => HTMLCanvasElement;
}

type PrepareMaskedRasterTargetResult =
  | { ok: true; target: PreparedMaskedRasterTarget }
  | { ok: false; error: string };

export interface PrepareMaskedRasterTargetArgs {
  doc: DocumentState;
  layer: RasterLayer;
  inputScope: AiInputScope;
  surfaceMask: HTMLCanvasElement;
  emptyMaskPolicy: EmptyMaskPolicy;
  emptyMaskMessage: string;
}

export function prepareMaskedRasterTarget(args: PrepareMaskedRasterTargetArgs): PrepareMaskedRasterTargetResult {
  return args.inputScope === "selected-layers"
    ? prepareLayerScopedMaskedRasterTarget(args)
    : prepareDocumentScopedMaskedRasterTarget(args);
}

function prepareLayerScopedMaskedRasterTarget(args: PrepareMaskedRasterTargetArgs): PrepareMaskedRasterTargetResult {
  const { layer, surfaceMask, emptyMaskPolicy, emptyMaskMessage } = args;
  const contentAsset = buildRasterLayerContentImageAsset(layer);
  const contentBoundsLocal = contentAsset.boundsLocal;
  const contentOffsetX = contentBoundsLocal?.x ?? 0;
  const contentOffsetY = contentBoundsLocal?.y ?? 0;
  const outputExpectedWidth = contentAsset.asset.width ?? layer.canvas.width;
  const outputExpectedHeight = contentAsset.asset.height ?? layer.canvas.height;
  const translatedMask = createMaskCanvas(outputExpectedWidth, outputExpectedHeight);
  const sourceMaskCtx = surfaceMask.getContext("2d");
  const translatedMaskCtx = translatedMask.getContext("2d");
  if (sourceMaskCtx && translatedMaskCtx) {
    const sourceRectX = layer.x + contentOffsetX;
    const sourceRectY = layer.y + contentOffsetY;
    const imageData = sourceMaskCtx.getImageData(sourceRectX, sourceRectY, outputExpectedWidth, outputExpectedHeight);
    translatedMaskCtx.putImageData(imageData, 0, 0);
  }

  let selectionBounds = maskBoundingRect(translatedMask);
  let usedFullTargetFallback = false;
  if (!selectionBounds) {
    if (emptyMaskPolicy === "error") {
      return { ok: false, error: emptyMaskMessage };
    }
    fillMaskRect(translatedMask, { x: 0, y: 0, width: outputExpectedWidth, height: outputExpectedHeight });
    selectionBounds = { x: 0, y: 0, width: outputExpectedWidth, height: outputExpectedHeight };
    usedFullTargetFallback = true;
  }

  const maskAsset = buildMaskAssetFromCanvas(translatedMask);
  if (!maskAsset) {
    return { ok: false, error: emptyMaskMessage };
  }

  return {
    ok: true,
    target: {
      scopedAsset: {
        asset: contentAsset.asset,
        debugLabel: "layer-content",
      },
      maskCanvas: translatedMask,
      maskAsset,
      selectionBounds,
      usedFullTargetFallback,
      isLayerScope: true,
      contentBoundsLocal,
      outputExpectedWidth,
      outputExpectedHeight,
      blockOffset: {
        x: layer.x + contentOffsetX,
        y: layer.y + contentOffsetY,
      },
      toLayerCanvas: (resultCanvas) => {
        const nextLayerCanvas = cloneCanvas(layer.canvas);
        const nextCtx = nextLayerCanvas.getContext("2d");
        if (nextCtx) {
          nextCtx.clearRect(contentOffsetX, contentOffsetY, outputExpectedWidth, outputExpectedHeight);
          nextCtx.drawImage(resultCanvas, contentOffsetX, contentOffsetY);
        }
        return nextLayerCanvas;
      },
      applyMaskedResultToLayerCanvas: (resultCanvas) => {
        if (usedFullTargetFallback) {
          return applyFullLayerScopedResult(layer.canvas, resultCanvas, contentOffsetX, contentOffsetY, outputExpectedWidth, outputExpectedHeight);
        }
        return applyMaskedLayerScopedResult(layer.canvas, resultCanvas, translatedMask, contentOffsetX, contentOffsetY);
      },
    },
  };
}

function prepareDocumentScopedMaskedRasterTarget(args: PrepareMaskedRasterTargetArgs): PrepareMaskedRasterTargetResult {
  const { doc, layer, inputScope, surfaceMask, emptyMaskPolicy, emptyMaskMessage } = args;
  const effectiveMask = createMaskCanvas(surfaceMask.width, surfaceMask.height);
  effectiveMask.getContext("2d")?.drawImage(surfaceMask, 0, 0);

  let selectionBounds = maskBoundingRect(effectiveMask);
  let usedFullTargetFallback = false;
  if (!selectionBounds) {
    if (emptyMaskPolicy === "error") {
      return { ok: false, error: emptyMaskMessage };
    }
    selectionBounds = {
      x: layer.x,
      y: layer.y,
      width: layer.canvas.width,
      height: layer.canvas.height,
    };
    fillMaskRect(effectiveMask, selectionBounds);
    usedFullTargetFallback = true;
  }

  if (!rectsOverlap(selectionBounds, { x: layer.x, y: layer.y, width: layer.canvas.width, height: layer.canvas.height })) {
    return { ok: false, error: "Selection must overlap the active raster layer." };
  }

  const maskAsset = buildMaskAssetFromCanvas(effectiveMask);
  if (!maskAsset) {
    return { ok: false, error: emptyMaskMessage };
  }

  return {
    ok: true,
    target: {
      scopedAsset: buildScopedCompositeImageAsset(doc, inputScope),
      maskCanvas: effectiveMask,
      maskAsset,
      selectionBounds,
      usedFullTargetFallback,
      isLayerScope: false,
      contentBoundsLocal: null,
      outputExpectedWidth: doc.width,
      outputExpectedHeight: doc.height,
      blockOffset: {
        x: selectionBounds.x,
        y: selectionBounds.y,
      },
      toLayerCanvas: (resultCanvas) => extractCanvasRegion(resultCanvas, {
        x: layer.x,
        y: layer.y,
        width: layer.canvas.width,
        height: layer.canvas.height,
      }),
      applyMaskedResultToLayerCanvas: (resultCanvas) => {
        if (usedFullTargetFallback) {
          return extractCanvasRegion(resultCanvas, {
            x: layer.x,
            y: layer.y,
            width: layer.canvas.width,
            height: layer.canvas.height,
          });
        }
        const layerResult = extractCanvasRegion(resultCanvas, {
          x: layer.x,
          y: layer.y,
          width: layer.canvas.width,
          height: layer.canvas.height,
        });
        const layerMask = extractCanvasRegion(effectiveMask, {
          x: layer.x,
          y: layer.y,
          width: layer.canvas.width,
          height: layer.canvas.height,
        });
        return applyMaskedCanvasResult(layer.canvas, layerResult, layerMask);
      },
    },
  };
}

function applyFullLayerScopedResult(
  sourceLayerCanvas: HTMLCanvasElement,
  resultCanvas: HTMLCanvasElement,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const nextLayerCanvas = cloneCanvas(sourceLayerCanvas);
  const nextCtx = nextLayerCanvas.getContext("2d");
  if (nextCtx) {
    nextCtx.clearRect(targetX, targetY, targetWidth, targetHeight);
    nextCtx.drawImage(resultCanvas, targetX, targetY);
  }
  return nextLayerCanvas;
}

function applyMaskedLayerScopedResult(
  sourceLayerCanvas: HTMLCanvasElement,
  resultCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  targetX: number,
  targetY: number,
): HTMLCanvasElement {
  const nextLayerCanvas = cloneCanvas(sourceLayerCanvas);
  const nextCtx = nextLayerCanvas.getContext("2d");
  const resultCtx = resultCanvas.getContext("2d");
  const maskCtx = maskCanvas.getContext("2d");
  if (!nextCtx || !resultCtx || !maskCtx) {
    return nextLayerCanvas;
  }

  const resultData = resultCtx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const targetData = nextCtx.getImageData(targetX, targetY, resultCanvas.width, resultCanvas.height);

  for (let i = 0; i < resultData.data.length; i += 4) {
    if (maskData.data[i + 3] === 0) {
      continue;
    }
    targetData.data[i] = resultData.data[i];
    targetData.data[i + 1] = resultData.data[i + 1];
    targetData.data[i + 2] = resultData.data[i + 2];
    targetData.data[i + 3] = resultData.data[i + 3];
  }

  nextCtx.putImageData(targetData, targetX, targetY);
  return nextLayerCanvas;
}

function applyMaskedCanvasResult(
  sourceCanvas: HTMLCanvasElement,
  resultCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const outputCanvas = cloneCanvas(sourceCanvas);
  const outputCtx = outputCanvas.getContext("2d");
  const resultCtx = resultCanvas.getContext("2d");
  const maskCtx = maskCanvas.getContext("2d");
  if (!outputCtx || !resultCtx || !maskCtx) {
    return outputCanvas;
  }

  const outputData = outputCtx.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
  const resultData = resultCtx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

  for (let i = 0; i < outputData.data.length; i += 4) {
    if (maskData.data[i + 3] === 0) {
      continue;
    }
    outputData.data[i] = resultData.data[i];
    outputData.data[i + 1] = resultData.data[i + 1];
    outputData.data[i + 2] = resultData.data[i + 2];
    outputData.data[i + 3] = resultData.data[i + 3];
  }

  outputCtx.putImageData(outputData, 0, 0);
  return outputCanvas;
}

function fillMaskRect(maskCanvas: HTMLCanvasElement, rect: RasterRect) {
  const ctx = maskCanvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function rectsOverlap(a: RasterRect, b: RasterRect): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function extractCanvasRegion(source: HTMLCanvasElement, region: RasterRect): HTMLCanvasElement {
  const extracted = createLayerCanvas(region.width, region.height);
  const sourceCtx = source.getContext("2d");
  const targetCtx = extracted.getContext("2d");
  if (sourceCtx && targetCtx) {
    const imageData = sourceCtx.getImageData(region.x, region.y, region.width, region.height);
    targetCtx.putImageData(imageData, 0, 0);
  }
  return extracted;
}
