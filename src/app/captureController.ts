import { applyIcons, closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { VisionSettings } from "../settings";
import { byId } from "./dom";
import { getCaptureGlobalShortcutBindings } from "./capture";

export type CaptureOverlayMode = "region" | "picker";

interface CaptureWindowEntry {
  id: number;
  title: string;
}

interface CaptureOverlayState {
  active: boolean;
  loading: boolean;
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

interface CaptureCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CaptureDrawMetrics {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  scale: number;
}

export interface CaptureSelection {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureControllerDeps {
  getSettings: () => VisionSettings;
  executeCommand: (commandId: string) => void;
  openDocumentFromBlob: (name: string, blob: Blob, sourcePath: string | null) => Promise<void>;
  addBlobAsLayerToActiveDocument: (name: string, blob: Blob) => Promise<void>;
  applyPickedColour: (colour: string) => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export interface CaptureController {
  bindOverlay(): void;
  refreshGlobalShortcuts(): Promise<void>;
  beginRegionSnip(): Promise<void>;
  chooseWindowCapture(): Promise<void>;
  captureFullscreen(): Promise<void>;
  beginGlobalColourPick(): Promise<void>;
  closeOverlay(): Promise<void>;
  isOverlayActive(): boolean;
}

function createCaptureOverlayState(mode: CaptureOverlayMode = "region"): CaptureOverlayState {
  return {
    active: false,
    loading: false,
    mode,
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
}

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
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function createCaptureController(deps: CaptureControllerDeps): CaptureController {
  const currentWindow = getCurrentWindow();
  let captureOverlay = createCaptureOverlayState();
  let wasMaximizedBeforeCapture = false;
  let wasFullscreenBeforeCapture = false;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });

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
    sampleContext.clearRect(0, 0, 1, 1);
    sampleContext.drawImage(bitmap, -Math.floor(x), -Math.floor(y));
    const pixel = sampleContext.getImageData(0, 0, 1, 1).data;
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
    const confirmBtn = byId<HTMLButtonElement>("capture-overlay-confirm-btn");
    const hint = byId<HTMLElement>("capture-overlay-hint");
    const title = byId<HTMLElement>("capture-overlay-title");
    const magnifier = byId<HTMLCanvasElement>("capture-magnifier");
    const colourReadout = byId<HTMLElement>("capture-colour-readout");
    const colourChip = byId<HTMLElement>("capture-colour-chip");
    const coords = byId<HTMLElement>("capture-coords");
    const loadingCard = byId<HTMLElement>("capture-loading-card");
    const toolbar = byId<HTMLElement>("capture-overlay-toolbar");
    const canvas = byId<HTMLCanvasElement>("capture-overlay-canvas");

    overlay.hidden = !captureOverlay.active;
    loadingCard.hidden = !captureOverlay.loading;
    toolbar.hidden = captureOverlay.loading;
    canvas.hidden = captureOverlay.loading;

    if (captureOverlay.loading) return;

    title.textContent = captureOverlay.mode === "picker" ? "Global Colour Picker" : "Screen Snip";
    hint.textContent = captureOverlay.mode === "picker"
      ? "Move over the screenshot and click to sample a colour."
      : "Drag to select a region.";
    coords.textContent = `${Math.round(captureOverlay.hoverX)}, ${Math.round(captureOverlay.hoverY)}`;

    if (captureOverlay.mode === "region") {
      magnifier.hidden = true;
      colourReadout.hidden = true;
      confirmBtn.hidden = true;
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

  function showCaptureLoading(mode: CaptureOverlayMode) {
    captureOverlay = {
      ...createCaptureOverlayState(mode),
      active: true,
      loading: true,
    };
    renderCaptureOverlay();
  }

  async function openCaptureOverlay(mode: CaptureOverlayMode, imageUrl: string) {
    if (captureOverlay.imageUrl && captureOverlay.imageUrl.startsWith("blob:")) {
      URL.revokeObjectURL(captureOverlay.imageUrl);
    }
    await currentWindow.setAlwaysOnTop(true);
    const blob = await (await fetch(imageUrl)).blob();
    const imageBitmap = await createImageBitmap(blob);
    captureOverlay = {
      ...createCaptureOverlayState(mode),
      active: true,
      imageUrl,
      imageBitmap,
      hoverX: Math.round(imageBitmap.width / 2),
      hoverY: Math.round(imageBitmap.height / 2),
    };
    captureOverlay.sampledColour = sampleOverlayColourAt(captureOverlay.hoverX, captureOverlay.hoverY) ?? "#000000";
    renderCaptureOverlay();
    applyIcons();
  }

  async function restoreWindowAfterCapture() {
    await currentWindow.show();
    await currentWindow.unminimize();
    await currentWindow.setFocus();
    if (wasFullscreenBeforeCapture) {
      await currentWindow.setFullscreen(false);
    }
    if (wasMaximizedBeforeCapture) {
      await currentWindow.maximize();
    } else {
      await currentWindow.unmaximize();
    }
  }

  async function closeOverlay() {
    if (captureOverlay.imageUrl && captureOverlay.imageUrl.startsWith("blob:")) {
      URL.revokeObjectURL(captureOverlay.imageUrl);
    }
    await currentWindow.setAlwaysOnTop(false);
    captureOverlay = createCaptureOverlayState();
    renderCaptureOverlay();
    await currentWindow.setFullscreen(false);
    if (wasMaximizedBeforeCapture) {
      await currentWindow.maximize();
    }
  }

  function shouldHideWindowBeforeCapture() {
    return deps.getSettings().captureHideWindow;
  }

  function getCaptureDelaySeconds() {
    return deps.getSettings().captureDelaySeconds;
  }

  async function runCaptureCountdown() {
    const seconds = getCaptureDelaySeconds();
    if (seconds <= 0) return;

    const countdown = new WebviewWindow("capture-countdown", {
      url: "countdown.html",
      title: "Capture Countdown",
      width: 140,
      height: 140,
      center: true,
      resizable: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focus: false,
    });

    await new Promise<void>((resolve, reject) => {
      countdown.once("tauri://created", () => resolve());
      countdown.once("tauri://error", () => reject(new Error("Failed to create countdown window")));
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    for (let remaining = seconds; remaining > 0; remaining--) {
      await countdown.emitTo("capture-countdown", "countdown-tick", remaining);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await countdown.close();
  }

  async function hideWindowForCapture() {
    if (!shouldHideWindowBeforeCapture()) return;
    await currentWindow.minimize();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async function focusWindowForCaptureOverlay() {
    await currentWindow.setAlwaysOnTop(true);
    await currentWindow.show();
    await currentWindow.unminimize();
    await currentWindow.setFocus();
    await currentWindow.setFullscreen(true);
  }

  function getCaptureDestination() {
    return deps.getSettings().captureDestination;
  }

  async function deliverCaptureBlob(name: string, blob: Blob) {
    const destination = getCaptureDestination();
    if (destination === "clipboard") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        deps.showToast("Copied to clipboard");
      } catch {
        deps.showToast("Failed to copy to clipboard", "error");
      }
      return;
    }
    if (destination === "add-layer") {
      await deps.addBlobAsLayerToActiveDocument(name, blob);
      return;
    }
    await deps.openDocumentFromBlob(name, blob, null);
  }

  async function capturePrimaryMonitorBlob(): Promise<Blob> {
    const buffer = await invoke<ArrayBuffer>("capture_primary_monitor_png");
    return new Blob([buffer], { type: "image/png" });
  }

  async function captureWindowBlob(id: number): Promise<Blob> {
    const buffer = await invoke<ArrayBuffer>("capture_window_png", { id });
    return new Blob([buffer], { type: "image/png" });
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      await deliverCaptureBlob(`Snip ${Date.now()}.png`, blob);
    }
    await closeOverlay();
  }

  async function runOverlayCapture(mode: CaptureOverlayMode, failureLabel: string, logPrefix: string) {
    showCaptureLoading(mode);
    try {
      wasMaximizedBeforeCapture = await currentWindow.isMaximized();
      wasFullscreenBeforeCapture = await currentWindow.isFullscreen();
      await hideWindowForCapture();
      await runCaptureCountdown();
      const blob = await capturePrimaryMonitorBlob();
      await focusWindowForCaptureOverlay();
      const url = URL.createObjectURL(blob);
      await openCaptureOverlay(mode, url);
    } catch (error) {
      await restoreWindowAfterCapture().catch(() => undefined);
      await closeOverlay();
      const message = formatCaptureError(error, failureLabel);
      deps.log(`${logPrefix}: ${message}`, "ERROR");
      deps.showToast(message, "error");
    }
  }

  async function beginRegionSnip() {
    await runOverlayCapture("region", "Screen capture failed", "Region capture failed");
  }

  async function beginGlobalColourPick() {
    await runOverlayCapture("picker", "Colour pick failed", "Global colour pick failed");
  }

  async function captureWindowById(id: number) {
    const blob = await captureWindowBlob(id);
    await deliverCaptureBlob(`Window ${id}.png`, blob);
  }

  async function chooseWindowCapture() {
    try {
      const windows = await invoke<CaptureWindowEntry[]>("list_capture_windows");
      if (!windows.length) {
        deps.showToast("No capturable windows found", "error");
        return;
      }
      const backdrop = byId<HTMLElement>("capture-window-modal");
      const select = byId<HTMLSelectElement>("capture-window-select");
      const submitBtn = byId<HTMLButtonElement>("capture-window-submit-btn");
      select.innerHTML = windows.map((windowEntry) => `<option value="${windowEntry.id}">${windowEntry.title}</option>`).join("");

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        submitBtn.removeEventListener("click", onSubmit);
      };
      const onSubmit = async () => {
        const id = Number(select.value);
        closeModal({ backdrop });
        finish();
        try {
          await captureWindowById(id);
        } catch (error) {
          const message = formatCaptureError(error, "Window capture failed");
          deps.log(`Window capture failed: ${message}`, "ERROR");
          deps.showToast(message, "error");
        }
      };

      submitBtn.addEventListener("click", onSubmit);
      openModal({
        backdrop,
        acceptBtnSelector: ".modal-never",
        onReject: finish,
      });
    } catch (error) {
      const message = formatCaptureError(error, "Could not list capturable windows");
      deps.log(`Window list failed: ${message}`, "ERROR");
      deps.showToast(message, "error");
    }
  }

  async function captureFullscreen() {
    try {
      wasMaximizedBeforeCapture = await currentWindow.isMaximized();
      wasFullscreenBeforeCapture = await currentWindow.isFullscreen();
      await hideWindowForCapture();
      await runCaptureCountdown();
      const blob = await capturePrimaryMonitorBlob();
      await restoreWindowAfterCapture();
      await deliverCaptureBlob(`Screen ${Date.now()}.png`, blob);
    } catch (error) {
      await restoreWindowAfterCapture().catch(() => undefined);
      const message = formatCaptureError(error, "Full screen capture failed");
      deps.log(`Full screen capture failed: ${message}`, "ERROR");
      deps.showToast(message, "error");
    }
  }

  function bindOverlay() {
    const canvas = byId<HTMLCanvasElement>("capture-overlay-canvas");
    const coords = byId<HTMLElement>("capture-coords");

    let dragging = false;

    canvas.addEventListener("pointerdown", (event) => {
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
      coords.textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`;
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

    window.addEventListener("keydown", (event) => {
      if (!captureOverlay.active) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      void closeOverlay();
    });

    const cancelButton = byId<HTMLButtonElement>("capture-overlay-cancel-btn");
    cancelButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void closeOverlay();
    });

    byId<HTMLButtonElement>("capture-overlay-confirm-btn").addEventListener("click", () => {
      void confirmCaptureSelection();
    });

    canvas.addEventListener("click", async (event: MouseEvent) => {
      if (!captureOverlay.active || captureOverlay.mode !== "picker") return;
      const point = canvasToBitmapPoint(event.clientX, event.clientY);
      const colour = sampleOverlayColourAt(point.x, point.y);
      if (!colour) return;
      deps.applyPickedColour(colour);
      deps.showToast(`Sampled ${colour}`);
      await closeOverlay();
    });
  }

  async function refreshGlobalShortcuts() {
    await unregisterAll();
    for (const binding of getCaptureGlobalShortcutBindings(deps.getSettings().keybindings)) {
      try {
        await register(binding.accelerator, async (event) => {
          if (event.state === "Pressed") {
            deps.executeCommand(binding.commandId);
          }
        });
      } catch (error) {
        const message = formatCaptureError(error, `Could not register ${binding.commandId} shortcut`);
        deps.log(`Global shortcut registration failed for ${binding.commandId}: ${message}`, "WARN");
        deps.showToast(message, "error");
      }
    }
  }

  return {
    bindOverlay,
    refreshGlobalShortcuts,
    beginRegionSnip,
    chooseWindowCapture,
    captureFullscreen,
    beginGlobalColourPick,
    closeOverlay,
    isOverlayActive: () => captureOverlay.active,
  };
}
