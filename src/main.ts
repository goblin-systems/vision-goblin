import "@goblin-systems/goblin-design-system/style.css";
import "./styles.css";
import {
  applyIcons,
  bindNavigation,
  bindSplitPaneResize,
  bindTabs,
  closeModal,
  confirmModal,
  openModal,
  setupWindowControls,
  showToast as showGoblinToast,
} from "@goblin-systems/goblin-design-system";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  getDefaultSettings,
  loadSettings,
  saveSettings,
  type AppTab,
  type VisionSettings,
} from "./settings";
import { byId, createAppDom } from "./app/dom";
import { bindPaintControls as bindPaintControlsView, bindSettingsInputs as bindSettingsInputsView, bindToolSelection as bindToolSelectionView } from "./app/bindings";
import { createIoController } from "./app/io";
import { configureDebugLogging, debugLog, getDebugLogPath, openDebugLogFolder } from "./logger";
import { pushHistory } from "./editor/history";
import { getCanvasBounds, getResizeOffset } from "./editor/geometry";
import { addLayer, deleteLayer as deleteLayerAction, duplicateLayer as duplicateLayerAction, moveLayer as moveLayerAction, renameLayer as renameLayerAction, selectLayer, setBackgroundLayerColor, toggleLayerLock, toggleLayerVisibility } from "./editor/layers";
import { renderLayerList } from "./editor/layerList";
import { renderCanvas as renderCanvasView, renderDocumentTabs as renderDocumentTabsView, renderHistory as renderHistoryView, renderInspector as renderInspectorView, renderSettingsUI as renderSettingsUIView, renderToolState as renderToolStateView, updateBrushUI as updateBrushUIView } from "./editor/render";
import type { ActiveTool, DocumentState, Guide, PointerState, RasterLayer, ResizeAnchor, TransformDraft } from "./editor/types";
import { addBlobAsLayer, duplicateDocument, importDocumentFromBlob, makeNewDocument } from "./editor/actions/documentActions";
import { createCanvasPointerController } from "./editor/canvasPointer";
import {
  buildStarterDocuments,
  buildTransformPreview,
  getLayerContext,
  resizeCanvasDocument,
  restoreDocumentFromSnapshot,
  snapshotDocument,
  syncLayerSource,
} from "./editor/documents";
import { clamp, fileNameFromPath, nextId } from "./editor/utils";

type SelectionMode = "replace" | "add" | "subtract" | "intersect";
type TransformMode = "scale" | "rotate";
type CaptureOverlayMode = "region" | "picker";

interface CaptureWindowEntry {
  id: number;
  title: string;
}

interface CaptureOverlayState {
  active: boolean;
  mode: CaptureOverlayMode;
  imageUrl: string;
  imageBitmap: ImageBitmap | null;
  dragStartX: number;
  dragStartY: number;
  dragCurrentX: number;
  dragCurrentY: number;
  hoverX: number;
  hoverY: number;
  sampledColour: string;
}

const TOOL_COPY: Record<ActiveTool, string> = {
  move: "Move tool active. Drag the current layer to reposition it on the canvas.",
  marquee: "Marquee tool active. Drag on the canvas to create a rectangular selection.",
  transform: "Transform tool active. Drag a corner handle to scale the active layer.",
  crop: "Crop tool active. Drag a region and it applies automatically when you release.",
  brush: "Brush tool active. Paint directly onto the active raster layer.",
  eraser: "Eraser tool active. Destructively erase pixels from the active raster layer.",
  eyedropper: "Eyedropper active. Click the canvas to sample a colour into the paint swatch.",
};

const documents: DocumentState[] = [];

let settings = getDefaultSettings();
let activeDocumentId = "";
let activeColour = "#6C63FF";
let brushSize = 24;
let brushOpacity = 1;
let spacePressed = false;
let marqueeMode: SelectionMode = "replace";
let transformMode: TransformMode = "scale";
let marqueeModeOverride: SelectionMode | null = null;
let transformDraft: TransformDraft | null = null;
let activeSnapLines: Array<{ orientation: "horizontal" | "vertical"; position: number }> = [];
let draggingGuideId: string | null = null;
let draggingGuideOrientation: "horizontal" | "vertical" = "horizontal";
let captureOverlay: CaptureOverlayState = {
  active: false,
  mode: "region",
  imageUrl: "",
  imageBitmap: null,
  dragStartX: 0,
  dragStartY: 0,
  dragCurrentX: 0,
  dragCurrentY: 0,
  hoverX: 0,
  hoverY: 0,
  sampledColour: "#000000",
};
const currentWindow = getCurrentWindow();

function getEffectiveMarqueeMode(): SelectionMode {
  return marqueeModeOverride ?? marqueeMode;
}

function syncTransformInputs() {
  const scaleX = byId<HTMLInputElement>("transform-scale-x-input");
  const scaleY = byId<HTMLInputElement>("transform-scale-y-input");
  const rotate = byId<HTMLInputElement>("transform-rotate-input");
  const skewX = byId<HTMLInputElement>("transform-skew-x-input");
  const skewY = byId<HTMLInputElement>("transform-skew-y-input");
  scaleX.value = transformDraft ? String(Math.round(transformDraft.scaleX * 100)) : "100";
  scaleY.value = transformDraft ? String(Math.round(transformDraft.scaleY * 100)) : "100";
  rotate.value = transformDraft ? String(Math.round(transformDraft.rotateDeg)) : "0";
  skewX.value = transformDraft ? String(Math.round(transformDraft.skewXDeg)) : "0";
  skewY.value = transformDraft ? String(Math.round(transformDraft.skewYDeg)) : "0";
}

function ensureTransformDraft(doc: DocumentState, layer: RasterLayer) {
  if (transformDraft && transformDraft.layerId === layer.id) {
    return transformDraft;
  }
  const cx = layer.x + layer.canvas.width / 2;
  const cy = layer.y + layer.canvas.height / 2;
  transformDraft = {
    layerId: layer.id,
    sourceCanvas: (layer.sourceCanvas ?? layer.canvas),
    centerX: cx,
    centerY: cy,
    pivotX: cx,
    pivotY: cy,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    snapshot: snapshotDocument(doc),
  };
  syncTransformInputs();
  return transformDraft;
}

function ensureTransformDraftForActiveLayer() {
  const doc = getActiveDocument();
  const layer = doc ? getActiveLayer(doc) : null;
  if (!doc || !layer || layer.isBackground || layer.locked) {
    return null;
  }
  return ensureTransformDraft(doc, layer);
}

function cancelTransformDraft(showMessage = true) {
  if (!transformDraft) return;
  transformDraft = null;
  syncTransformInputs();
  renderEditorState();
  if (showMessage) showToast("Transform cancelled", "info");
}

function commitTransformDraft() {
  const doc = getActiveDocument();
  const draft = transformDraft;
  if (!doc || !draft) return;
  const layer = doc.layers.find((item) => item.id === draft.layerId);
  if (!layer) return;
  const preview = buildTransformPreview(draft);
  doc.undoStack.push(draft.snapshot);
  doc.redoStack = [];
  layer.canvas = preview.canvas;
  layer.x = Math.round(preview.x);
  layer.y = Math.round(preview.y);
  syncLayerSource(layer);
  doc.dirty = true;
  pushHistory(doc, "Applied transform");
  transformDraft = null;
  syncTransformInputs();
  renderEditorState();
  showToast("Transform applied", "success");
}

function updateTransformDraftInputs() {
  if (!transformDraft) return;
  transformDraft.scaleX = Math.max(0.01, Number(byId<HTMLInputElement>("transform-scale-x-input").value) / 100);
  transformDraft.scaleY = Math.max(0.01, Number(byId<HTMLInputElement>("transform-scale-y-input").value) / 100);
  transformDraft.rotateDeg = Number(byId<HTMLInputElement>("transform-rotate-input").value) || 0;
  transformDraft.skewXDeg = Number(byId<HTMLInputElement>("transform-skew-x-input").value) || 0;
  transformDraft.skewYDeg = Number(byId<HTMLInputElement>("transform-skew-y-input").value) || 0;
}

function getCaptureSelection() {
  const left = Math.min(captureOverlay.dragStartX, captureOverlay.dragCurrentX);
  const top = Math.min(captureOverlay.dragStartY, captureOverlay.dragCurrentY);
  const width = Math.abs(captureOverlay.dragCurrentX - captureOverlay.dragStartX);
  const height = Math.abs(captureOverlay.dragCurrentY - captureOverlay.dragStartY);
  return { left, top, width, height };
}

function getCaptureCanvasMetrics() {
  const canvas = byId<HTMLCanvasElement>("capture-overlay-canvas");
  const bitmap = captureOverlay.imageBitmap;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (!bitmap) {
    return { canvas, rect, dpr, drawX: 0, drawY: 0, drawWidth: rect.width, drawHeight: rect.height, scale: 1 };
  }
  const scale = Math.min(rect.width / bitmap.width, rect.height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const drawX = (rect.width - drawWidth) / 2;
  const drawY = (rect.height - drawHeight) / 2;
  return { canvas, rect, dpr, drawX, drawY, drawWidth, drawHeight, scale };
}

function canvasToBitmapPoint(clientX: number, clientY: number) {
  const { rect, drawX, drawY, drawWidth, drawHeight, scale } = getCaptureCanvasMetrics();
  const localX = Math.max(drawX, Math.min(clientX - rect.left, drawX + drawWidth));
  const localY = Math.max(drawY, Math.min(clientY - rect.top, drawY + drawHeight));
  return {
    x: scale > 0 ? (localX - drawX) / scale : 0,
    y: scale > 0 ? (localY - drawY) / scale : 0,
  };
}

function sampleOverlayColourAt(x: number, y: number) {
  const bitmap = captureOverlay.imageBitmap;
  if (!bitmap) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.drawImage(bitmap, -Math.floor(x), -Math.floor(y));
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function drawCaptureMagnifier() {
  const magnifier = byId<HTMLCanvasElement>("capture-magnifier");
  const ctx = magnifier.getContext("2d");
  const bitmap = captureOverlay.imageBitmap;
  if (!ctx || !bitmap) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, magnifier.width, magnifier.height);
  const sampleSize = 11;
  const half = Math.floor(sampleSize / 2);
  const sx = Math.max(0, Math.min(bitmap.width - sampleSize, Math.round(captureOverlay.hoverX) - half));
  const sy = Math.max(0, Math.min(bitmap.height - sampleSize, Math.round(captureOverlay.hoverY) - half));
  ctx.drawImage(bitmap, sx, sy, sampleSize, sampleSize, 0, 0, magnifier.width, magnifier.height);
  const cell = magnifier.width / sampleSize;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.floor(half * cell) + 0.5, Math.floor(half * cell) + 0.5, Math.ceil(cell), Math.ceil(cell));
}

