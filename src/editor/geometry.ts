import type { CanvasBounds, DocumentState, ResizeAnchor } from "./types";
import { clamp } from "./utils";

export function getCanvasBounds(doc: DocumentState, canvasRect: Pick<DOMRect, "width" | "height">): CanvasBounds {
  const scale = doc.zoom / 100;
  const width = doc.width * scale;
  const height = doc.height * scale;
  return {
    originX: canvasRect.width / 2 - width / 2 + doc.panX,
    originY: canvasRect.height / 2 - height / 2 + doc.panY,
    width,
    height,
    scale,
  };
}

export function getResizeOffset(anchor: ResizeAnchor, oldWidth: number, oldHeight: number, nextWidth: number, nextHeight: number) {
  const horizontal = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? nextWidth - oldWidth : Math.round((nextWidth - oldWidth) / 2);
  const vertical = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? nextHeight - oldHeight : Math.round((nextHeight - oldHeight) / 2);
  return { x: horizontal, y: vertical };
}

export function buildCropRect(x1: number, y1: number, x2: number, y2: number, doc: Pick<DocumentState, "width" | "height">) {
  const left = clamp(Math.min(x1, x2), 0, doc.width);
  const top = clamp(Math.min(y1, y2), 0, doc.height);
  const right = clamp(Math.max(x1, x2), 0, doc.width);
  const bottom = clamp(Math.max(y1, y2), 0, doc.height);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
}

export function getDocCoordinates(
  clientX: number,
  clientY: number,
  doc: DocumentState,
  canvasRect: Pick<DOMRect, "left" | "top" | "width" | "height">
) {
  const bounds = getCanvasBounds(doc, canvasRect);
  const x = (clientX - canvasRect.left - bounds.originX) / bounds.scale;
  const y = (clientY - canvasRect.top - bounds.originY) / bounds.scale;
  return { x, y, bounds };
}
