import "@goblin-systems/goblin-design-system/style.css";
import "../styles.css";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CaptureOverlayInitPayload, CaptureOverlayMode, CaptureOverlayResult } from "./captureOverlayShared";
import {
  computeCaptureDrawMetrics,
  computeCaptureHudPosition,
  computeLensBands,
  getCaptureSelectionFromDrag,
  mapClientPointToBitmapPoint,
} from "./captureOverlayShared";

interface CaptureOverlayState {
  active: boolean;
  loading: boolean;
  mode: CaptureOverlayMode;
  imageBitmap: ImageBitmap | null;
  dragStartX: number;
  dragStartY: number;
  dragCurrentX: number;
  dragCurrentY: number;
  hoverX: number;
  hoverY: number;
  pointerClientX: number;
  pointerClientY: number;
  sampledColour: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing overlay element: ${id}`);
  }
  return element as T;
}

function createState(mode: CaptureOverlayMode = "region"): CaptureOverlayState {
  return {
    active: false,
    loading: false,
    mode,
    imageBitmap: null,
    dragStartX: 0,
    dragStartY: 0,
    dragCurrentX: 0,
    dragCurrentY: 0,
    hoverX: 0,
    hoverY: 0,
    pointerClientX: 0,
    pointerClientY: 0,
    sampledColour: "#000000",
  };
}

const appWindow = getCurrentWebviewWindow();
const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = 1;
sampleCanvas.height = 1;
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
let captureOverlay = createState();
let dragging = false;
let hasSettled = false;

function getCaptureSelection() {
  return getCaptureSelectionFromDrag(
    captureOverlay.dragStartX,
    captureOverlay.dragStartY,
    captureOverlay.dragCurrentX,
    captureOverlay.dragCurrentY,
  );
}

function getCaptureCanvasMetrics() {
  const canvas = byId<HTMLCanvasElement>("capture-overlay-canvas");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const metrics = computeCaptureDrawMetrics(rect, dpr, captureOverlay.imageBitmap);
  return { canvas, rect, dpr, ...metrics };
}

function canvasToBitmapPoint(clientX: number, clientY: number) {
  const { rect, drawX, drawY, drawWidth, drawHeight, scale } = getCaptureCanvasMetrics();
  return mapClientPointToBitmapPoint(clientX, clientY, rect, { drawX, drawY, drawWidth, drawHeight, scale });
}

function sampleOverlayColourAt(x: number, y: number) {
  const bitmap = captureOverlay.imageBitmap;
  if (!bitmap || !sampleContext) {
    return null;
  }
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  sampleContext.clearRect(0, 0, 1, 1);
  sampleContext.drawImage(bitmap, -Math.floor(x), -Math.floor(y));
  const pixel = sampleContext.getImageData(0, 0, 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function syncPickerHudPosition() {
  if (!captureOverlay.active || captureOverlay.mode !== "picker") {
    return;
  }
  const hud = byId<HTMLElement>("capture-picker-hud");
  const { left, top } = computeCaptureHudPosition(
    captureOverlay.pointerClientX,
    captureOverlay.pointerClientY,
    hud.offsetWidth,
    hud.offsetHeight,
    window.innerWidth,
    window.innerHeight,
  );
  hud.style.left = `${left}px`;
  hud.style.top = `${top}px`;
}

function drawCaptureMagnifier() {
  const magnifier = byId<HTMLCanvasElement>("capture-magnifier");
  const ctx = magnifier.getContext("2d");
  const bitmap = captureOverlay.imageBitmap;
  if (!ctx || !bitmap || !sampleContext) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, magnifier.width, magnifier.height);
  const sampleSize = 11;
  const half = Math.floor(sampleSize / 2);
  const sx = Math.max(0, Math.min(bitmap.width - sampleSize, Math.round(captureOverlay.hoverX) - half));
  const sy = Math.max(0, Math.min(bitmap.height - sampleSize, Math.round(captureOverlay.hoverY) - half));
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  sampleContext.clearRect(0, 0, sampleSize, sampleSize);
  sampleContext.drawImage(bitmap, sx, sy, sampleSize, sampleSize, 0, 0, sampleSize, sampleSize);
  const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
  const xBands = computeLensBands(magnifier.width, sampleSize);
  const yBands = computeLensBands(magnifier.height, sampleSize);
  const radius = Math.min(magnifier.width, magnifier.height) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(magnifier.width / 2, magnifier.height / 2, radius - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(8, 12, 22, 0.96)";
  ctx.fillRect(0, 0, magnifier.width, magnifier.height);

  for (let row = 0; row < sampleSize; row += 1) {
    const yBand = yBands[row];
    for (let col = 0; col < sampleSize; col += 1) {
      const xBand = xBands[col];
      const pixelIndex = (row * sampleSize + col) * 4;
      ctx.fillStyle = `rgb(${pixels[pixelIndex]}, ${pixels[pixelIndex + 1]}, ${pixels[pixelIndex + 2]})`;
      ctx.fillRect(xBand.start, yBand.start, xBand.size, yBand.size);
    }
  }

  const centreBandX = xBands[half];
  const centreBandY = yBands[half];
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(centreBandX.start + 0.75, centreBandY.start + 0.75, centreBandX.size - 1.5, centreBandY.size - 1.5);
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(magnifier.width / 2, magnifier.height / 2, radius - 1, 0, Math.PI * 2);
  ctx.stroke();
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
    return;
  }

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

function renderCaptureOverlay() {
  const overlay = byId<HTMLElement>("capture-overlay");
  const hud = byId<HTMLElement>("capture-picker-hud");
  const magnifier = byId<HTMLCanvasElement>("capture-magnifier");
  const colourReadout = byId<HTMLElement>("capture-colour-readout");
  const colourChip = byId<HTMLElement>("capture-colour-chip");
  const coords = byId<HTMLElement>("capture-coords");
  const loadingCard = byId<HTMLElement>("capture-loading-card");
  const canvas = byId<HTMLCanvasElement>("capture-overlay-canvas");

  overlay.hidden = !captureOverlay.active;
  loadingCard.hidden = !captureOverlay.loading;
  canvas.hidden = captureOverlay.loading;
  hud.hidden = captureOverlay.loading || captureOverlay.mode !== "picker";

  if (captureOverlay.loading) return;

  coords.textContent = `${Math.round(captureOverlay.hoverX)}, ${Math.round(captureOverlay.hoverY)}`;

  if (captureOverlay.mode === "region") {
    magnifier.hidden = true;
    colourReadout.hidden = true;
    colourChip.hidden = true;
  } else {
    magnifier.hidden = false;
    colourReadout.hidden = false;
    colourChip.hidden = false;
    colourChip.style.background = captureOverlay.sampledColour;
    colourReadout.textContent = captureOverlay.sampledColour;
    drawCaptureMagnifier();
    syncPickerHudPosition();
  }
  drawCaptureOverlayCanvas();
}

async function loadOverlay(payload: CaptureOverlayInitPayload) {
  const blob = await (await fetch(payload.imageDataUrl)).blob();
  const imageBitmap = await createImageBitmap(blob);
  captureOverlay = {
    ...createState(payload.mode),
    active: true,
    loading: false,
    imageBitmap,
    hoverX: Math.round(imageBitmap.width / 2),
    hoverY: Math.round(imageBitmap.height / 2),
    pointerClientX: Math.round(window.innerWidth / 2),
    pointerClientY: Math.round(window.innerHeight / 2),
  };
  captureOverlay.sampledColour = sampleOverlayColourAt(captureOverlay.hoverX, captureOverlay.hoverY) ?? "#000000";
  renderCaptureOverlay();
}

async function emitAndClose(result: CaptureOverlayResult) {
  if (hasSettled) {
    return;
  }
  hasSettled = true;
  await appWindow.emitTo("main", "capture-overlay-result", result);
  await appWindow.close();
}

async function emitCancelAndClose() {
  await emitAndClose({ kind: "cancel" });
}

async function canvasToDataUrl(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Failed to prepare capture result");
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to prepare capture result"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function confirmCaptureSelection() {
  if (!captureOverlay.imageBitmap) return;
  const selection = getCaptureSelection();
  if (selection.width < 2 || selection.height < 2) return;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(selection.width));
  canvas.height = Math.max(1, Math.round(selection.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(
    captureOverlay.imageBitmap,
    selection.left,
    selection.top,
    selection.width,
    selection.height,
    0,
    0,
    selection.width,
    selection.height,
  );
  const imageDataUrl = await canvasToDataUrl(canvas);
  await emitAndClose({ kind: "region", imageDataUrl });
}

function bindOverlay() {
  const canvas = byId<HTMLCanvasElement>("capture-overlay-canvas");

  canvas.addEventListener("pointerdown", (event) => {
    if (!captureOverlay.active) return;
    const point = canvasToBitmapPoint(event.clientX, event.clientY);
    captureOverlay.dragStartX = point.x;
    captureOverlay.dragStartY = point.y;
    captureOverlay.dragCurrentX = point.x;
    captureOverlay.dragCurrentY = point.y;
    captureOverlay.hoverX = point.x;
    captureOverlay.hoverY = point.y;
    captureOverlay.pointerClientX = event.clientX;
    captureOverlay.pointerClientY = event.clientY;
    captureOverlay.sampledColour = sampleOverlayColourAt(point.x, point.y) ?? captureOverlay.sampledColour;
    dragging = captureOverlay.mode === "region";
    canvas.setPointerCapture(event.pointerId);
    renderCaptureOverlay();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!captureOverlay.active) return;
    const point = canvasToBitmapPoint(event.clientX, event.clientY);
    if (dragging) {
      captureOverlay.dragCurrentX = point.x;
      captureOverlay.dragCurrentY = point.y;
    }
    captureOverlay.hoverX = point.x;
    captureOverlay.hoverY = point.y;
    captureOverlay.pointerClientX = event.clientX;
    captureOverlay.pointerClientY = event.clientY;
    const colour = sampleOverlayColourAt(point.x, point.y);
    if (colour) {
      captureOverlay.sampledColour = colour;
    }
    if (dragging || captureOverlay.mode === "picker") {
      renderCaptureOverlay();
    }
  });

  canvas.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (captureOverlay.active && captureOverlay.mode === "region") {
      const selection = getCaptureSelection();
      if (selection.width >= 2 && selection.height >= 2) {
        void confirmCaptureSelection();
        return;
      }
    }
    if (captureOverlay.active) {
      renderCaptureOverlay();
    }
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });

  canvas.addEventListener("click", async (event) => {
    if (!captureOverlay.active || captureOverlay.mode !== "picker") return;
    const point = canvasToBitmapPoint(event.clientX, event.clientY);
    const colour = sampleOverlayColourAt(point.x, point.y);
    if (!colour) return;
    await emitAndClose({ kind: "picker", colour });
  });

  window.addEventListener("keydown", (event) => {
    if (!captureOverlay.active) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    void emitCancelAndClose();
  });

  window.addEventListener("resize", () => {
    if (!captureOverlay.active || captureOverlay.mode !== "picker") return;
    syncPickerHudPosition();
  });
}

function boot() {
  captureOverlay = {
    ...createState(),
    active: true,
    loading: true,
  };
  renderCaptureOverlay();
  bindOverlay();
  void appWindow.listen<CaptureOverlayInitPayload>("capture-overlay-init", (event) => {
    hasSettled = false;
    dragging = false;
    captureOverlay = {
      ...createState(event.payload.mode),
      active: true,
      loading: true,
    };
    renderCaptureOverlay();
    void loadOverlay(event.payload);
  });
}

boot();
