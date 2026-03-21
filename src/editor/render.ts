import type { AppTab, VisionSettings } from "../settings";
import { getCanvasBounds } from "./geometry";
import type { ActiveTool, DocumentState, RasterLayer, Rect } from "./types";
import { compositeDocumentOnto, createLayerThumb } from "./documents";

export function renderCanvas(params: {
  editorCanvas: HTMLCanvasElement;
  getEditorContext: () => CanvasRenderingContext2D;
  doc: DocumentState | null;
  activeTool?: ActiveTool;
  activeLayer?: RasterLayer | null;
  marqueePreview?: { baseRect: Rect | null; previewRect: Rect | null; mode: "replace" | "add" | "subtract" | "intersect" } | null;
  transformPreview?: { layerId: string; canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number } | null;
  pivotPoint?: { x: number; y: number } | null;
  guides?: Array<{ orientation: "horizontal" | "vertical"; position: number }>;
  snapLines?: Array<{ orientation: "horizontal" | "vertical"; position: number }>;
  showRulers?: boolean;
  showGrid?: boolean;
  gridSize?: number;
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

  if (doc.selectionRect) {
    const selectionX = bounds.originX + doc.selectionRect.x * bounds.scale;
    const selectionY = bounds.originY + doc.selectionRect.y * bounds.scale;
    const selectionW = doc.selectionRect.width * bounds.scale;
    const selectionH = doc.selectionRect.height * bounds.scale;

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    if (doc.selectionInverted) {
      ctx.fillRect(selectionX, selectionY, selectionW, selectionH);
    } else {
      ctx.fillRect(bounds.originX, bounds.originY, bounds.width, selectionY - bounds.originY);
      ctx.fillRect(bounds.originX, selectionY, selectionX - bounds.originX, selectionH);
      ctx.fillRect(selectionX + selectionW, selectionY, bounds.originX + bounds.width - (selectionX + selectionW), selectionH);
      ctx.fillRect(bounds.originX, selectionY + selectionH, bounds.width, bounds.originY + bounds.height - (selectionY + selectionH));
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(performance.now() / 90);
    ctx.lineWidth = 1;
    ctx.strokeRect(selectionX + 0.5, selectionY + 0.5, selectionW, selectionH);
    ctx.strokeStyle = "rgba(7,11,21,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = 4 - (performance.now() / 90);
    ctx.strokeRect(selectionX + 0.5, selectionY + 0.5, selectionW, selectionH);
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

  if (marqueePreview?.baseRect && marqueePreview.mode !== "replace") {
    const previewBaseX = bounds.originX + marqueePreview.baseRect.x * bounds.scale;
    const previewBaseY = bounds.originY + marqueePreview.baseRect.y * bounds.scale;
    const previewBaseW = marqueePreview.baseRect.width * bounds.scale;
    const previewBaseH = marqueePreview.baseRect.height * bounds.scale;
    ctx.save();
    ctx.strokeStyle = "rgba(124,115,255,0.95)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(previewBaseX + 0.5, previewBaseY + 0.5, previewBaseW, previewBaseH);
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
  cropToolHint: HTMLElement;
  marqueeToolHint: HTMLElement;
  marqueeModeField: HTMLElement;
  transformToolHint: HTMLElement;
  transformModeField: HTMLElement;
  transformControlsField: HTMLElement;
  toolSettingsEmpty: HTMLElement;
}) {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === params.activeTool);
  });
  params.activeToolCopy.textContent = params.toolCopy[params.activeTool];
  const showBrushControls = params.activeTool === "brush" || params.activeTool === "eraser";
  const showBrushColour = params.activeTool === "brush" || params.activeTool === "eyedropper";
  const showMarquee = params.activeTool === "marquee";
  const showTransform = params.activeTool === "transform";
  const showCrop = params.activeTool === "crop";

  params.brushSizeField.toggleAttribute("hidden", !showBrushControls);
  params.brushOpacityField.toggleAttribute("hidden", !showBrushControls);
  params.brushColourField.toggleAttribute("hidden", !showBrushColour);
  params.cropToolHint.toggleAttribute("hidden", !showCrop);
  params.marqueeToolHint.toggleAttribute("hidden", !showMarquee);
  params.marqueeModeField.toggleAttribute("hidden", !showMarquee);
  params.transformToolHint.toggleAttribute("hidden", !showTransform);
  params.transformModeField.toggleAttribute("hidden", !showTransform);
  params.transformControlsField.toggleAttribute("hidden", !showTransform);
  params.toolSettingsEmpty.toggleAttribute("hidden", showBrushControls || showBrushColour || showCrop || showMarquee || showTransform);
  params.canvasWrap.dataset.tool = params.activeTool;
}

export function renderInspector(params: {
  doc: DocumentState;
  activeLayer: RasterLayer | null;
  backgroundColourInput: HTMLInputElement;
  inspectorMode: HTMLElement;
  inspectorSelection: HTMLElement;
  inspectorBlend: HTMLElement;
  inspectorOpacity: HTMLElement;
  inspectorPosition: HTMLElement;
  inspectorLayer: HTMLElement;
}) {
  const { doc, activeLayer } = params;
  const backgroundLayer = doc.layers[0];
  params.inspectorMode.textContent = "Raster";
  params.inspectorSelection.textContent = doc.cropRect ? "Crop active" : doc.selectionRect ? (doc.selectionInverted ? "Selection inverted" : "Selection active") : "None";
  params.inspectorBlend.textContent = "Normal";
  params.inspectorOpacity.textContent = `${Math.round((activeLayer?.opacity ?? 1) * 100)}%`;
  params.inspectorPosition.textContent = activeLayer ? `${Math.round(activeLayer.x)}, ${Math.round(activeLayer.y)}` : "0, 0";
  params.inspectorLayer.textContent = activeLayer?.name ?? "None";
  params.backgroundColourInput.value = backgroundLayer?.fillColor ?? "#ffffff";
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
  (document.getElementById("left-panel-width-range") as HTMLInputElement).value = String(settings.leftPanelWidth);
  (document.getElementById("right-panel-width-range") as HTMLInputElement).value = String(settings.rightPanelWidth);
}
