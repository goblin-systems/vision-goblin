export type CaptureOverlayMode = "region" | "picker";

export interface CaptureSelection {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureDrawMetrics {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  scale: number;
}

export interface CaptureHudPosition {
  left: number;
  top: number;
}

export interface CaptureLensBand {
  start: number;
  size: number;
}

export interface CaptureDesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureOverlayInitPayload {
  mode: CaptureOverlayMode;
  desktopBounds: CaptureDesktopBounds;
  imageDataUrl: string;
}

export interface CaptureOverlayRegionResult {
  kind: "region";
  imageDataUrl: string;
}

export interface CaptureOverlayPickerResult {
  kind: "picker";
  colour: string;
}

export interface CaptureOverlayCancelResult {
  kind: "cancel";
}

export type CaptureOverlayResult = CaptureOverlayRegionResult | CaptureOverlayPickerResult | CaptureOverlayCancelResult;

export function getCaptureSelectionFromDrag(startX: number, startY: number, currentX: number, currentY: number): CaptureSelection {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

export function computeCaptureDrawMetrics(rect: CaptureCanvasRect, dpr: number, bitmap: Pick<ImageBitmap, "width" | "height"> | null): CaptureDrawMetrics {
  if (!bitmap) {
    return {
      drawX: 0,
      drawY: 0,
      drawWidth: rect.width,
      drawHeight: rect.height,
      scale: 1,
    };
  }
  const drawWidth = bitmap.width / dpr;
  const drawHeight = bitmap.height / dpr;
  return {
    drawX: (rect.width - drawWidth) / 2,
    drawY: (rect.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
    scale: drawWidth / bitmap.width,
  };
}

export function mapClientPointToBitmapPoint(
  clientX: number,
  clientY: number,
  rect: CaptureCanvasRect,
  metrics: CaptureDrawMetrics,
): { x: number; y: number } {
  const localX = Math.max(metrics.drawX, Math.min(clientX - rect.left, metrics.drawX + metrics.drawWidth));
  const localY = Math.max(metrics.drawY, Math.min(clientY - rect.top, metrics.drawY + metrics.drawHeight));
  return {
    x: metrics.scale > 0 ? (localX - metrics.drawX) / metrics.scale : 0,
    y: metrics.scale > 0 ? (localY - metrics.drawY) / metrics.scale : 0,
  };
}

export function formatCaptureError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

export function describeCaptureFailure(error: unknown, fallback: string): string {
  const message = formatCaptureError(error, fallback);
  const normalised = message.toLowerCase();
  if (
    normalised.includes("permission")
    || normalised.includes("denied")
    || normalised.includes("not authorized")
    || normalised.includes("not permitted")
    || normalised.includes("access is denied")
  ) {
    return "Screen capture permission was denied. Allow desktop capture for Vision Goblin, then try again.";
  }
  if (normalised.includes("no monitors available") || normalised.includes("no displays available")) {
    return "No displays were available to capture.";
  }
  if (normalised.includes("window not found")) {
    return "That window is no longer available to capture.";
  }
  return message;
}

export function computeCaptureHudPosition(
  pointerClientX: number,
  pointerClientY: number,
  hudWidth: number,
  hudHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  gap = 24,
  margin = 16,
): CaptureHudPosition {
  const prefersLeft = pointerClientX + gap + hudWidth > viewportWidth - margin;
  const prefersAbove = pointerClientY + gap + hudHeight > viewportHeight - margin;
  const unclampedLeft = prefersLeft ? pointerClientX - hudWidth - gap : pointerClientX + gap;
  const unclampedTop = prefersAbove ? pointerClientY - hudHeight - gap : pointerClientY + gap;
  const maxLeft = Math.max(margin, viewportWidth - hudWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - hudHeight - margin);
  return {
    left: Math.max(margin, Math.min(unclampedLeft, maxLeft)),
    top: Math.max(margin, Math.min(unclampedTop, maxTop)),
  };
}

export function computeLensBands(length: number, segments: number, emphasis = 0.45): CaptureLensBand[] {
  if (segments <= 0) return [];
  if (segments === 1) {
    return [{ start: 0, size: length }];
  }
  const midpoint = (segments - 1) / 2;
  const weights = Array.from({ length: segments }, (_, index) => {
    const distance = Math.abs(index - midpoint) / midpoint;
    return 1 + emphasis * (1 - distance ** 2);
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const rawSizes = weights.map((weight) => (weight / weightTotal) * length);
  const sizes = rawSizes.map((size) => Math.floor(size));
  let remainder = length - sizes.reduce((sum, size) => sum + size, 0);
  const order = rawSizes
    .map((size, index) => ({ index, fraction: size - Math.floor(size) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    sizes[order[index].index] += 1;
    remainder -= 1;
  }
  let start = 0;
  return sizes.map((size) => {
    const band = { start, size };
    start += size;
    return band;
  });
}