function drawCaptureOverlayCanvas() {
  const bitmap = captureOverlay.imageBitmap;
  const { canvas, dpr, drawX, drawY, drawWidth, drawHeight, scale } = getCaptureCanvasMetrics();
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "rgba(6, 9, 16, 0.96)";
  ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  if (!bitmap) {
    return;
  }
  ctx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);

  if (captureOverlay.mode === "region") {
    const selection = getCaptureSelection();
    if (selection.width >= 2 && selection.height >= 2) {
      const x = drawX + selection.left * scale;
      const y = drawY + selection.top * scale;
      const width = selection.width * scale;
      const height = selection.height * scale;
      ctx.fillStyle = "rgba(5, 8, 14, 0.52)";
      ctx.fillRect(drawX, drawY, drawWidth, y - drawY);
      ctx.fillRect(drawX, y, x - drawX, height);
      ctx.fillRect(x + width, y, drawX + drawWidth - (x + width), height);
      ctx.fillRect(drawX, y + height, drawWidth, drawY + drawHeight - (y + height));
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x + 0.5, y + 0.5, width, height);
      ctx.setLineDash([]);
    }
  } else {
    const x = drawX + captureOverlay.hoverX * scale;
    const y = drawY + captureOverlay.hoverY * scale;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y + 18);
    ctx.stroke();
  }
}

function renderCaptureOverlay() {
  const overlay = byId<HTMLElement>("capture-overlay");
  const confirmBtn = byId<HTMLButtonElement>("capture-overlay-confirm-btn");
  const hint = byId<HTMLElement>("capture-overlay-hint");
  const title = byId<HTMLElement>("capture-overlay-title");
  const magnifier = byId<HTMLCanvasElement>("capture-magnifier");
  const colourReadout = byId<HTMLElement>("capture-colour-readout");
  const colourChip = byId<HTMLElement>("capture-colour-chip");
  const coords = byId<HTMLElement>("capture-coords");

  overlay.hidden = !captureOverlay.active;
  title.textContent = captureOverlay.mode === "picker" ? "Global Colour Picker" : "Screen Snip";
  hint.textContent = captureOverlay.mode === "picker"
    ? "Move over the screenshot and click to sample a colour."
    : "Drag to select a region, then capture it into a new document.";
  coords.textContent = `${Math.round(captureOverlay.hoverX)}, ${Math.round(captureOverlay.hoverY)}`;

  if (captureOverlay.mode === "region") {
    const selection = getCaptureSelection();
    magnifier.hidden = true;
    colourReadout.hidden = true;
    confirmBtn.hidden = selection.width < 2 || selection.height < 2;
    colourChip.hidden = true;
  } else {
    magnifier.hidden = false;
    colourReadout.hidden = false;
    colourChip.hidden = false;
    colourChip.style.background = captureOverlay.sampledColour;
    colourReadout.textContent = captureOverlay.sampledColour;
    confirmBtn.hidden = true;
    drawCaptureMagnifier();
  }
  drawCaptureOverlayCanvas();
}

async function openCaptureOverlay(mode: CaptureOverlayMode, imageUrl: string) {
  if (captureOverlay.imageUrl && captureOverlay.imageUrl.startsWith("blob:")) {
    URL.revokeObjectURL(captureOverlay.imageUrl);
  }
  const blob = await (await fetch(imageUrl)).blob();
  const imageBitmap = await createImageBitmap(blob);
  captureOverlay = {
    active: true,
    mode,
    imageUrl,
    imageBitmap,
    dragStartX: 0,
    dragStartY: 0,
    dragCurrentX: 0,
    dragCurrentY: 0,
    hoverX: Math.round(imageBitmap.width / 2),
    hoverY: Math.round(imageBitmap.height / 2),
    sampledColour: "#000000",
  };
  captureOverlay.sampledColour = sampleOverlayColourAt(captureOverlay.hoverX, captureOverlay.hoverY) ?? "#000000";
  renderCaptureOverlay();
  applyIcons();
}

async function closeCaptureOverlay() {
  if (captureOverlay.imageUrl && captureOverlay.imageUrl.startsWith("blob:")) {
    URL.revokeObjectURL(captureOverlay.imageUrl);
  }
  captureOverlay = {
    active: false,
    mode: "region",
    imageUrl: "",
    imageBitmap: null,
    dragStartX: 0,
    dragStartY: 0,
    dragCurrentX: 0,
    dragCurrentY: 0,
    hoverX: 0,
    hoverY: 0,
    sampledColour: "#000000",
  };
  renderCaptureOverlay();
}

async function beginRegionSnip() {
  const bytes = await invoke<number[]>("capture_primary_monitor_png");
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  await openCaptureOverlay("region", url);
}

async function beginGlobalColourPick() {
  const bytes = await invoke<number[]>("capture_primary_monitor_png");
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  await openCaptureOverlay("picker", url);
}

async function captureWindowById(id: number) {
  const bytes = await invoke<number[]>("capture_window_png", { id });
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  await openDocumentFromBlob(`Window ${id}.png`, blob, null);
}

async function chooseWindowCapture() {
  const windows = await invoke<CaptureWindowEntry[]>("list_capture_windows");
  if (!windows.length) {
    showToast("No capturable windows found", "error");
    return;
  }
  const backdrop = byId<HTMLElement>("capture-window-modal");
  const select = byId<HTMLSelectElement>("capture-window-select");
  const submitBtn = byId<HTMLButtonElement>("capture-window-submit-btn");
  select.innerHTML = windows.map((window) => `<option value="${window.id}">${window.title}</option>`).join("");

  let settled = false;
  const onSubmit = async () => {
    const id = Number(select.value);
    closeModal({ backdrop });
    finish();
    await captureWindowById(id);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    submitBtn.removeEventListener("click", onSubmit);
  };
  submitBtn.addEventListener("click", onSubmit);
  openModal({
    backdrop,
    acceptBtnSelector: ".modal-never",
    onReject: finish,
  });
}

async function captureFullscreen() {
  const bytes = await invoke<number[]>("capture_primary_monitor_png");
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  await openDocumentFromBlob(`Screen ${Date.now()}.png`, blob, null);
}

function bindCaptureTools() {
  byId<HTMLButtonElement>("capture-region-btn").addEventListener("click", () => {
    void beginRegionSnip();
  });
  byId<HTMLButtonElement>("capture-window-btn").addEventListener("click", async () => {
    await chooseWindowCapture();
  });
  byId<HTMLButtonElement>("capture-fullscreen-btn").addEventListener("click", () => {
    void captureFullscreen();
  });
  byId<HTMLButtonElement>("global-picker-btn").addEventListener("click", () => {
    void beginGlobalColourPick();
  });
}

