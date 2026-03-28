import type { AppTab, VisionSettings } from "../settings";
import { getCanvasBounds } from "./geometry";
import { traceMaskContours, traceMarqueeShape } from "./selection";
import type { ActiveTool, DocumentState, EffectType, Layer, LayerEffect, Rect } from "./types";
import { compositeDocumentOnto, createLayerThumb } from "./documents";
import { EFFECT_META, getEffectMeta } from "./layerStyles";

export function renderCanvas(params: {
  editorCanvas: HTMLCanvasElement;
  getEditorContext: () => CanvasRenderingContext2D;
  doc: DocumentState | null;
  activeTool?: ActiveTool;
  activeLayer?: Layer | null;
  marqueePreview?: { baseRect: Rect | null; previewRect: Rect | null; mode: "replace" | "add" | "subtract" | "intersect"; sides: number; rotation: number; perfect: boolean } | null;
  transformPreview?: { layerId: string; canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number } | null;
  pivotPoint?: { x: number; y: number } | null;
  guides?: Array<{ orientation: "horizontal" | "vertical"; position: number }>;
  snapLines?: Array<{ orientation: "horizontal" | "vertical"; position: number }>;
  showRulers?: boolean;
  showGrid?: boolean;
  gridSize?: number;
  /** When set, draws a semi-transparent overlay for the quick mask. */
  quickMaskOverlay?: { canvas: HTMLCanvasElement; color: string } | null;
}) {
  const { editorCanvas, getEditorContext, doc, activeTool, activeLayer, marqueePreview, transformPreview } = params;
  const ctx = getEditorContext();
  const rect = editorCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (editorCanvas.width !== width || editorCanvas.height !== height) {
    editorCanvas.width = width;
    editorCanvas.height = height;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.scale(dpr, dpr);

  if (!doc) return;

  const bounds = getCanvasBounds(doc, rect);
  const isHighZoom = bounds.scale >= 4;
  ctx.imageSmoothingEnabled = !isHighZoom;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(bounds.originX - 1, bounds.originY - 1, bounds.width + 2, bounds.height + 2);
  compositeDocumentOnto(ctx, doc, bounds.originX, bounds.originY, bounds.scale, transformPreview?.layerId ?? null);
  if (transformPreview) {
    ctx.save();
    ctx.translate(bounds.originX, bounds.originY);
    ctx.scale(bounds.scale, bounds.scale);
    ctx.drawImage(transformPreview.canvas, transformPreview.x, transformPreview.y);
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.strokeRect(bounds.originX + 0.5, bounds.originY + 0.5, bounds.width, bounds.height);
  ctx.restore();

  // Quick mask overlay: semi-transparent color on non-selected (black/transparent) areas
  if (params.quickMaskOverlay) {
    const qm = params.quickMaskOverlay;
    ctx.save();
    // Build an overlay canvas: fill with color, then cut out where mask is white (selected)
    const ow = doc.width;
    const oh = doc.height;
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = ow;
    overlayCanvas.height = oh;
    const oCtx = overlayCanvas.getContext("2d")!;
    oCtx.fillStyle = qm.color;
    oCtx.fillRect(0, 0, ow, oh);
    // Remove the selected (white) areas from the overlay using the mask
    oCtx.globalCompositeOperation = "destination-out";
    oCtx.drawImage(qm.canvas, 0, 0);
    // Draw scaled overlay on the editor canvas
    ctx.drawImage(overlayCanvas, 0, 0, ow, oh, bounds.originX, bounds.originY, bounds.width, bounds.height);
    ctx.restore();
  }

  if (params.showGrid && params.gridSize && params.gridSize > 0) {
    const gs = params.gridSize;
    const screenStep = gs * bounds.scale;
    if (screenStep >= 4) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let docX = gs; docX < doc.width; docX += gs) {
        const sx = bounds.originX + docX * bounds.scale;
        ctx.moveTo(Math.round(sx) + 0.5, bounds.originY);
        ctx.lineTo(Math.round(sx) + 0.5, bounds.originY + bounds.height);
      }
      for (let docY = gs; docY < doc.height; docY += gs) {
        const sy = bounds.originY + docY * bounds.scale;
        ctx.moveTo(bounds.originX, Math.round(sy) + 0.5);
        ctx.lineTo(bounds.originX + bounds.width, Math.round(sy) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Pixel grid overlay at high zoom (when each pixel >= 8 screen pixels)
  if (isHighZoom && bounds.scale >= 8) {
    const viewW = rect.width;
    const viewH = rect.height;
    const startDocX = Math.max(1, Math.floor(-bounds.originX / bounds.scale));
    const endDocX = Math.min(doc.width, Math.ceil((viewW - bounds.originX) / bounds.scale));
    const startDocY = Math.max(1, Math.floor(-bounds.originY / bounds.scale));
    const endDocY = Math.min(doc.height, Math.ceil((viewH - bounds.originY) / bounds.scale));
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const top = Math.max(bounds.originY, 0);
    const bottom = Math.min(bounds.originY + bounds.height, viewH);
    const left = Math.max(bounds.originX, 0);
    const right = Math.min(bounds.originX + bounds.width, viewW);
    for (let docX = startDocX; docX < endDocX; docX++) {
      const sx = Math.round(bounds.originX + docX * bounds.scale) + 0.5;
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, bottom);
    }
    for (let docY = startDocY; docY < endDocY; docY++) {
      const sy = Math.round(bounds.originY + docY * bounds.scale) + 0.5;
      ctx.moveTo(left, sy);
      ctx.lineTo(right, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (doc.cropRect) {
    const cropX = bounds.originX + doc.cropRect.x * bounds.scale;
    const cropY = bounds.originY + doc.cropRect.y * bounds.scale;
    const cropW = doc.cropRect.width * bounds.scale;
    const cropH = doc.cropRect.height * bounds.scale;

    ctx.save();
    ctx.fillStyle = "rgba(7, 11, 21, 0.46)";
    ctx.fillRect(bounds.originX, bounds.originY, bounds.width, cropY - bounds.originY);
    ctx.fillRect(bounds.originX, cropY, cropX - bounds.originX, cropH);
    ctx.fillRect(cropX + cropW, cropY, bounds.originX + bounds.width - (cropX + cropW), cropH);
    ctx.fillRect(bounds.originX, cropY + cropH, bounds.width, bounds.originY + bounds.height - (cropY + cropH));
    ctx.strokeStyle = "#ffffff";
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(cropX, cropY, cropW, cropH);
    ctx.restore();
  }

  // Mask-based marching ants (compound selections, magic wand, lasso)
  if (doc.selectionMask) {
    const contours = traceMaskContours(doc.selectionMask);

    if (contours.length > 0) {
      // Tinted overlay outside selection
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      if (doc.selectionInverted) {
        // Inversion: fill only the selected area
        for (const contour of contours) {
          ctx.moveTo(bounds.originX + contour[0].x * bounds.scale, bounds.originY + contour[0].y * bounds.scale);
          for (let i = 1; i < contour.length; i++) {
            ctx.lineTo(bounds.originX + contour[i].x * bounds.scale, bounds.originY + contour[i].y * bounds.scale);
          }
          ctx.closePath();
        }
        ctx.fill();
      } else {
        // Normal: fill outside the selection
        ctx.rect(bounds.originX, bounds.originY, bounds.width, bounds.height);
        for (const contour of contours) {
          ctx.moveTo(bounds.originX + contour[0].x * bounds.scale, bounds.originY + contour[0].y * bounds.scale);
          for (let i = 1; i < contour.length; i++) {
            ctx.lineTo(bounds.originX + contour[i].x * bounds.scale, bounds.originY + contour[i].y * bounds.scale);
          }
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
      ctx.restore();

      // Marching ants on all contours
      for (const contour of contours) {
        const tracePath = (c: CanvasRenderingContext2D) => {
          c.beginPath();
          c.moveTo(bounds.originX + contour[0].x * bounds.scale, bounds.originY + contour[0].y * bounds.scale);
          for (let i = 1; i < contour.length; i++) {
            c.lineTo(bounds.originX + contour[i].x * bounds.scale, bounds.originY + contour[i].y * bounds.scale);
          }
          c.closePath();
        };

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -(performance.now() / 90);
        ctx.lineWidth = 1;
        tracePath(ctx);
        ctx.stroke();
        ctx.strokeStyle = "rgba(7,11,21,0.9)";
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = 4 - (performance.now() / 90);
        tracePath(ctx);
        ctx.stroke();
        ctx.restore();
      }
    }
  } else if (doc.selectionRect && !marqueePreview?.previewRect) {
    const selectionX = bounds.originX + doc.selectionRect.x * bounds.scale;
    const selectionY = bounds.originY + doc.selectionRect.y * bounds.scale;
    const selectionW = doc.selectionRect.width * bounds.scale;
    const selectionH = doc.selectionRect.height * bounds.scale;
    const isEllipse = doc.selectionShape === "ellipse";

    const traceSelectionPath = (c: CanvasRenderingContext2D) => {
      if (isEllipse) {
        c.beginPath();
        c.ellipse(selectionX + selectionW / 2, selectionY + selectionH / 2, selectionW / 2, selectionH / 2, 0, 0, Math.PI * 2);
      } else {
        c.beginPath();
        c.rect(selectionX, selectionY, selectionW, selectionH);
      }
    };

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    if (doc.selectionInverted) {
      traceSelectionPath(ctx);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.rect(bounds.originX, bounds.originY, bounds.width, bounds.height);
      if (isEllipse) {
        ctx.ellipse(selectionX + selectionW / 2, selectionY + selectionH / 2, Math.max(0, selectionW / 2), Math.max(0, selectionH / 2), 0, 0, Math.PI * 2);
      } else {
        ctx.rect(selectionX, selectionY, selectionW, selectionH);
      }
      ctx.fill("evenodd");
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(performance.now() / 90);
    ctx.lineWidth = 1;
    traceSelectionPath(ctx);
    ctx.stroke();
    ctx.strokeStyle = "rgba(7,11,21,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = 4 - (performance.now() / 90);
    traceSelectionPath(ctx);
    ctx.stroke();
    ctx.restore();

    if (doc.selectionInverted) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -(performance.now() / 90);
      ctx.lineWidth = 1;
      ctx.strokeRect(bounds.originX + 0.5, bounds.originY + 0.5, bounds.width, bounds.height);
      ctx.strokeStyle = "rgba(7,11,21,0.9)";
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = 4 - (performance.now() / 90);
      ctx.strokeRect(bounds.originX + 0.5, bounds.originY + 0.5, bounds.width, bounds.height);
      ctx.restore();
    }
  }

  if (!doc.selectionMask && doc.selectionPath?.closed && doc.selectionPath.points.length >= 3) {
    const pts = doc.selectionPath.points;

    const tracePathPoly = (c: CanvasRenderingContext2D) => {
      c.beginPath();
      c.moveTo(bounds.originX + pts[0].x * bounds.scale, bounds.originY + pts[0].y * bounds.scale);
      for (let i = 1; i < pts.length; i++) {
        c.lineTo(bounds.originX + pts[i].x * bounds.scale, bounds.originY + pts[i].y * bounds.scale);
      }
      c.closePath();
    };

    // Tinted overlay outside selection
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    if (doc.selectionInverted) {
      tracePathPoly(ctx);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.rect(bounds.originX, bounds.originY, bounds.width, bounds.height);
      tracePathPoly(ctx);
      ctx.fill("evenodd");
    }
    ctx.restore();

    // Marching ants
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(performance.now() / 90);
    ctx.lineWidth = 1;
    tracePathPoly(ctx);
    ctx.stroke();
    ctx.strokeStyle = "rgba(7,11,21,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = 4 - (performance.now() / 90);
    tracePathPoly(ctx);
    ctx.stroke();
    ctx.restore();
  }

  // In-progress (open) lasso path preview
  if (doc.selectionPath && !doc.selectionPath.closed && doc.selectionPath.points.length >= 2) {
    const pts = doc.selectionPath.points;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bounds.originX + pts[0].x * bounds.scale, bounds.originY + pts[0].y * bounds.scale);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(bounds.originX + pts[i].x * bounds.scale, bounds.originY + pts[i].y * bounds.scale);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (marqueePreview?.previewRect) {
    const previewX = bounds.originX + marqueePreview.previewRect.x * bounds.scale;
    const previewY = bounds.originY + marqueePreview.previewRect.y * bounds.scale;
    const previewW = marqueePreview.previewRect.width * bounds.scale;
    const previewH = marqueePreview.previewRect.height * bounds.scale;
    const { sides, rotation, perfect } = marqueePreview;
    const modeColor = marqueePreview.mode === "subtract" ? "rgba(255,100,100,0.85)"
      : marqueePreview.mode === "intersect" ? "rgba(255,200,60,0.85)"
      : marqueePreview.mode === "add" ? "rgba(100,200,255,0.85)"
      : "rgba(255,255,255,0.95)";

    const tracePreview = (c: CanvasRenderingContext2D) => {
      traceMarqueeShape(c, previewX + previewW / 2, previewY + previewH / 2, previewW / 2, previewH / 2, sides, rotation, perfect);
    };

    ctx.save();
    ctx.strokeStyle = modeColor;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(performance.now() / 90);
    ctx.lineWidth = 1;
    tracePreview(ctx);
    ctx.stroke();
    ctx.strokeStyle = "rgba(7,11,21,0.6)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = 4 - (performance.now() / 90);
    tracePreview(ctx);
    ctx.stroke();
    ctx.restore();
  }

  if (doc && activeTool === "transform" && activeLayer && !activeLayer.isBackground) {
    const frameX = transformPreview?.x ?? activeLayer.x;
    const frameY = transformPreview?.y ?? activeLayer.y;
    const frameW = transformPreview?.width ?? activeLayer.canvas.width;
    const frameH = transformPreview?.height ?? activeLayer.canvas.height;
    const layerX = bounds.originX + frameX * bounds.scale;
    const layerY = bounds.originY + frameY * bounds.scale;
    const layerW = frameW * bounds.scale;
    const layerH = frameH * bounds.scale;
    const handles = [
      [layerX, layerY],
      [layerX + layerW, layerY],
      [layerX, layerY + layerH],
      [layerX + layerW, layerY + layerH],
      [layerX + layerW / 2, layerY],
      [layerX + layerW, layerY + layerH / 2],
      [layerX + layerW / 2, layerY + layerH],
      [layerX, layerY + layerH / 2],
    ];

    ctx.save();
    ctx.strokeStyle = "#7c73ff";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(layerX + 0.5, layerY + 0.5, layerW, layerH);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#0b1020";
    handles.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.rect(x - 5, y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
    });

    if (params.pivotPoint) {
      const px = bounds.originX + params.pivotPoint.x * bounds.scale;
      const py = bounds.originY + params.pivotPoint.y * bounds.scale;
      ctx.strokeStyle = "#7c73ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 9, py);
      ctx.lineTo(px + 9, py);
      ctx.moveTo(px, py - 9);
      ctx.lineTo(px, py + 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (doc && params.guides && params.guides.length > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(124, 115, 255, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    for (const guide of params.guides) {
      if (guide.orientation === "horizontal") {
        const gy = bounds.originY + guide.position * bounds.scale;
        ctx.beginPath();
        ctx.moveTo(bounds.originX, gy + 0.5);
        ctx.lineTo(bounds.originX + bounds.width, gy + 0.5);
        ctx.stroke();
      } else {
        const gx = bounds.originX + guide.position * bounds.scale;
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, bounds.originY);
        ctx.lineTo(gx + 0.5, bounds.originY + bounds.height);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (doc && params.snapLines && params.snapLines.length > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(78, 222, 128, 0.7)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const line of params.snapLines) {
      if (line.orientation === "horizontal") {
        const sy = bounds.originY + line.position * bounds.scale;
        ctx.beginPath();
        ctx.moveTo(0, sy + 0.5);
        ctx.lineTo(editorCanvas.getBoundingClientRect().width, sy + 0.5);
        ctx.stroke();
      } else {
        const sx = bounds.originX + line.position * bounds.scale;
        ctx.beginPath();
        ctx.moveTo(sx + 0.5, 0);
        ctx.lineTo(sx + 0.5, editorCanvas.getBoundingClientRect().height);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (doc && params.showRulers) {
    const rulerSize = 20;
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = editorCanvas.getBoundingClientRect().width;
    const canvasHeight = editorCanvas.getBoundingClientRect().height;

    ctx.save();
    ctx.fillStyle = "rgba(8, 11, 20, 0.88)";
    ctx.fillRect(0, 0, canvasWidth, rulerSize);
    ctx.fillRect(0, rulerSize, rulerSize, canvasHeight - rulerSize);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `${9 / dpr}px monospace`;
    ctx.textBaseline = "top";

    const step = getRulerStep(bounds.scale);
    const startDocX = Math.floor(-bounds.originX / bounds.scale / step) * step;
    const endDocX = Math.ceil((canvasWidth - bounds.originX) / bounds.scale / step) * step;
    for (let docX = startDocX; docX <= endDocX; docX += step) {
      const screenX = bounds.originX + docX * bounds.scale;
      if (screenX < rulerSize || screenX > canvasWidth) continue;
      ctx.fillRect(screenX, rulerSize - 6, 1, 6);
      ctx.fillText(String(Math.round(docX)), screenX + 2, 2);
    }

    const startDocY = Math.floor(-bounds.originY / bounds.scale / step) * step;
    const endDocY = Math.ceil((canvasHeight - bounds.originY) / bounds.scale / step) * step;
    for (let docY = startDocY; docY <= endDocY; docY += step) {
      const screenY = bounds.originY + docY * bounds.scale;
      if (screenY < rulerSize || screenY > canvasHeight) continue;
      ctx.fillRect(rulerSize - 6, screenY, 6, 1);
      ctx.save();
      ctx.translate(2, screenY + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(docY)), 0, 0);
      ctx.restore();
    }

    ctx.fillStyle = "rgba(8, 11, 20, 0.88)";
    ctx.fillRect(0, 0, rulerSize, rulerSize);
    ctx.restore();
  }
}

function getRulerStep(scale: number): number {
  const baseStep = 100 / scale;
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const step of candidates) {
    if (step * scale >= 40) return step;
  }
  return candidates[candidates.length - 1];
}

export function renderTabs(activeTab: AppTab) {
  document.querySelectorAll<HTMLElement>("[data-tab-trigger]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTrigger === activeTab);
  });
  document.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.tabPanel === activeTab);
  });
}

export function renderDocumentTabs(params: {
  tabs: HTMLElement;
  documents: DocumentState[];
  activeDocumentId: string;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
}) {
  const { tabs, documents, activeDocumentId, onActivate, onClose } = params;
  tabs.innerHTML = "";
  for (const doc of documents) {
    const wrap = document.createElement("div");
    wrap.className = "document-tab-wrap";

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `document-tab${doc.id === activeDocumentId ? " is-active" : ""}`;
    tab.setAttribute("data-tab-trigger", doc.id);
    tab.addEventListener("click", () => onActivate(doc.id));

    if (doc.dirty) {
      const dirty = document.createElement("span");
      dirty.className = "document-tab-dirty";
      dirty.title = "Unsaved changes";
      tab.appendChild(dirty);
    }

    const label = document.createElement("span");
    label.textContent = doc.name;
    tab.appendChild(label);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn icon-btn-sm document-tab-close";
    close.innerHTML = '<i data-lucide="x"></i>';
    close.title = `Close ${doc.name}`;
    close.setAttribute("aria-label", `Close ${doc.name}`);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose(doc.id);
    });

    wrap.appendChild(tab);
    wrap.appendChild(close);
    tabs.appendChild(wrap);
  }
}

export function renderHistory(historyList: HTMLElement, doc: DocumentState) {
  historyList.innerHTML = "";
  for (const step of doc.history) {
    const item = document.createElement("div");
    item.className = "history-row";
    item.textContent = step;
    historyList.appendChild(item);
  }
}

export function updateBrushUI(params: {
  brushSize: number;
  brushOpacity: number;
  activeColour: string;
  brushSizeInput: HTMLInputElement;
  brushOpacityInput: HTMLInputElement;
  brushColourPreview: HTMLElement;
  brushColourValue: HTMLElement;
  colourPreview: HTMLElement;
  colourValue: HTMLElement;
}) {
  params.brushSizeInput.value = String(params.brushSize);
  params.brushOpacityInput.value = String(Math.round(params.brushOpacity * 100));
  params.brushColourPreview.style.background = params.activeColour;
  params.brushColourValue.textContent = params.activeColour;
  params.colourPreview.style.background = params.activeColour;
  params.colourValue.textContent = params.activeColour;
}

export function renderToolState(params: {
  activeTool: ActiveTool;
  toolCopy: Record<ActiveTool, string>;
  canvasWrap: HTMLElement;
  activeToolCopy: HTMLElement;
  brushSizeField: HTMLElement;
  brushOpacityField: HTMLElement;
  brushColourField: HTMLElement;
  healingToolHint: HTMLElement;
  textToolHint: HTMLElement;
  shapeToolHint: HTMLElement;
  shapeKindField: HTMLElement;
  cropToolHint: HTMLElement;
  marqueeToolHint: HTMLElement;
  marqueeShapeField: HTMLElement;
  marqueeModeField: HTMLElement;
  transformToolHint: HTMLElement;
  transformModeField: HTMLElement;
  transformControlsField: HTMLElement;
  lassoToolHint: HTMLElement;
  lassoModeField: HTMLElement;
  polygonLassoToolHint: HTMLElement;
  polygonLassoModeField: HTMLElement;
  magicWandToolHint: HTMLElement;
  magicWandModeField: HTMLElement;
  magicWandSettings: HTMLElement;
  toolSettingsEmpty: HTMLElement;
}) {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === params.activeTool);
  });
  params.activeToolCopy.textContent = params.toolCopy[params.activeTool];
  const showBrushControls = params.activeTool === "brush" || params.activeTool === "eraser" || params.activeTool === "healing-brush";
  const showBrushColour = params.activeTool === "brush" || params.activeTool === "eyedropper" || params.activeTool === "text" || params.activeTool === "shape";
  const showHealing = params.activeTool === "healing-brush";
  const showText = params.activeTool === "text";
  const showShape = params.activeTool === "shape";
  const showMarquee = params.activeTool === "marquee";
  const showTransform = params.activeTool === "transform";
  const showCrop = params.activeTool === "crop";
  const showLasso = params.activeTool === "lasso";
  const showPolygonLasso = params.activeTool === "polygon-lasso";
  const showMagicWand = params.activeTool === "magic-wand";

  params.brushSizeField.toggleAttribute("hidden", !showBrushControls);
  params.brushOpacityField.toggleAttribute("hidden", !showBrushControls);
  params.brushColourField.toggleAttribute("hidden", !showBrushColour);
  params.healingToolHint.toggleAttribute("hidden", !showHealing);
  params.textToolHint.toggleAttribute("hidden", !showText);
  params.shapeToolHint.toggleAttribute("hidden", !showShape);
  params.shapeKindField.toggleAttribute("hidden", !showShape);
  params.cropToolHint.toggleAttribute("hidden", !showCrop);
  params.marqueeToolHint.toggleAttribute("hidden", !showMarquee);
  params.marqueeShapeField.toggleAttribute("hidden", !showMarquee);
  params.marqueeModeField.toggleAttribute("hidden", !showMarquee);
  params.transformToolHint.toggleAttribute("hidden", !showTransform);
  params.transformModeField.toggleAttribute("hidden", !showTransform);
  params.transformControlsField.toggleAttribute("hidden", !showTransform);
  params.lassoToolHint.toggleAttribute("hidden", !showLasso);
  params.lassoModeField.toggleAttribute("hidden", !showLasso);
  params.polygonLassoToolHint.toggleAttribute("hidden", !showPolygonLasso);
  params.polygonLassoModeField.toggleAttribute("hidden", !showPolygonLasso);
  params.magicWandToolHint.toggleAttribute("hidden", !showMagicWand);
  params.magicWandModeField.toggleAttribute("hidden", !showMagicWand);
  params.magicWandSettings.toggleAttribute("hidden", !showMagicWand);
  const hasAnySettings = showBrushControls || showBrushColour || showHealing || showText || showShape || showCrop || showMarquee || showTransform || showLasso || showPolygonLasso || showMagicWand;
  params.toolSettingsEmpty.toggleAttribute("hidden", hasAnySettings);
  params.canvasWrap.dataset.tool = params.activeTool;
}

export function renderInspector(params: {
  doc: DocumentState;
  activeLayer: Layer | null;
  backgroundColourInput: HTMLInputElement;
  inspectorMode: HTMLElement;
  inspectorSelection: HTMLElement;
  inspectorBlend: HTMLElement;
  inspectorOpacity: HTMLElement;
  inspectorPosition: HTMLElement;
  inspectorLayer: HTMLElement;
  textInspector: HTMLElement;
  shapeInspector: HTMLElement;
  adjustmentInspector: HTMLElement;
  smartObjectInspector: HTMLElement;
  effectsInspector: HTMLElement;
  effectsList: HTMLElement;
  textValue: HTMLTextAreaElement;
  textFontFamily: HTMLInputElement;
  textFontSize: HTMLInputElement;
  textLineHeight: HTMLInputElement;
  textKerning: HTMLInputElement;
  textBoxWidth: HTMLInputElement;
  textAlignment: HTMLSelectElement;
  textFill: HTMLInputElement;
  textBold: HTMLInputElement;
  textItalic: HTMLInputElement;
  shapeKind: HTMLSelectElement;
  shapeWidth: HTMLInputElement;
  shapeHeight: HTMLInputElement;
  shapeFill: HTMLInputElement;
  shapeStroke: HTMLInputElement;
  shapeStrokeWidth: HTMLInputElement;
  shapeCornerRadius: HTMLInputElement;
  /** Called when any effect field changes or an effect is toggled/deleted via the dynamic effects list */
  onEffectChange: () => void;
  // Adjustment layer inspector fields
  adjKindBadge: HTMLElement;
  adjBcFields: HTMLElement;
  adjBcBrightness: HTMLInputElement;
  adjBcContrast: HTMLInputElement;
  adjHsFields: HTMLElement;
  adjHsHue: HTMLInputElement;
  adjHsSaturation: HTMLInputElement;
  adjHsLightness: HTMLInputElement;
  adjLevelsFields: HTMLElement;
  adjLevelsBlack: HTMLInputElement;
  adjLevelsGamma: HTMLInputElement;
  adjLevelsWhite: HTMLInputElement;
  adjCurvesFields: HTMLElement;
  adjCurvesMidX: HTMLInputElement;
  adjCurvesMidY: HTMLInputElement;
  adjCbFields: HTMLElement;
  adjCbShCr: HTMLInputElement;
  adjCbShMg: HTMLInputElement;
  adjCbShYb: HTMLInputElement;
  adjCbMtCr: HTMLInputElement;
  adjCbMtMg: HTMLInputElement;
  adjCbMtYb: HTMLInputElement;
  adjCbHlCr: HTMLInputElement;
  adjCbHlMg: HTMLInputElement;
  adjCbHlYb: HTMLInputElement;
  adjGmFields: HTMLElement;
  adjGmPreset: HTMLSelectElement;
  // Smart object inspector fields
  soSourceDims: HTMLElement;
  soScaleX: HTMLInputElement;
  soScaleY: HTMLInputElement;
  soRotateDeg: HTMLInputElement;
}) {
  const { doc, activeLayer } = params;
  const backgroundLayer = doc.layers[0];
  params.inspectorMode.textContent = activeLayer?.type ?? "Raster";
  params.inspectorSelection.textContent = doc.cropRect ? "Crop active" : doc.selectionRect ? (doc.selectionInverted ? "Selection inverted" : "Selection active") : "None";
  params.inspectorBlend.textContent = "Normal";
  params.inspectorOpacity.textContent = `${Math.round((activeLayer?.opacity ?? 1) * 100)}%`;
  params.inspectorPosition.textContent = activeLayer ? `${Math.round(activeLayer.x)}, ${Math.round(activeLayer.y)}` : "0, 0";
  params.inspectorLayer.textContent = activeLayer?.name ?? "None";
  params.backgroundColourInput.value = backgroundLayer?.fillColor ?? "#ffffff";
  params.textInspector.toggleAttribute("hidden", activeLayer?.type !== "text");
  params.shapeInspector.toggleAttribute("hidden", activeLayer?.type !== "shape");
  params.adjustmentInspector.toggleAttribute("hidden", activeLayer?.type !== "adjustment");
  params.smartObjectInspector.toggleAttribute("hidden", activeLayer?.type !== "smart-object");
  params.effectsInspector.toggleAttribute("hidden", !activeLayer);

  if (activeLayer?.type === "text") {
    params.textValue.value = activeLayer.textData.text;
    params.textFontFamily.value = activeLayer.textData.fontFamily;
    params.textFontSize.value = String(activeLayer.textData.fontSize);
    params.textLineHeight.value = String(activeLayer.textData.lineHeight);
    params.textKerning.value = String(activeLayer.textData.kerning);
    params.textBoxWidth.value = activeLayer.textData.boxWidth ? String(activeLayer.textData.boxWidth) : "";
    params.textAlignment.value = activeLayer.textData.alignment;
    params.textFill.value = activeLayer.textData.fillColor;
    params.textBold.checked = activeLayer.textData.bold;
    params.textItalic.checked = activeLayer.textData.italic;
  }

  if (activeLayer?.type === "shape") {
    params.shapeKind.value = activeLayer.shapeData.kind;
    params.shapeWidth.value = String(activeLayer.shapeData.width);
    params.shapeHeight.value = String(activeLayer.shapeData.height);
    params.shapeFill.value = activeLayer.shapeData.fillColor ?? "#000000";
    params.shapeStroke.value = activeLayer.shapeData.strokeColor ?? "#ffffff";
    params.shapeStrokeWidth.value = String(activeLayer.shapeData.strokeWidth);
    params.shapeCornerRadius.value = String(activeLayer.shapeData.cornerRadius);
  }

  // Smart object inspector
  if (activeLayer?.type === "smart-object") {
    const sd = activeLayer.smartObjectData;
    params.soSourceDims.textContent = `${sd.sourceWidth} × ${sd.sourceHeight}`;
    params.soScaleX.value = String(Math.round(sd.scaleX * 100));
    params.soScaleY.value = String(Math.round(sd.scaleY * 100));
    params.soRotateDeg.value = String(sd.rotateDeg);
  }

  // Adjustment layer inspector
  if (activeLayer?.type === "adjustment") {
    const ad = activeLayer.adjustmentData;
    const kind = ad.kind;
    const LABELS: Record<string, string> = {
      "brightness-contrast": "B/C",
      "hue-saturation": "H/S",
      "levels": "Levels",
      "curves": "Curves",
      "color-balance": "CB",
      "gradient-map": "GMap",
    };
    params.adjKindBadge.textContent = LABELS[kind] ?? kind;

    // Show only the relevant field group
    params.adjBcFields.hidden = kind !== "brightness-contrast";
    params.adjHsFields.hidden = kind !== "hue-saturation";
    params.adjLevelsFields.hidden = kind !== "levels";
    params.adjCurvesFields.hidden = kind !== "curves";
    params.adjCbFields.hidden = kind !== "color-balance";
    params.adjGmFields.hidden = kind !== "gradient-map";

    if (kind === "brightness-contrast") {
      params.adjBcBrightness.value = String(ad.params.brightness ?? 0);
      params.adjBcContrast.value = String(ad.params.contrast ?? 0);
    } else if (kind === "hue-saturation") {
      params.adjHsHue.value = String(ad.params.hue ?? 0);
      params.adjHsSaturation.value = String(ad.params.saturation ?? 0);
      params.adjHsLightness.value = String(ad.params.lightness ?? 0);
    } else if (kind === "levels") {
      params.adjLevelsBlack.value = String(ad.params.inputBlack ?? 0);
      params.adjLevelsGamma.value = String(Math.round((ad.params.gamma as number ?? 1) * 100));
      params.adjLevelsWhite.value = String(ad.params.inputWhite ?? 255);
    } else if (kind === "curves") {
      const pts = ad.params.points as Array<{ x: number; y: number }> ?? [{ x: 0, y: 0 }, { x: 255, y: 255 }];
      const mid = pts.length > 2 ? pts[1] : { x: 128, y: 128 };
      params.adjCurvesMidX.value = String(mid.x);
      params.adjCurvesMidY.value = String(mid.y);
    } else if (kind === "color-balance") {
      params.adjCbShCr.value = String(ad.params.shadowsCyanRed ?? 0);
      params.adjCbShMg.value = String(ad.params.shadowsMagentaGreen ?? 0);
      params.adjCbShYb.value = String(ad.params.shadowsYellowBlue ?? 0);
      params.adjCbMtCr.value = String(ad.params.midtonesCyanRed ?? 0);
      params.adjCbMtMg.value = String(ad.params.midtonesMagentaGreen ?? 0);
      params.adjCbMtYb.value = String(ad.params.midtonesYellowBlue ?? 0);
      params.adjCbHlCr.value = String(ad.params.highlightsCyanRed ?? 0);
      params.adjCbHlMg.value = String(ad.params.highlightsMagentaGreen ?? 0);
      params.adjCbHlYb.value = String(ad.params.highlightsYellowBlue ?? 0);
    } else if (kind === "gradient-map") {
      // We don't read back which preset it is — just leave the select as-is
    }
  }

  // Dynamic effects list rendering
  renderEffectsList(params.effectsList, activeLayer?.effects ?? [], params.onEffectChange);
}

/**
 * Renders the dynamic effects list for the active layer.
 * Each effect gets: enabled checkbox, type label, delete button, and type-specific controls.
 * Changes call `onChange` which triggers the main inspector apply + re-render loop.
 */
function renderEffectsList(container: HTMLElement, effects: LayerEffect[], onChange: () => void) {
  container.innerHTML = "";
  if (effects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "layer-meta";
    empty.textContent = "No effects";
    container.appendChild(empty);
    return;
  }

  effects.forEach((effect, index) => {
    const meta = getEffectMeta(effect.type as EffectType);
    if (!meta) return;

    const entry = document.createElement("div");
    entry.className = "effect-entry";
    entry.style.cssText = "margin-bottom:6px; padding:4px 0; border-bottom:1px solid var(--c-border, #333)";

    // Header row: checkbox + label + delete
    const header = document.createElement("div");
    header.style.cssText = "display:flex; align-items:center; gap:6px; margin-bottom:4px";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = effect.enabled;
    checkbox.dataset.effectIndex = String(index);
    checkbox.dataset.effectField = "enabled";
    checkbox.addEventListener("change", onChange);
    header.appendChild(checkbox);

    const label = document.createElement("span");
    label.style.cssText = "flex:1; font-size:12px; font-weight:600";
    label.textContent = meta.label;
    header.appendChild(label);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn icon-btn-sm";
    deleteBtn.innerHTML = `<i data-lucide="x"></i>`;
    deleteBtn.title = "Remove effect";
    deleteBtn.dataset.effectDeleteIndex = String(index);
    deleteBtn.addEventListener("click", onChange);
    header.appendChild(deleteBtn);

    entry.appendChild(header);

    // Fields
    const grid = document.createElement("div");
    grid.className = "inline-control-grid";

    for (const field of meta.fields) {
      const fieldWrap = document.createElement("label");
      fieldWrap.className = "field-block";

      const fieldLabel = document.createElement("span");
      fieldLabel.textContent = field.label;
      fieldWrap.appendChild(fieldLabel);

      const input = document.createElement("input");
      input.dataset.effectIndex = String(index);
      input.dataset.effectField = field.key;

      const raw = (effect as unknown as Record<string, unknown>)[field.key];

      if (field.type === "color") {
        input.type = "color";
        input.value = (raw as string) ?? "#000000";
      } else if (field.type === "range") {
        input.type = "range";
        input.min = String(field.min ?? 0);
        input.max = String(field.max ?? 100);
        input.step = String(field.step ?? 1);
        input.value = String(Math.round((raw as number ?? 0) * (field.uiScale ?? 1)));
      } else {
        input.type = "number";
        if (field.min !== undefined) input.min = String(field.min);
        if (field.step !== undefined) input.step = String(field.step);
        input.value = String(raw ?? 0);
      }

      input.addEventListener("input", onChange);
      input.addEventListener("change", onChange);
      fieldWrap.appendChild(input);
      grid.appendChild(fieldWrap);
    }

    entry.appendChild(grid);
    container.appendChild(entry);
  });
}

export function renderSettingsUI(settings: VisionSettings) {
  (document.getElementById("checkerboard-toggle") as HTMLInputElement).checked = settings.showCheckerboard;
  (document.getElementById("grid-toggle") as HTMLInputElement).checked = settings.showGrid;
  (document.getElementById("grid-size-input") as HTMLInputElement).value = String(settings.gridSize);
  (document.getElementById("snap-toggle") as HTMLInputElement).checked = settings.snapEnabled;
  (document.getElementById("default-zoom-select") as HTMLSelectElement).value = String(settings.defaultZoom);
  (document.getElementById("colour-format-select") as HTMLSelectElement).value = settings.colourFormat;
  (document.getElementById("export-format-select") as HTMLSelectElement).value = settings.exportFormat;
  (document.getElementById("export-quality-range") as HTMLInputElement).value = String(settings.exportQuality);
  (document.getElementById("export-quality-label") as HTMLElement).textContent = `Export quality: ${settings.exportQuality}%`;
  (document.getElementById("capture-destination-select") as HTMLSelectElement).value = settings.captureDestination;
  (document.getElementById("capture-delay-select") as HTMLSelectElement).value = String(settings.captureDelaySeconds);
  (document.getElementById("capture-hide-window-checkbox") as HTMLInputElement).checked = settings.captureHideWindow;
  (document.getElementById("left-panel-width-range") as HTMLInputElement).value = String(settings.leftPanelWidth);
  (document.getElementById("right-panel-width-range") as HTMLInputElement).value = String(settings.rightPanelWidth);
  (document.getElementById("confirm-layer-deletion-checkbox") as HTMLInputElement).checked = settings.confirmLayerDeletion;
}
