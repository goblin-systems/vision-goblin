import type { DocumentState, Layer } from "./types";

const LARGE_PIXEL_THRESHOLD = 20_000_000;
const HUGE_PIXEL_THRESHOLD = 48_000_000;
const LARGE_MEMORY_THRESHOLD = 192 * 1024 * 1024;
const HUGE_MEMORY_THRESHOLD = 512 * 1024 * 1024;

type HistoryBudget = {
  byteBudget: number;
  entryLimit: number;
};

export type LargeImageTier = "normal" | "large" | "huge";

export interface LargeImagePolicy {
  tier: LargeImageTier;
  pixelCount: number;
  estimatedBytes: number;
  visibleAdjustmentLayers: number;
  history: HistoryBudget;
}

export interface RenderDegradationPolicy {
  active: boolean;
  skipAdjustmentLayers: boolean;
  skipSelectionOverlays: boolean;
  skipQuickMaskOverlay: boolean;
  skipPixelGrid: boolean;
  reasons: string[];
}

export function estimateCanvasBytes(canvas: Pick<HTMLCanvasElement, "width" | "height"> | null | undefined): number {
  if (!canvas) return 0;
  return Math.max(0, canvas.width) * Math.max(0, canvas.height) * 4;
}

export function estimateSnapshotBytes(snapshot: string): number {
  return snapshot.length * 2;
}

function collectCanvasBytes(doc: DocumentState): number {
  const seen = new Set<HTMLCanvasElement>();
  const track = (canvas: HTMLCanvasElement | null | undefined) => {
    if (!canvas || seen.has(canvas)) return 0;
    seen.add(canvas);
    return estimateCanvasBytes(canvas);
  };

  let total = 0;
  for (const layer of doc.layers) {
    total += track(layer.canvas);
    total += track(layer.sourceCanvas);
    total += track(layer.mask);
    if (layer.type === "smart-object") {
      total += track(layer.smartObjectData.sourceCanvas);
    }
  }
  total += track(doc.selectionMask);
  return total;
}

export function countVisibleAdjustmentLayers(doc: DocumentState): number {
  return doc.layers.filter((layer) => layer.type === "adjustment" && layer.visible).length;
}

export function estimateDocumentBytes(doc: DocumentState): number {
  const visibleAdjustmentLayers = countVisibleAdjustmentLayers(doc);
  const baseBytes = collectCanvasBytes(doc);
  const adjustmentScratchBytes = visibleAdjustmentLayers > 0 ? doc.width * doc.height * 4 : 0;
  return baseBytes + adjustmentScratchBytes;
}

function getHistoryBudget(tier: LargeImageTier): HistoryBudget {
  if (tier === "huge") {
    return { byteBudget: 24 * 1024 * 1024, entryLimit: 4 };
  }
  if (tier === "large") {
    return { byteBudget: 64 * 1024 * 1024, entryLimit: 12 };
  }
  return { byteBudget: 160 * 1024 * 1024, entryLimit: 40 };
}

export function getLargeImagePolicy(doc: DocumentState): LargeImagePolicy {
  const pixelCount = doc.width * doc.height;
  const estimatedBytes = estimateDocumentBytes(doc);
  const visibleAdjustmentLayers = countVisibleAdjustmentLayers(doc);
  const tier: LargeImageTier = pixelCount >= HUGE_PIXEL_THRESHOLD || estimatedBytes >= HUGE_MEMORY_THRESHOLD
    ? "huge"
    : pixelCount >= LARGE_PIXEL_THRESHOLD || estimatedBytes >= LARGE_MEMORY_THRESHOLD
      ? "large"
      : "normal";

  return {
    tier,
    pixelCount,
    estimatedBytes,
    visibleAdjustmentLayers,
    history: getHistoryBudget(tier),
  };
}

export function getRenderDegradationPolicy(doc: DocumentState, interactive: boolean): RenderDegradationPolicy {
  const policy = getLargeImagePolicy(doc);
  if (!interactive || policy.tier === "normal") {
    return {
      active: false,
      skipAdjustmentLayers: false,
      skipSelectionOverlays: false,
      skipQuickMaskOverlay: false,
      skipPixelGrid: false,
      reasons: [],
    };
  }

  const skipAdjustmentLayers = policy.visibleAdjustmentLayers > 0;
  const skipSelectionOverlays = !!doc.selectionMask || policy.tier === "huge";
  const reasons: string[] = [];
  if (skipAdjustmentLayers) reasons.push("adjustment previews skipped");
  if (skipSelectionOverlays) reasons.push("selection overlays simplified");
  reasons.push("quick mask overlay skipped", "pixel grid skipped");

  return {
    active: true,
    skipAdjustmentLayers,
    skipSelectionOverlays,
    skipQuickMaskOverlay: true,
    skipPixelGrid: true,
    reasons,
  };
}

export function formatLargeImageMetrics(policy: Pick<LargeImagePolicy, "pixelCount" | "estimatedBytes">): string {
  const megapixels = (policy.pixelCount / 1_000_000).toFixed(1);
  const mebibytes = Math.round(policy.estimatedBytes / (1024 * 1024));
  return `${megapixels} MP / ~${mebibytes} MiB`;
}

export function describeLayerMemory(layer: Layer): number {
  let total = estimateCanvasBytes(layer.canvas) + estimateCanvasBytes(layer.sourceCanvas) + estimateCanvasBytes(layer.mask);
  if (layer.type === "smart-object") {
    total += estimateCanvasBytes(layer.smartObjectData.sourceCanvas);
  }
  return total;
}