function bindCaptureOverlay() {
  const stage = byId<HTMLElement>("capture-overlay-stage");
  const coords = byId<HTMLElement>("capture-coords");

  let dragging = false;

  stage.addEventListener("pointerdown", (event) => {
    if (!captureOverlay.active) return;
    const point = canvasToBitmapPoint(event.clientX, event.clientY);
    captureOverlay.dragStartX = point.x;
    captureOverlay.dragStartY = point.y;
    captureOverlay.dragCurrentX = point.x;
    captureOverlay.dragCurrentY = point.y;
    captureOverlay.hoverX = point.x;
    captureOverlay.hoverY = point.y;
    captureOverlay.sampledColour = sampleOverlayColourAt(point.x, point.y) ?? captureOverlay.sampledColour;
    dragging = captureOverlay.mode === "region";
    stage.setPointerCapture(event.pointerId);
    renderCaptureOverlay();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!captureOverlay.active) return;
    const point = canvasToBitmapPoint(event.clientX, event.clientY);
    if (dragging) {
      captureOverlay.dragCurrentX = point.x;
      captureOverlay.dragCurrentY = point.y;
    }
    captureOverlay.hoverX = point.x;
    captureOverlay.hoverY = point.y;
    coords.textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`;
    const colour = sampleOverlayColourAt(point.x, point.y);
    if (colour) {
      captureOverlay.sampledColour = colour;
    }
    if (dragging || captureOverlay.mode === "picker") {
      renderCaptureOverlay();
    }
  });
  stage.addEventListener("pointerup", () => {
    dragging = false;
    if (captureOverlay.active) renderCaptureOverlay();
  });
  stage.addEventListener("pointercancel", () => {
    dragging = false;
  });

  window.addEventListener("keydown", (event) => {
    if (!captureOverlay.active) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void closeCaptureOverlay();
    }
  });

  const cancelButton = byId<HTMLButtonElement>("capture-overlay-cancel-btn");
  cancelButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  cancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void closeCaptureOverlay();
  });
  byId<HTMLButtonElement>("capture-overlay-confirm-btn").addEventListener("click", async () => {
    if (!captureOverlay.imageBitmap) return;
    const selection = getCaptureSelection();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(selection.width));
    canvas.height = Math.max(1, Math.round(selection.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(captureOverlay.imageBitmap, selection.left, selection.top, selection.width, selection.height, 0, 0, selection.width, selection.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      await openDocumentFromBlob(`Snip ${Date.now()}.png`, blob, null);
    }
    await closeCaptureOverlay();
  });
  stage.addEventListener("click", async (event) => {
    if (!captureOverlay.active || captureOverlay.mode !== "picker") return;
    const point = canvasToBitmapPoint(event.clientX, event.clientY);
    const colour = sampleOverlayColourAt(point.x, point.y);
    if (!colour) return;
    activeColour = colour;
    updateBrushUI();
    showToast(`Sampled ${colour}`);
    await closeCaptureOverlay();
  });
}

async function setupGlobalShortcuts() {
  await unregisterAll();
  await register("CommandOrControl+Shift+4", async (event) => {
    if (event.state === "Pressed") {
      await beginRegionSnip();
    }
  });
  await register("CommandOrControl+Shift+C", async (event) => {
    if (event.state === "Pressed") {
      await beginGlobalColourPick();
    }
  });
}

function syncMarqueeModeOverride(ctrlKey: boolean, shiftKey: boolean, altKey: boolean) {
  const nextOverride = altKey ? "intersect" : shiftKey ? "subtract" : ctrlKey ? "add" : null;
  if (marqueeModeOverride === nextOverride) {
    return;
  }
  marqueeModeOverride = nextOverride;
  renderToolState();
}
let pointerState: PointerState = {
  mode: "none",
  lastDocX: 0,
  lastDocY: 0,
  startDocX: 0,
  startDocY: 0,
  startClientX: 0,
  startClientY: 0,
  startLayerX: 0,
  startLayerY: 0,
  startPanX: 0,
  startPanY: 0,
  startSelectionRect: null,
  startSelectionInverted: false,
  transformHandle: null,
  startLayerWidth: 0,
  startLayerHeight: 0,
  startScaleX: 1,
  startScaleY: 1,
  startRotateDeg: 0,
  startSkewXDeg: 0,
  startSkewYDeg: 0,
};

let topTabs: { activate: (tabId: string) => void } | null = null;

function setNavOptionDisabled(id: string, disabled: boolean) {
  const option = byId<HTMLButtonElement>(id);
  option.disabled = disabled;
  option.classList.toggle("nav-option--disabled", disabled);
}

function setNavOptionLabel(id: string, label: string) {
  byId<HTMLElement>(id).textContent = label;
}

function setNavOptionIcon(id: string, icon: string) {
  const iconEl = byId<HTMLElement>(id).querySelector("[data-lucide]");
  if (iconEl) {
    iconEl.setAttribute("data-lucide", icon);
  }
}

function trimRecent(items: string[], nextPath: string) {
  return [nextPath, ...items.filter((item) => item !== nextPath)].slice(0, 8);
}

async function toggleCanvasSetting(key: "showCheckerboard" | "showGrid" | "snapEnabled", enabledLabel: string, disabledLabel: string) {
  const nextValue = !settings[key];
  await persistSettings({ ...settings, [key]: nextValue });
  showToast(nextValue ? enabledLabel : disabledLabel, "info");
}

const SNAP_THRESHOLD = 6;

function snapLayerPosition(layer: RasterLayer, rawX: number, rawY: number): { x: number; y: number } {
  const doc = getActiveDocument();
  if (!doc || !settings.snapEnabled) {
    activeSnapLines = [];
    return { x: rawX, y: rawY };
  }

  const layerW = layer.canvas.width;
  const layerH = layer.canvas.height;
  const snapTargetsX: number[] = [0, doc.width];
  const snapTargetsY: number[] = [0, doc.height];
  for (const guide of doc.guides) {
    if (guide.orientation === "vertical") snapTargetsX.push(guide.position);
    else snapTargetsY.push(guide.position);
  }
  if (settings.showGrid && settings.gridSize > 0) {
    const gs = settings.gridSize;
    const edgesX = [rawX, rawX + layerW / 2, rawX + layerW];
    const edgesY = [rawY, rawY + layerH / 2, rawY + layerH];
    for (const edge of edgesX) {
      const nearest = Math.round(edge / gs) * gs;
      snapTargetsX.push(nearest);
      if (nearest - gs >= 0) snapTargetsX.push(nearest - gs);
      if (nearest + gs <= doc.width) snapTargetsX.push(nearest + gs);
    }
    for (const edge of edgesY) {
      const nearest = Math.round(edge / gs) * gs;
      snapTargetsY.push(nearest);
      if (nearest - gs >= 0) snapTargetsY.push(nearest - gs);
      if (nearest + gs <= doc.height) snapTargetsY.push(nearest + gs);
    }
  }

  let bestX = rawX;
  let bestDx = Infinity;
  const lines: Array<{ orientation: "horizontal" | "vertical"; position: number }> = [];
  const edgesX = [rawX, rawX + layerW / 2, rawX + layerW];
  for (const target of snapTargetsX) {
    for (const edge of edgesX) {
      const d = Math.abs(edge - target);
      if (d < SNAP_THRESHOLD && d < bestDx) {
        bestDx = d;
        bestX = rawX + (target - edge);
      }
    }
  }
  if (bestDx < SNAP_THRESHOLD) {
    for (const target of snapTargetsX) {
      for (const edge of [bestX, bestX + layerW / 2, bestX + layerW]) {
        if (Math.abs(edge - target) < 1) {
          lines.push({ orientation: "vertical", position: target });
        }
      }
    }
  }

  let bestY = rawY;
  let bestDy = Infinity;
  const edgesY = [rawY, rawY + layerH / 2, rawY + layerH];
  for (const target of snapTargetsY) {
    for (const edge of edgesY) {
      const d = Math.abs(edge - target);
      if (d < SNAP_THRESHOLD && d < bestDy) {
        bestDy = d;
        bestY = rawY + (target - edge);
      }
    }
  }
  if (bestDy < SNAP_THRESHOLD) {
    for (const target of snapTargetsY) {
      for (const edge of [bestY, bestY + layerH / 2, bestY + layerH]) {
        if (Math.abs(edge - target) < 1) {
          lines.push({ orientation: "horizontal", position: target });
        }
      }
    }
  }

  activeSnapLines = lines;
  return { x: bestX, y: bestY };
}

const dom = createAppDom();
const { editorCanvas, canvasStage, canvasWrap, fileOpenInput } = dom;
const io = createIoController();
const canvasPointer = createCanvasPointerController({
  editorCanvas,
  canvasWrap,
  getActiveDocument,
  getActiveLayer,
  getActiveTool: () => settings.activeTool,
  getBrushState: () => ({ brushSize, brushOpacity, activeColour }),
  getSelectionMode: () => getEffectiveMarqueeMode(),
  getTransformMode: () => transformMode,
  ensureTransformDraft,
  getTransformDraft: () => transformDraft,
  syncTransformInputs,
  getSpacePressed: () => spacePressed,
  snapLayerPosition,
  pointerState,
  renderCanvas,
  renderEditorState,
  onColourPicked: (colour) => {
    activeColour = colour;
    updateBrushUI();
    showToast(`Sampled ${colour}`);
  },
  log: debugLog,
});

function getEditorContext(): CanvasRenderingContext2D {
  const ctx = editorCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable for editor canvas");
  }
  return ctx;
}

function emitWorkspaceEvent(name: string, detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(`vision-goblin:${name}`, { detail }));
}

function showToast(message: string, variant: "success" | "error" | "info" = "success") {
  showGoblinToast(message, variant, 2200, "app-toast");
}

function renderDebugLoggingUI() {
  byId<HTMLInputElement>("debug-logging-checkbox").checked = settings.debugLoggingEnabled;
  byId<HTMLElement>("debug-log-path").textContent = settings.debugLoggingEnabled
    ? `Debug logs: ${getDebugLogPath()}`
    : "Debug logs are disabled.";
}

function getActiveDocument(): DocumentState | null {
  return documents.find((doc) => doc.id === activeDocumentId) ?? null;
}

function getActiveLayer(doc: DocumentState): RasterLayer | null {
  return doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? doc.layers[0] ?? null;
}

function setActiveDocument(doc: DocumentState) {
  if (!documents.some((item) => item.id === doc.id)) {
    documents.push(doc);
    debugLog(`Registered document '${doc.name}' (${doc.id})`, "INFO");
  }
  activeDocumentId = doc.id;
  debugLog(`Active document set to '${doc.name}' (${doc.id})`, "INFO");
}

function resetDocumentsToStarters() {
  documents.splice(0, documents.length, ...buildStarterDocuments(settings.defaultZoom));
  activeDocumentId = documents[0]?.id ?? "";
  debugLog(`Loaded ${documents.length} starter documents`, "INFO");
}

function renderCanvas() {
  const doc = getActiveDocument();
  const transformPreview = transformDraft ? { layerId: transformDraft.layerId, ...buildTransformPreview(transformDraft) } : null;
  renderCanvasView({
    editorCanvas,
    getEditorContext,
    doc,
    activeTool: settings.activeTool,
    activeLayer: doc ? getActiveLayer(doc) : null,
    marqueePreview: pointerState.mode === "marquee"
      ? { baseRect: pointerState.startSelectionRect, previewRect: doc?.selectionRect ?? null, mode: getEffectiveMarqueeMode() }
      : null,
    transformPreview,
    pivotPoint: transformDraft ? { x: transformDraft.pivotX, y: transformDraft.pivotY } : null,
    guides: doc?.guides ?? [],
    snapLines: activeSnapLines,
    showRulers: settings.snapEnabled,
    showGrid: settings.showGrid,
    gridSize: settings.gridSize,
  });
}

function renderTabs(activeTab: AppTab) {
  topTabs?.activate(activeTab);
}

function renderDocumentTabs() {
  renderDocumentTabsView({
    tabs: byId<HTMLElement>("document-tabs"),
    documents,
    activeDocumentId,
    onActivate: (documentId) => {
      activeDocumentId = documentId;
      renderEditorState();
      emitWorkspaceEvent("document-activated", { documentId });
    },
    onClose: (documentId) => {
      void closeDocument(documentId);
    },
  });
  applyIcons();
}

function renderRecentMenuList(containerId: string, items: string[], navPrefix: string) {
  const container = byId<HTMLElement>(containerId);
  container.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "nav-option nav-option--disabled recent-menu-empty";
    empty.textContent = "Nothing yet";
    container.appendChild(empty);
    return;
  }

  items.forEach((path, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-option recent-menu-item";
    button.dataset.navId = `${navPrefix}:${index}`;
    button.innerHTML = `<span class="nav-option-label">${io.fileNameFromPath(path)}</span>`;
    button.title = path;
    container.appendChild(button);
  });
}

function renderRecentMenus() {
  renderRecentMenuList("recent-projects-nav", settings.recentProjects, "recent-project");
  renderRecentMenuList("recent-images-nav", settings.recentImages, "recent-image");
  applyIcons();
}

async function rememberRecentImage(path: string) {
  await persistSettings({ ...settings, recentImages: trimRecent(settings.recentImages, path) });
}

async function rememberRecentProject(path: string) {
  await persistSettings({ ...settings, recentProjects: trimRecent(settings.recentProjects, path) });
}

async function removeRecent(path: string, kind: "image" | "project") {
  if (kind === "image") {
    await persistSettings({ ...settings, recentImages: settings.recentImages.filter((item) => item !== path) });
    return;
  }
  await persistSettings({ ...settings, recentProjects: settings.recentProjects.filter((item) => item !== path) });
}

function moveLayer(doc: DocumentState, layerId: string, direction: -1 | 1) {
  if (moveLayerAction(doc, layerId, direction)) {
    debugLog(`Moved layer '${layerId}' ${direction > 0 ? "up" : "down"}`, "INFO");
    renderEditorState();
  } else {
    debugLog(`Failed to move layer '${layerId}'`, "WARN");
  }
}

function duplicateLayer(doc: DocumentState, layerId: string) {
  if (duplicateLayerAction(doc, layerId)) {
    renderEditorState();
  }
}

function requestNewDocumentValues(): Promise<{ name: string; width: number; height: number; background: DocumentState["background"] } | null> {
  return new Promise((resolve) => {
    const backdrop = byId<HTMLElement>("new-document-modal");
    const presetSelect = byId<HTMLSelectElement>("new-document-preset-select");
    const nameInput = byId<HTMLInputElement>("new-document-name-input");
    const widthInput = byId<HTMLInputElement>("new-document-width-input");
    const heightInput = byId<HTMLInputElement>("new-document-height-input");
    const backgroundSelect = byId<HTMLSelectElement>("new-document-background-select");
    const submitBtn = byId<HTMLButtonElement>("new-document-submit-btn");

    presetSelect.value = "custom";
    nameInput.value = `Untitled ${documents.length + 1}`;
    widthInput.value = "1600";
    heightInput.value = "1200";
    backgroundSelect.value = "white";

    let settled = false;
    const inputNodes = [nameInput, widthInput, heightInput, presetSelect, backgroundSelect];
    const applyPreset = () => {
      if (presetSelect.value === "custom") {
        return;
      }
      const [width, height] = presetSelect.value.split("x").map(Number);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        widthInput.value = String(width);
        heightInput.value = String(height);
      }
    };
    const onKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        onSubmit();
      }
    };
    const cleanup = () => {
      submitBtn.removeEventListener("click", onSubmit);
      presetSelect.removeEventListener("change", applyPreset);
      inputNodes.forEach((input) => input.removeEventListener("keydown", onKeyDown));
    };
    const finish = (result: { name: string; width: number; height: number; background: DocumentState["background"] } | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onSubmit = () => {
      const name = nameInput.value.trim() || `Untitled ${documents.length + 1}`;
      const width = Math.round(Number(widthInput.value));
      const height = Math.round(Number(heightInput.value));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        showToast("Enter valid canvas dimensions", "error");
        widthInput.focus();
        return;
      }
      closeModal({ backdrop });
      finish({ name, width, height, background: backgroundSelect.value as DocumentState["background"] });
    };

    submitBtn.addEventListener("click", onSubmit);
    presetSelect.addEventListener("change", applyPreset);
    inputNodes.forEach((input) => input.addEventListener("keydown", onKeyDown));
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(null),
    });
    requestAnimationFrame(() => nameInput.focus());
  });
}

function requestLayerName(currentName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = byId<HTMLElement>("rename-layer-modal");
    const input = byId<HTMLInputElement>("rename-layer-input");
    const submitBtn = byId<HTMLButtonElement>("rename-layer-submit-btn");

    input.value = currentName;

    let settled = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
    };
    const cleanup = () => {
      submitBtn.removeEventListener("click", onSubmit);
      input.removeEventListener("keydown", onKeyDown);
    };
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onSubmit = () => {
      const nextName = input.value.trim();
      if (!nextName) {
        showToast("Layer name cannot be empty", "error");
        input.focus();
        return;
      }
      closeModal({ backdrop });
      finish(nextName);
    };

    submitBtn.addEventListener("click", onSubmit);
    input.addEventListener("keydown", onKeyDown);
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(null),
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

function requestCanvasName(currentName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = byId<HTMLElement>("rename-canvas-modal");
    const input = byId<HTMLInputElement>("rename-canvas-input");
    const submitBtn = byId<HTMLButtonElement>("rename-canvas-submit-btn");

    input.value = currentName;

    let settled = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
    };
    const cleanup = () => {
      submitBtn.removeEventListener("click", onSubmit);
      input.removeEventListener("keydown", onKeyDown);
    };
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onSubmit = () => {
      const nextName = input.value.trim();
      if (!nextName) {
        showToast("Canvas name cannot be empty", "error");
        input.focus();
        return;
      }
      closeModal({ backdrop });
      finish(nextName);
    };

    submitBtn.addEventListener("click", onSubmit);
    input.addEventListener("keydown", onKeyDown);
    openModal({
      backdrop,
      acceptBtnSelector: ".modal-never",
      onReject: () => finish(null),
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

async function renameCanvas() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No canvas to rename", "error");
    return;
  }

  const nextName = await requestCanvasName(doc.name);
  if (!nextName || nextName === doc.name) {
    return;
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  doc.name = nextName;
  doc.dirty = true;
  pushHistory(doc, `Renamed canvas to ${nextName}`);
  debugLog(`Renamed canvas '${doc.id}' to '${nextName}'`, "INFO");
  renderEditorState();
  showToast(`Renamed canvas to ${nextName}`);
}

async function toggleWindowPanel(panel: "left" | "right") {
  const nextSettings = panel === "left"
    ? { ...settings, leftPanelCollapsed: !settings.leftPanelCollapsed }
    : { ...settings, rightPanelCollapsed: !settings.rightPanelCollapsed };
  await persistSettings(nextSettings);
}

async function renameLayer(doc: DocumentState, layerId: string) {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) return;
  const nextName = await requestLayerName(layer.name);
  if (!nextName) return;
  if (renameLayerAction(doc, layerId, nextName)) {
    debugLog(`Renamed layer '${layerId}' to '${nextName}'`, "INFO");
    showToast(`Renamed layer to ${nextName}`);
    renderEditorState();
  } else {
    debugLog(`Failed to rename layer '${layerId}'`, "WARN");
  }
}

async function deleteLayer(doc: DocumentState, layerId: string) {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) {
    return;
  }
  if (layer.isBackground || doc.layers.length <= 1) {
    debugLog(`Failed to delete layer '${layerId}' (protected)`, "WARN");
    showToast("Background layer cannot be deleted", "error");
    return;
  }
  const confirmed = await confirmModal({
    title: `Delete ${layer.name}?`,
    message: "This permanently removes the layer from the current document.",
    acceptLabel: "Delete layer",
    rejectLabel: "Cancel",
    variant: "danger",
  });
  if (!confirmed) {
    return;
  }
  const result = deleteLayerAction(doc, layerId);
  if (!result.ok) {
    debugLog(`Failed to delete layer '${layerId}' (${result.reason ?? "unknown"})`, "WARN");
    showToast("Could not delete layer", "error");
    return;
  }
  renderEditorState();
  debugLog(`Deleted layer '${layerId}' (${result.deletedName})`, "INFO");
  showToast(`Deleted ${result.deletedName}`);
}

function renderLayers(doc: DocumentState) {
  const layerList = byId<HTMLElement>("layer-list");
  renderLayerList(layerList, doc, {
    onSelect: (layerId) => {
      const activeDoc = documents.find((item) => item.id === activeDocumentId) ?? doc;
      if (selectLayer(activeDoc, layerId)) {
        debugLog(`Selected layer '${layerId}'`, "INFO");
        renderEditorState();
      } else {
        debugLog(`Failed to select layer '${layerId}'`, "WARN");
      }
    },
    onToggleVisibility: (layerId) => {
      const activeDoc = documents.find((item) => item.id === activeDocumentId) ?? doc;
      if (toggleLayerVisibility(activeDoc, layerId)) {
        debugLog(`Toggled visibility for layer '${layerId}'`, "INFO");
        renderEditorState();
      } else {
        debugLog(`Failed to toggle visibility for layer '${layerId}'`, "WARN");
      }
    },
    onMoveUp: (layerId) => {
      moveLayer(documents.find((item) => item.id === activeDocumentId) ?? doc, layerId, 1);
    },
    onMoveDown: (layerId) => {
      moveLayer(documents.find((item) => item.id === activeDocumentId) ?? doc, layerId, -1);
    },
    onToggleLock: (layerId) => {
      const activeDoc = documents.find((item) => item.id === activeDocumentId) ?? doc;
      if (toggleLayerLock(activeDoc, layerId)) {
        debugLog(`Toggled lock for layer '${layerId}'`, "INFO");
        renderEditorState();
      } else {
        debugLog(`Failed to toggle lock for layer '${layerId}'`, "WARN");
      }
    },
    onRename: (layerId) => {
      void renameLayer(documents.find((item) => item.id === activeDocumentId) ?? doc, layerId);
    },
    onDuplicate: (layerId) => {
      duplicateLayer(documents.find((item) => item.id === activeDocumentId) ?? doc, layerId);
    },
    onDelete: (layerId) => {
      void deleteLayer(documents.find((item) => item.id === activeDocumentId) ?? doc, layerId);
    },
    onDebug: (message) => {
      debugLog(message, "INFO");
    },
  });
  applyIcons();
}

function renderHistory(doc: DocumentState) {
  renderHistoryView(byId<HTMLElement>("history-list"), doc);
}

function updateBrushUI() {
  updateBrushUIView({
    brushSize,
    brushOpacity,
    activeColour,
    brushSizeInput: byId<HTMLInputElement>("brush-size-range"),
    brushOpacityInput: byId<HTMLInputElement>("brush-opacity-range"),
    brushColourPreview: byId<HTMLElement>("brush-colour-preview"),
    brushColourValue: byId<HTMLElement>("brush-colour-value"),
    colourPreview: byId<HTMLElement>("colour-preview"),
    colourValue: byId<HTMLElement>("colour-value"),
  });
}

function renderToolState() {
  renderToolStateView({
    activeTool: settings.activeTool,
    toolCopy: TOOL_COPY,
    canvasWrap,
    activeToolCopy: byId<HTMLElement>("active-tool-copy"),
    brushSizeField: byId<HTMLElement>("brush-size-field"),
    brushOpacityField: byId<HTMLElement>("brush-opacity-field"),
    brushColourField: byId<HTMLElement>("brush-colour-field"),
    cropToolHint: byId<HTMLElement>("crop-tool-hint"),
    marqueeToolHint: byId<HTMLElement>("marquee-tool-hint"),
    marqueeModeField: byId<HTMLElement>("marquee-mode-field"),
    transformToolHint: byId<HTMLElement>("transform-tool-hint"),
    transformModeField: byId<HTMLElement>("transform-mode-field"),
    transformControlsField: byId<HTMLElement>("transform-controls-field"),
    toolSettingsEmpty: byId<HTMLElement>("tool-settings-empty"),
  });
  document.querySelectorAll<HTMLElement>("[data-selection-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-selection-mode") === getEffectiveMarqueeMode());
  });
  document.querySelectorAll<HTMLElement>("[data-transform-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-transform-mode") === transformMode);
  });
}

function clearSelection(showMessage = false) {
  const doc = getActiveDocument();
  if (!doc?.selectionRect) {
    return;
  }
  doc.selectionRect = null;
  doc.selectionInverted = false;
  debugLog(`Cleared selection for '${doc.name}'`, "INFO");
  renderEditorState();
  if (showMessage) {
    showToast("Selection cleared", "info");
  }
}

function deleteSelectedArea() {
  const doc = getActiveDocument();
  if (!doc?.selectionRect) {
    return;
  }
  const layer = getActiveLayer(doc);
  if (!layer || layer.locked || layer.isBackground) {
    showToast("Select an editable layer to clear the selection", "error");
    return;
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const ctx = getLayerContext(layer);
  ctx.save();
  if (doc.selectionInverted) {
    ctx.beginPath();
    ctx.rect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.rect(doc.selectionRect.x - layer.x, doc.selectionRect.y - layer.y, doc.selectionRect.width, doc.selectionRect.height);
    ctx.clip("evenodd");
  } else {
    ctx.beginPath();
    ctx.rect(doc.selectionRect.x - layer.x, doc.selectionRect.y - layer.y, doc.selectionRect.width, doc.selectionRect.height);
    ctx.clip();
  }
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.restore();
  syncLayerSource(layer);
  pushHistory(doc, "Cleared selected area");
  debugLog(`Cleared selected area on layer '${layer.name}'`, "INFO");
  renderEditorState();
  showToast("Selection cleared from layer", "success");
}

function selectEntireCanvas() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to select", "error");
    return;
  }
  doc.selectionRect = { x: 0, y: 0, width: doc.width, height: doc.height };
  doc.selectionInverted = false;
  debugLog(`Selected entire canvas for '${doc.name}'`, "INFO");
  renderEditorState();
  showToast("Selected full canvas", "info");
}

function invertSelection() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to invert", "error");
    return;
  }
  if (!doc.selectionRect) {
    doc.selectionRect = { x: 0, y: 0, width: doc.width, height: doc.height };
    doc.selectionInverted = true;
  } else {
    doc.selectionInverted = !doc.selectionInverted;
  }
  debugLog(`Inverted selection for '${doc.name}'`, "INFO");
  renderEditorState();
  showToast(doc.selectionInverted ? "Selection inverted" : "Selection normalized", "info");
}

function setMarqueeMode(nextMode: SelectionMode) {
  marqueeMode = nextMode;
  renderToolState();
  showToast(`Selection mode: ${nextMode}`, "info");
}

function updateMarqueeModeFromModifiers(ctrlKey: boolean, shiftKey: boolean, altKey: boolean) {
  const nextOverride = altKey ? "intersect" : shiftKey ? "subtract" : ctrlKey ? "add" : null;
  if (marqueeModeOverride === nextOverride) {
    return;
  }
  marqueeModeOverride = nextOverride;
  renderToolState();
}

function setTransformMode(nextMode: TransformMode) {
  transformMode = nextMode;
  renderToolState();
  showToast(`Transform mode: ${nextMode}`, "info");
}

function bindTransformControls() {
  const inputIds = [
    "transform-scale-x-input",
    "transform-scale-y-input",
    "transform-rotate-input",
    "transform-skew-x-input",
    "transform-skew-y-input",
  ] as const;

  inputIds.forEach((id) => {
    byId<HTMLInputElement>(id).addEventListener("input", () => {
      const draft = ensureTransformDraftForActiveLayer();
      if (!draft) {
        return;
      }
      updateTransformDraftInputs();
      renderEditorState();
    });
  });

  byId<HTMLButtonElement>("transform-apply-btn").addEventListener("click", () => {
    commitTransformDraft();
  });
  byId<HTMLButtonElement>("transform-cancel-btn").addEventListener("click", () => {
    cancelTransformDraft();
  });
}

function applyCanvasPreferences() {
  const workspace = document.querySelector(".editor-workspace") as HTMLElement;
  workspace.style.setProperty("--left-panel-width", `${settings.leftPanelWidth}px`);
  workspace.style.setProperty("--right-panel-width", `${settings.rightPanelWidth}px`);
  workspace.classList.toggle("left-collapsed", settings.leftPanelCollapsed);
  workspace.classList.toggle("right-collapsed", settings.rightPanelCollapsed);

  canvasStage.classList.toggle("checkerboard-on", settings.showCheckerboard);
  const doc = getActiveDocument();
  byId<HTMLElement>("status-right").textContent = `${settings.colourFormat.toUpperCase()} - Snap ${settings.snapEnabled ? "on" : "off"} - Grid ${settings.showGrid ? `${settings.gridSize}px` : "off"}${doc?.selectionRect ? " - Selection on" : ""}`;
  setNavOptionLabel("toggle-tools-nav-label", settings.leftPanelCollapsed ? "Show tools" : "Hide tools");
  setNavOptionLabel("toggle-inspector-nav-label", settings.rightPanelCollapsed ? "Show inspector" : "Hide inspector");
  setNavOptionIcon("toggle-tools-nav", settings.leftPanelCollapsed ? "panel-left-open" : "panel-left-close");
  setNavOptionIcon("toggle-inspector-nav", settings.rightPanelCollapsed ? "panel-right-open" : "panel-right-close");
}

function renderInspector(doc: DocumentState) {
  renderInspectorView({
    doc,
    activeLayer: getActiveLayer(doc),
    backgroundColourInput: byId<HTMLInputElement>("background-colour-input"),
    inspectorMode: byId<HTMLElement>("inspector-mode"),
    inspectorSelection: byId<HTMLElement>("inspector-selection"),
    inspectorBlend: byId<HTMLElement>("inspector-blend"),
    inspectorOpacity: byId<HTMLElement>("inspector-opacity"),
    inspectorPosition: byId<HTMLElement>("inspector-position"),
    inspectorLayer: byId<HTMLElement>("inspector-layer"),
  });
}

function renderEditorState() {
  const emptyState = byId<HTMLElement>("empty-state");
  const undoBtn = byId<HTMLButtonElement>("undo-btn");
  const redoBtn = byId<HTMLButtonElement>("redo-btn");
  setNavOptionLabel("checkerboard-nav-label", settings.showCheckerboard ? "Hide checkerboard" : "Show checkerboard");
  setNavOptionLabel("grid-nav-label", settings.showGrid ? "Hide pixel grid" : "Show pixel grid");
  setNavOptionLabel("snap-nav-label", settings.snapEnabled ? "Disable snap" : "Enable snap");
  if (documents.length === 0) {
    renderDocumentTabs();
    emptyState.hidden = false;
    canvasStage.hidden = true;
    byId<HTMLElement>("active-doc-meta").textContent = "No canvas open";
    byId<HTMLElement>("zoom-readout").textContent = `${settings.defaultZoom}%`;
    byId<HTMLElement>("layer-list").innerHTML = "";
    byId<HTMLElement>("history-list").innerHTML = "";
    setNavOptionLabel("save-project-nav-label", "Save project");
    setNavOptionDisabled("duplicate-document-nav", true);
    setNavOptionDisabled("save-project-nav", true);
    setNavOptionDisabled("save-project-as-nav", true);
    setNavOptionDisabled("export-image-nav", true);
    setNavOptionDisabled("rename-canvas-nav", true);
    setNavOptionDisabled("resize-canvas-nav", true);
    setNavOptionDisabled("reset-view-nav", true);
    setNavOptionDisabled("select-all-nav", true);
    setNavOptionDisabled("deselect-nav", true);
    setNavOptionDisabled("invert-selection-nav", true);
    undoBtn.disabled = true;
    redoBtn.disabled = true;
    renderToolState();
    updateBrushUI();
    applyCanvasPreferences();
    renderDebugLoggingUI();
    renderRecentMenus();
    applyIcons();
    return;
  }

  emptyState.hidden = true;
  canvasStage.hidden = false;
  const doc = getActiveDocument();
  if (!doc) {
    return;
  }
  const activeTransformDraft = transformDraft;
  if (activeTransformDraft && !doc.layers.some((layer) => layer.id === activeTransformDraft.layerId)) {
    transformDraft = null;
  }
  syncTransformInputs();

  renderDocumentTabs();
  renderToolState();
  renderLayers(doc);
  renderHistory(doc);
  renderInspector(doc);
  updateBrushUI();
  applyCanvasPreferences();
  renderCanvas();

  byId<HTMLElement>("active-doc-meta").textContent = `${doc.width} x ${doc.height} px - ${doc.layers.length} layers${doc.selectionRect ? ` - ${doc.selectionInverted ? "inverted " : ""}selection ${doc.selectionRect.width}x${doc.selectionRect.height}` : ""}${doc.dirty ? " - unsaved" : ""}`;
  byId<HTMLElement>("zoom-readout").textContent = `${doc.zoom}%`;
  setNavOptionDisabled("duplicate-document-nav", false);
  setNavOptionLabel("save-project-nav-label", doc.projectPath ? "Save project" : "Save project as");
  setNavOptionDisabled("save-project-nav", false);
  setNavOptionDisabled("save-project-as-nav", false);
  setNavOptionDisabled("export-image-nav", false);
  setNavOptionDisabled("rename-canvas-nav", false);
  setNavOptionDisabled("resize-canvas-nav", false);
  setNavOptionDisabled("reset-view-nav", false);
  setNavOptionDisabled("select-all-nav", false);
  setNavOptionDisabled("deselect-nav", !doc.selectionRect);
  setNavOptionDisabled("invert-selection-nav", false);
  undoBtn.disabled = doc.undoStack.length === 0;
  redoBtn.disabled = doc.redoStack.length === 0;
  renderDebugLoggingUI();
  renderRecentMenus();
  byId<HTMLElement>("canvas-floating-chip").textContent = settings.activeTool === "move"
    ? "Drag active layer. Right drag or Space+drag pans the viewport."
    : settings.activeTool === "marquee"
      ? "Drag to create a selection. Escape clears it."
    : settings.activeTool === "transform"
      ? "Drag a corner handle to scale the active layer."
    : settings.activeTool === "brush"
      ? "Paint on the active layer. Adjust size and opacity in the tools column."
      : settings.activeTool === "eraser"
        ? "Erase pixels from the active layer."
        : settings.activeTool === "eyedropper"
          ? "Click the canvas to sample a colour."
          : "Wheel to zoom. Right drag or Space+drag to pan.";
  applyIcons();
}

function resetCanvasView() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to reset", "error");
    return;
  }
  doc.zoom = settings.defaultZoom;
  doc.panX = 0;
  doc.panY = 0;
  debugLog(`View reset for '${doc.name}'`, "INFO");
  renderEditorState();
}

function resizeActiveCanvas() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to resize", "error");
    return;
  }

  const nextWidth = Math.max(1, Number(byId<HTMLInputElement>("canvas-width-input").value));
  const nextHeight = Math.max(1, Number(byId<HTMLInputElement>("canvas-height-input").value));
  const anchor = byId<HTMLSelectElement>("canvas-resize-anchor").value as ResizeAnchor;
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    showToast("Enter valid canvas dimensions", "error");
    return;
  }
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const offset = getResizeOffset(anchor, doc.width, doc.height, Math.round(nextWidth), Math.round(nextHeight));
  resizeCanvasDocument(doc, Math.round(nextWidth), Math.round(nextHeight), offset);
  pushHistory(doc, `Resized canvas to ${Math.round(nextWidth)}x${Math.round(nextHeight)} from ${anchor}`);
  debugLog(`Resized canvas for '${doc.name}' to ${Math.round(nextWidth)}x${Math.round(nextHeight)} from ${anchor}`, "INFO");
  renderEditorState();
}

function openResizeCanvasModal() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to resize", "error");
    return;
  }

  const backdrop = byId<HTMLElement>("resize-canvas-modal");
  const widthInput = byId<HTMLInputElement>("canvas-width-input");
  const heightInput = byId<HTMLInputElement>("canvas-height-input");
  const anchorInput = byId<HTMLSelectElement>("canvas-resize-anchor");
  const submitBtn = byId<HTMLButtonElement>("resize-canvas-submit-btn");

  widthInput.value = String(doc.width);
  heightInput.value = String(doc.height);
  anchorInput.value = "center";

  let settled = false;
  const onSubmit = () => {
    closeModal({ backdrop });
    resizeActiveCanvas();
    finish();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };
  const cleanup = () => {
    submitBtn.removeEventListener("click", onSubmit);
    widthInput.removeEventListener("keydown", onKeyDown);
    heightInput.removeEventListener("keydown", onKeyDown);
    anchorInput.removeEventListener("keydown", onKeyDown);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  submitBtn.addEventListener("click", onSubmit);
  widthInput.addEventListener("keydown", onKeyDown);
  heightInput.addEventListener("keydown", onKeyDown);
  anchorInput.addEventListener("keydown", onKeyDown);
  openModal({
    backdrop,
    acceptBtnSelector: ".modal-never",
    onReject: finish,
  });
  requestAnimationFrame(() => widthInput.focus());
}

function renderSettingsUI() {
  renderSettingsUIView(settings);
}

async function persistSettings(next: VisionSettings, message?: string) {
  const debugChanged = next.debugLoggingEnabled !== settings.debugLoggingEnabled;
  settings = next;
  await saveSettings(settings);
  if (debugChanged) {
    await configureDebugLogging(settings.debugLoggingEnabled);
    debugLog(`Debug logging ${settings.debugLoggingEnabled ? "enabled" : "disabled"}`, "INFO");
  }
  renderTabs(settings.lastTab);
  renderSettingsUI();
  renderEditorState();
  if (message) {
    showToast(message);
  }
}

async function createNewDocumentFlow() {
  const nextDocument = await requestNewDocumentValues();
  if (!nextDocument) {
    return;
  }
  const { name, width, height, background } = nextDocument;
  const doc = makeNewDocument(name, width, height, settings.defaultZoom, background);
  doc.dirty = true;
  setActiveDocument(doc);
  renderEditorState();
  emitWorkspaceEvent("document-created", { documentId: doc.id, source: "blank" });
  debugLog(`Created new document '${doc.name}' at ${width}x${height}`, "INFO");
  showToast(`Created ${width}x${height} ${background} canvas`);
}

async function closeDocument(documentId: string) {
  if (transformDraft && activeDocumentId === documentId) {
    cancelTransformDraft(false);
  }
  const index = documents.findIndex((doc) => doc.id === documentId);
  if (index < 0) {
    return;
  }
  const doc = documents[index];

  if (doc.dirty) {
    const confirmed = await confirmModal({
      title: `Close ${doc.name}?`,
      message: "This canvas has unsaved changes. Closing it now will discard them.",
      acceptLabel: "Discard changes",
      rejectLabel: "Keep open",
      variant: "danger",
    });
    if (!confirmed) {
      return;
    }
  }

  documents.splice(index, 1);
  activeDocumentId = documents[Math.max(0, index - 1)]?.id ?? "";
  renderEditorState();
  emitWorkspaceEvent("document-closed", { documentId });
  debugLog(`Closed document '${doc.name}' (${documentId})`, "INFO");
  showToast(`${doc.name} closed`);
}

async function openDocumentFromBlob(name: string, blob: Blob, sourcePath: string | null) {
  const doc = await importDocumentFromBlob(name, blob, sourcePath, settings.defaultZoom);
  setActiveDocument(doc);
  renderEditorState();
  if (sourcePath) {
    await rememberRecentImage(sourcePath);
  }
  emitWorkspaceEvent("document-created", { documentId: doc.id, source: sourcePath ? "file" : "clipboard" });
  debugLog(`Opened document '${doc.name}'`, "INFO");
  showToast(`Opened ${doc.name}`);
}

async function addBlobAsLayerToActiveDocument(name: string, blob: Blob) {
  const doc = getActiveDocument();
  if (!doc) {
    await openDocumentFromBlob(name, blob, null);
    return;
  }

  const layer = await addBlobAsLayer(doc, name, blob);
  renderEditorState();
  debugLog(`Added layer '${layer.name}' from blob`, "INFO");
  showToast(`Added ${layer.name} as a new layer`);
}

async function openProjectFromPath(path: string) {
  const doc = await io.loadProject(path);
  setActiveDocument(doc);
  renderEditorState();
  await rememberRecentProject(path);
  debugLog(`Opened project '${doc.name}'`, "INFO");
  showToast(`Opened project ${doc.name}`);
}

async function handleOpenImage() {
  try {
    const path = await io.openImageDialog();
    if (!path || Array.isArray(path)) {
      return;
    }
    const bytes = await io.readBinary(path);
    const extension = path.split(".").pop()?.toLowerCase() ?? "png";
    const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    await openDocumentFromBlob(fileNameFromPath(path), new Blob([bytes], { type: mime }), path);
  } catch (error) {
    console.error(error);
    debugLog(`Failed to open image: ${String(error)}`, "ERROR");
    fileOpenInput.click();
  }
}

async function handleOpenProject() {
  try {
    const path = await io.openProjectDialog();
    if (!path || Array.isArray(path)) {
      return;
    }
    await openProjectFromPath(path);
  } catch (error) {
    console.error(error);
    debugLog(`Failed to open project: ${String(error)}`, "ERROR");
    showToast("Failed to open project");
  }
}

async function loadImageFromFileInput(file: File) {
  await openDocumentFromBlob(file.name, file, null);
}

async function handleExportImage() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to export");
    return;
  }

  try {
    const format = settings.exportFormat;
    const outputPath = await io.saveExport(doc, settings);
    if (!outputPath) {
      return;
    }
    doc.dirty = false;
    renderEditorState();
    debugLog(`Exported '${doc.name}' to '${io.fileNameFromPath(outputPath)}'`, "INFO");
    showToast(`Exported ${io.fileNameFromPath(outputPath)}`);
  } catch (error) {
    console.error(error);
    debugLog(`Export failed: ${String(error)}`, "ERROR");
    showToast("Export failed");
  }
}

async function saveProject(doc: DocumentState, saveAs = false) {
  const outputPath = await io.saveProject(doc, saveAs);
  if (!outputPath) {
    return;
  }
  doc.projectPath = outputPath;
  doc.dirty = false;
  await rememberRecentProject(outputPath);
  renderEditorState();
  debugLog(`Saved project '${doc.name}'`, "INFO");
  showToast(`Saved ${io.fileNameFromPath(outputPath)}`);
}

async function handleSaveProject(saveAs = false) {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to save");
    return;
  }

  try {
    await saveProject(doc, saveAs);
  } catch (error) {
    console.error(error);
    debugLog(`Project save failed: ${String(error)}`, "ERROR");
    showToast("Project save failed");
  }
}

async function handleUndo() {
  if (transformDraft) {
    cancelTransformDraft(false);
  }
  const doc = getActiveDocument();
  if (!doc || doc.undoStack.length === 0) {
    debugLog("Undo requested with empty stack", "WARN");
    showToast("Nothing to undo");
    return;
  }

  const current = snapshotDocument(doc);
  const previous = doc.undoStack.pop();
  if (!previous) {
    return;
  }

  doc.redoStack.push(current);
  await restoreDocumentFromSnapshot(doc, previous);
  doc.history = ["Undo", ...doc.history].slice(0, 20);
  debugLog(`Undo applied for document '${doc.name}'`, "INFO");
  renderEditorState();
}

async function handleRedo() {
  if (transformDraft) {
    cancelTransformDraft(false);
  }
  const doc = getActiveDocument();
  if (!doc || doc.redoStack.length === 0) {
    debugLog("Redo requested with empty stack", "WARN");
    showToast("Nothing to redo");
    return;
  }

  const current = snapshotDocument(doc);
  const next = doc.redoStack.pop();
  if (!next) {
    return;
  }

  doc.undoStack.push(current);
  await restoreDocumentFromSnapshot(doc, next);
  doc.history = ["Redo", ...doc.history].slice(0, 20);
  debugLog(`Redo applied for document '${doc.name}'`, "INFO");
  renderEditorState();
}

async function tryPasteImageFromClipboard(): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard as Clipboard & {
      read?: () => Promise<ClipboardItem[]>;
    };
    if (!clipboard.read) {
      return false;
    }
    const items = await clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      await addBlobAsLayerToActiveDocument(`Pasted ${documents.length + 1}.png`, blob);
      return true;
    }
  } catch {
    debugLog("Clipboard image read failed", "WARN");
    return false;
  }
  return false;
}

function bindTabNavigation() {
  topTabs = bindTabs({
    onChange: (tabId) => {
      const nextTab = tabId as AppTab;
      if (settings.lastTab === nextTab) {
        return;
      }
      void persistSettings({ ...settings, lastTab: nextTab });
      emitWorkspaceEvent("tab-changed", { tab: nextTab });
    },
  });
}

function bindAppNavigation() {
  bindNavigation({
    root: byId<HTMLElement>("app-nav"),
    onSelect: (id) => {
      if (id.startsWith("recent-project:")) {
        const path = settings.recentProjects[Number(id.split(":")[1])];
        if (path) {
          void (async () => {
            try {
              await openProjectFromPath(path);
            } catch {
              await removeRecent(path, "project");
              showToast("Recent project is no longer available", "error");
            }
          })();
        }
        return;
      }
      if (id.startsWith("recent-image:")) {
        const path = settings.recentImages[Number(id.split(":")[1])];
        if (path) {
          void (async () => {
            try {
              const bytes = await io.readBinary(path);
              const extension = path.split(".").pop()?.toLowerCase() ?? "png";
              const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
              await openDocumentFromBlob(fileNameFromPath(path), new Blob([bytes], { type: mime }), path);
            } catch {
              await removeRecent(path, "image");
              showToast("Recent image is no longer available", "error");
            }
          })();
        }
        return;
      }
      switch (id) {
        case "new-document":
          void createNewDocumentFlow();
          break;
        case "duplicate-document": {
          const doc = getActiveDocument();
          if (!doc) return;
          const copy = duplicateDocument(doc);
          setActiveDocument(copy);
          renderEditorState();
          debugLog(`Duplicated document '${doc.name}'`, "INFO");
          showToast(`Duplicated ${doc.name}`);
          break;
        }
        case "open-image":
          void handleOpenImage();
          break;
        case "open-project":
          void handleOpenProject();
          break;
        case "paste-image":
          void (async () => {
            const pasted = await tryPasteImageFromClipboard();
            if (!pasted) {
              showToast("Use Ctrl+V after copying an image if paste is blocked", "info");
            }
          })();
          break;
        case "save-project":
          void handleSaveProject(false);
          break;
        case "save-project-as":
          void handleSaveProject(true);
          break;
        case "export-image":
          void handleExportImage();
          break;
        case "rename-canvas":
          void renameCanvas();
          break;
        case "resize-canvas":
          openResizeCanvasModal();
          break;
        case "reset-view":
          resetCanvasView();
          break;
        case "toggle-checkerboard":
          void toggleCanvasSetting("showCheckerboard", "Checkerboard on", "Checkerboard off");
          break;
        case "toggle-grid":
          void toggleCanvasSetting("showGrid", "Grid on", "Grid off");
          break;
        case "toggle-snap":
          void toggleCanvasSetting("snapEnabled", "Snap on", "Snap off");
          break;
        case "select-all":
          selectEntireCanvas();
          break;
        case "deselect":
          clearSelection(true);
          break;
        case "invert-selection":
          invertSelection();
          break;
        case "toggle-tools-panel":
          void toggleWindowPanel("left");
          break;
        case "toggle-inspector-panel":
          void toggleWindowPanel("right");
          break;
      }
    },
  });
}

function bindToolSelection() {
  bindToolSelectionView({
    getSettings: () => settings,
    setSettings: async (next) => {
      settings = next;
      await saveSettings(settings);
      renderTabs(settings.lastTab);
      renderSettingsUI();
      renderEditorState();
    },
    renderEditorState,
    renderSettingsUI,
    showToast,
    onToolChanged: (tool) => emitWorkspaceEvent("tool-changed", { tool }),
  });
  document.querySelectorAll<HTMLButtonElement>("[data-selection-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setMarqueeMode(button.dataset.selectionMode as SelectionMode);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-transform-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setTransformMode(button.dataset.transformMode as TransformMode);
    });
  });
}

function bindZoomControls() {
  document.querySelectorAll<HTMLButtonElement>("[data-zoom-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const doc = getActiveDocument();
      if (!doc) return;
      const delta = button.dataset.zoomStep === "in" ? 25 : -25;
      doc.zoom = clamp(doc.zoom + delta, 10, 800);
      debugLog(`Zoom changed to ${doc.zoom}% for '${doc.name}'`, "INFO");
      renderEditorState();
    });
  });

  byId<HTMLButtonElement>("reset-view-btn").addEventListener("click", () => {
    resetCanvasView();
  });

  editorCanvas.addEventListener("wheel", (event) => {
    const doc = getActiveDocument();
    if (!doc) return;
    event.preventDefault();
    const nextZoom = clamp(doc.zoom + (event.deltaY < 0 ? 10 : -10), 10, 800);
    doc.zoom = nextZoom;
    debugLog(`Wheel zoom changed to ${doc.zoom}% for '${doc.name}'`, "INFO");
    renderEditorState();
  }, { passive: false });
}

function bindDocumentActions() {
  byId<HTMLButtonElement>("empty-new-doc-btn").addEventListener("click", () => {
    void createNewDocumentFlow();
  });

  byId<HTMLButtonElement>("empty-restore-docs-btn").addEventListener("click", () => {
    resetDocumentsToStarters();
    renderEditorState();
  });

  byId<HTMLButtonElement>("undo-btn").addEventListener("click", () => {
    void handleUndo();
  });

  byId<HTMLButtonElement>("redo-btn").addEventListener("click", () => {
    void handleRedo();
  });

  fileOpenInput.addEventListener("change", () => {
    const file = fileOpenInput.files?.[0];
    if (!file) return;
    void loadImageFromFileInput(file);
    fileOpenInput.value = "";
  });

  byId<HTMLButtonElement>("add-layer-btn").addEventListener("click", () => {
    const doc = getActiveDocument();
    if (!doc) return;
    const layer = addLayer(doc);
    debugLog(`Added layer '${layer.name}' to '${doc.name}'`, "INFO");
    renderEditorState();
  });

  byId<HTMLInputElement>("background-colour-input").addEventListener("input", (event) => {
    const doc = getActiveDocument();
    if (!doc || doc.layers.length === 0) {
      return;
    }
    const value = (event.currentTarget as HTMLInputElement).value;
    if (setBackgroundLayerColor(doc, value)) {
      debugLog(`Changed background colour to ${value} for '${doc.name}'`, "INFO");
      renderEditorState();
    } else {
      debugLog(`Failed to change background colour for '${doc.name}'`, "WARN");
    }
  });

}

function bindClipboardAndKeyboard() {
  window.addEventListener("paste", (event) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    debugLog("Paste event received with image payload", "INFO");
    void addBlobAsLayerToActiveDocument(`Pasted ${documents.length + 1}.png`, file);
  });

  window.addEventListener("keydown", (event) => {
    if (captureOverlay.active && event.key === "Escape") {
      event.preventDefault();
      void closeCaptureOverlay();
      return;
    }
    updateMarqueeModeFromModifiers(event.ctrlKey, event.shiftKey, event.altKey);
    if (settings.activeTool === "transform") {
      if (event.altKey) {
        transformMode = "rotate";
        renderToolState();
      } else {
        transformMode = "scale";
        renderToolState();
      }
    }

    if (event.code === "Space") {
      spacePressed = true;
      debugLog("Space modifier engaged for panning", "INFO");
    }

    if (event.key === "Escape") {
      const activeDoc = getActiveDocument();
      if (activeDoc?.selectionRect) {
        event.preventDefault();
        clearSelection(true);
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      debugLog("Shortcut: open project", "INFO");
      void handleOpenProject();
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      debugLog("Shortcut: open image", "INFO");
      void handleOpenImage();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      debugLog("Shortcut: new document", "INFO");
      void createNewDocumentFlow();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      debugLog("Shortcut: select all", "INFO");
      selectEntireCanvas();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      debugLog("Shortcut: deselect", "INFO");
      clearSelection(true);
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i") {
      event.preventDefault();
      debugLog("Shortcut: invert selection", "INFO");
      invertSelection();
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      const activeDoc = getActiveDocument();
      if (activeDoc?.selectionRect) {
        event.preventDefault();
        deleteSelectedArea();
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
      event.preventDefault();
      debugLog("Shortcut: export image", "INFO");
      void handleExportImage();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      debugLog(`Shortcut: save project${event.shiftKey ? " as" : ""}`, "INFO");
      void handleSaveProject(event.shiftKey);
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      debugLog("Shortcut: undo", "INFO");
      void handleUndo();
    }

    if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z")) {
      event.preventDefault();
      debugLog("Shortcut: redo", "INFO");
      void handleRedo();
    }
  });

  window.addEventListener("keyup", (event) => {
    updateMarqueeModeFromModifiers(event.ctrlKey, event.shiftKey, event.altKey);
    if (settings.activeTool === "transform") {
      transformMode = event.altKey ? "rotate" : "scale";
      renderToolState();
    }
    if (event.code === "Space") {
      spacePressed = false;
      debugLog("Space modifier released", "INFO");
    }
  });

  window.addEventListener("blur", () => {
    updateMarqueeModeFromModifiers(false, false, false);
    spacePressed = false;
  });
}

function bindDragAndDrop() {
  const prevent = (event: DragEvent) => {
    event.preventDefault();
  };

  canvasStage.addEventListener("dragenter", prevent);
  canvasStage.addEventListener("dragover", prevent);
  canvasStage.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      debugLog("Drag-drop rejected because payload was not an image", "WARN");
      showToast("Drop an image file to open it");
      return;
    }
    debugLog(`Drag-drop image '${file.name}'`, "INFO");
    void loadImageFromFileInput(file);
  });
}

function bindSettingsInputs() {
  bindSettingsInputsView({
    getSettings: () => settings,
    setSettings: async (next) => {
      settings = next;
      await saveSettings(settings);
      renderTabs(settings.lastTab);
      renderSettingsUI();
      renderEditorState();
    },
    renderEditorState,
    renderSettingsUI,
    showToast,
  });
  byId<HTMLInputElement>("debug-logging-checkbox").addEventListener("change", async (event) => {
    await persistSettings({
      ...settings,
      debugLoggingEnabled: (event.currentTarget as HTMLInputElement).checked,
    });
  });
  byId<HTMLButtonElement>("reset-defaults-btn").addEventListener("click", async () => {
    await persistSettings(getDefaultSettings(), "Defaults restored");
  });
  byId<HTMLButtonElement>("open-debug-folder-btn").addEventListener("click", async () => {
    try {
      await openDebugLogFolder();
      debugLog("Opened debug log folder", "INFO");
    } catch (error) {
      console.error("Failed to open debug logs folder:", error);
      debugLog(`Failed to open debug logs folder: ${String(error)}`, "ERROR");
      byId<HTMLElement>("debug-log-path").textContent = "Could not open debug logs folder.";
    }
  });
}

function bindColourSwatches() {
  document.querySelectorAll<HTMLButtonElement>("[data-colour-swatch]").forEach((button) => {
    button.addEventListener("click", () => {
      activeColour = button.dataset.colourSwatch ?? activeColour;
      updateBrushUI();
      debugLog(`Active colour set to ${activeColour}`, "INFO");
      showToast(`Colour set to ${activeColour}`);
    });
  });
}

function bindPaintControls() {
  bindPaintControlsView(
    (value) => { brushSize = value; },
    (value) => { brushOpacity = value; },
    showToast,
  );
}

function bindPanelResizers() {
  const workspace = document.querySelector<HTMLElement>(".editor-workspace");
  const leftResizer = byId<HTMLElement>("left-pane-resizer");
  const rightResizer = byId<HTMLElement>("right-pane-resizer");
  if (!workspace) {
    return;
  }

  bindSplitPaneResize({
    workspace,
    leftResizer,
    rightResizer,
    minLeft: 180,
    maxLeft: 360,
    minRight: 220,
    maxRight: 420,
  });

  const persistWidths = async () => {
    const leftPanelWidth = parseInt(getComputedStyle(workspace).getPropertyValue("--left-panel-width") || String(settings.leftPanelWidth), 10);
    const rightPanelWidth = parseInt(getComputedStyle(workspace).getPropertyValue("--right-panel-width") || String(settings.rightPanelWidth), 10);
    if (leftPanelWidth === settings.leftPanelWidth && rightPanelWidth === settings.rightPanelWidth) {
      return;
    }
    await persistSettings({
      ...settings,
      leftPanelWidth,
      rightPanelWidth,
    });
  };

  [leftResizer, rightResizer].forEach((resizer) => {
    resizer.addEventListener("mouseup", () => {
      void persistWidths();
    });
  });
}

function findGuideAtPosition(doc: DocumentState, docX: number, docY: number, bounds: { originX: number; originY: number; scale: number }): Guide | null {
  const threshold = 6 / bounds.scale;
  for (const guide of doc.guides) {
    if (guide.orientation === "horizontal" && Math.abs(docY - guide.position) < threshold) return guide;
    if (guide.orientation === "vertical" && Math.abs(docX - guide.position) < threshold) return guide;
  }
  return null;
}

function addGuide(doc: DocumentState, orientation: "horizontal" | "vertical", position: number) {
  const guide: Guide = { id: nextId("guide"), orientation, position };
  doc.guides.push(guide);
  doc.dirty = true;
  pushHistory(doc, `Added ${orientation} guide at ${Math.round(position)}`);
  return guide;
}

function removeGuide(doc: DocumentState, guideId: string) {
  const index = doc.guides.findIndex((g) => g.id === guideId);
  if (index >= 0) {
    doc.guides.splice(index, 1);
    doc.dirty = true;
    pushHistory(doc, "Removed guide");
  }
}

function bindCanvasInteractions() {
  const RULER_SIZE = 20;

  editorCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

  editorCanvas.addEventListener("pointerdown", (event) => {
    if (!settings.snapEnabled) {
      canvasPointer.handlePointerDown(event);
      return;
    }
    const doc = getActiveDocument();
    if (!doc) {
      canvasPointer.handlePointerDown(event);
      return;
    }
    const rect = editorCanvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    if (localY < RULER_SIZE && localX > RULER_SIZE) {
      draggingGuideOrientation = "vertical";
      const bounds = getCanvasBoundsForDoc(doc);
      const docX = (localX - bounds.originX) / bounds.scale;
      const newGuide = addGuide(doc, "vertical", docX);
      draggingGuideId = newGuide.id;
      editorCanvas.setPointerCapture(event.pointerId);
      renderEditorState();
      return;
    }
    if (localX < RULER_SIZE && localY > RULER_SIZE) {
      draggingGuideOrientation = "horizontal";
      const bounds = getCanvasBoundsForDoc(doc);
      const docY = (localY - bounds.originY) / bounds.scale;
      const newGuide = addGuide(doc, "horizontal", docY);
      draggingGuideId = newGuide.id;
      editorCanvas.setPointerCapture(event.pointerId);
      renderEditorState();
      return;
    }

    if (settings.activeTool === "move") {
      const bounds = getCanvasBoundsForDoc(doc);
      const docX = (localX - bounds.originX) / bounds.scale;
      const docY = (localY - bounds.originY) / bounds.scale;
      const guide = findGuideAtPosition(doc, docX, docY, bounds);
      if (guide) {
        draggingGuideId = guide.id;
        draggingGuideOrientation = guide.orientation;
        editorCanvas.setPointerCapture(event.pointerId);
        return;
      }
    }

    canvasPointer.handlePointerDown(event);
  });

  window.addEventListener("pointermove", (event) => {
    if (draggingGuideId) {
      const doc = getActiveDocument();
      if (!doc) return;
      const guide = doc.guides.find((g) => g.id === draggingGuideId);
      if (!guide) return;
      const rect = editorCanvas.getBoundingClientRect();
      const bounds = getCanvasBoundsForDoc(doc);
      if (guide.orientation === "horizontal") {
        guide.position = (event.clientY - rect.top - bounds.originY) / bounds.scale;
      } else {
        guide.position = (event.clientX - rect.left - bounds.originX) / bounds.scale;
      }
      renderEditorState();
      return;
    }
    canvasPointer.handlePointerMove(event);
  });

  window.addEventListener("pointerup", (event) => {
    if (draggingGuideId) {
      const doc = getActiveDocument();
      if (doc) {
        const guide = doc.guides.find((g) => g.id === draggingGuideId);
        if (guide) {
          if (guide.position < 0 || (guide.orientation === "horizontal" && guide.position > doc.height) ||
              (guide.orientation === "vertical" && guide.position > doc.width)) {
            removeGuide(doc, guide.id);
            debugLog("Guide removed (dragged off canvas)", "INFO");
            showToast("Guide removed", "info");
          }
        }
      }
      draggingGuideId = null;
      renderEditorState();
      return;
    }
    canvasPointer.handlePointerUp();
    activeSnapLines = [];
  });

  window.addEventListener("resize", renderCanvas);
}

function getCanvasBoundsForDoc(doc: DocumentState) {
  const rect = editorCanvas.getBoundingClientRect();
  return getCanvasBounds(doc, rect);
}

async function init() {
  setupWindowControls();
  settings = await loadSettings();
  settings = {
    ...settings,
    leftPanelCollapsed: false,
    leftPanelWidth: Math.max(220, settings.leftPanelWidth),
  };
  await configureDebugLogging(settings.debugLoggingEnabled);
  resetDocumentsToStarters();
  debugLog("Vision Goblin initialized", "INFO");
  window.addEventListener("error", (event) => {
    debugLog(`Unhandled error: ${event.message}`, "ERROR");
  });
  window.addEventListener("unhandledrejection", (event) => {
    debugLog(`Unhandled rejection: ${String(event.reason)}`, "ERROR");
  });

  bindTabNavigation();
  bindAppNavigation();
  bindToolSelection();
  bindZoomControls();
  bindDocumentActions();
  bindClipboardAndKeyboard();
  bindDragAndDrop();
  bindSettingsInputs();
  bindColourSwatches();
  bindPaintControls();
  bindTransformControls();
  bindCaptureTools();
  bindCaptureOverlay();
  bindPanelResizers();
  bindCanvasInteractions();
  await setupGlobalShortcuts();

  renderTabs(settings.lastTab);
  renderSettingsUI();
  renderEditorState();
  applyIcons();
}

void init();
