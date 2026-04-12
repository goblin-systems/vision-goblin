import { closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import type { VisionSettings } from "../settings";
import { getCaptureGlobalShortcutBindings } from "./capture";
import {
  describeCaptureFailure,
  formatCaptureError,
  type CaptureDesktopBounds,
  type CaptureOverlayInitPayload,
  type CaptureOverlayMode,
  type CaptureOverlayResult,
  type CaptureSelection,
} from "./captureOverlayShared";

export {
  computeCaptureDrawMetrics,
  computeCaptureHudPosition,
  computeLensBands,
  describeCaptureFailure,
  formatCaptureError,
  getCaptureSelectionFromDrag,
  mapClientPointToBitmapPoint,
} from "./captureOverlayShared";
export type { CaptureOverlayMode, CaptureSelection } from "./captureOverlayShared";

interface CaptureWindowEntry {
  id: number;
  title: string;
}

interface CaptureControllerDeps {
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

const CAPTURE_OVERLAY_LABEL = "capture-overlay";
const CAPTURE_RESULT_EVENT = "capture-overlay-result";
const CAPTURE_INIT_EVENT = "capture-overlay-init";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to prepare desktop capture"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(imageDataUrl: string): Promise<Blob> {
  const response = await fetch(imageDataUrl);
  return response.blob();
}

export function createCaptureController(deps: CaptureControllerDeps): CaptureController {
  const currentWindow = getCurrentWindow();
  let overlayActive = false;
  let wasMaximizedBeforeCapture = false;
  let wasFullscreenBeforeCapture = false;

  function shouldHideWindowBeforeCapture() {
    return deps.getSettings().captureHideWindow;
  }

  function getCaptureDelaySeconds() {
    return deps.getSettings().captureDelaySeconds;
  }

  function getCaptureDestination() {
    return deps.getSettings().captureDestination;
  }

  async function snapshotWindowStateBeforeCapture() {
    wasMaximizedBeforeCapture = await currentWindow.isMaximized();
    wasFullscreenBeforeCapture = await currentWindow.isFullscreen();
  }

  async function restoreWindowAfterCapture() {
    await currentWindow.show();
    await currentWindow.unminimize();
    if (wasFullscreenBeforeCapture) {
      await currentWindow.setFullscreen(true);
    } else {
      await currentWindow.setFullscreen(false);
      if (wasMaximizedBeforeCapture) {
        await currentWindow.maximize();
      } else {
        await currentWindow.unmaximize();
      }
    }
    await currentWindow.setFocus();
  }

  async function closeOverlayWindow() {
    const overlayWindow = await WebviewWindow.getByLabel(CAPTURE_OVERLAY_LABEL);
    overlayActive = false;
    if (!overlayWindow) {
      return;
    }
    await overlayWindow.close().catch(() => undefined);
  }

  async function closeOverlay() {
    await closeOverlayWindow();
    await restoreWindowAfterCapture().catch(() => undefined);
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

    await delay(100);

    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      await countdown.emitTo("capture-countdown", "countdown-tick", remaining);
      await delay(1000);
    }

    await countdown.close();
  }

  async function hideWindowForCapture() {
    if (!shouldHideWindowBeforeCapture()) return;
    await currentWindow.minimize();
    await delay(300);
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

  async function captureVirtualDesktopBlob(): Promise<Blob> {
    const buffer = await invoke<ArrayBuffer>("capture_virtual_desktop_png");
    return new Blob([buffer], { type: "image/png" });
  }

  async function getVirtualDesktopBounds(): Promise<CaptureDesktopBounds> {
    return invoke<CaptureDesktopBounds>("get_virtual_desktop_bounds");
  }

  async function captureWindowBlob(id: number): Promise<Blob> {
    const buffer = await invoke<ArrayBuffer>("capture_window_png", { id });
    return new Blob([buffer], { type: "image/png" });
  }

  async function ensureOverlayWindow(bounds: CaptureDesktopBounds) {
    const existingWindow = await WebviewWindow.getByLabel(CAPTURE_OVERLAY_LABEL);
    const overlayWindow = existingWindow ?? new WebviewWindow(CAPTURE_OVERLAY_LABEL, {
      url: "capture-overlay.html",
      title: "Capture Overlay",
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      visible: false,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      closable: false,
      shadow: false,
      focus: true,
    });

    if (!existingWindow) {
      await new Promise<void>((resolve, reject) => {
        overlayWindow.once("tauri://created", () => resolve());
        overlayWindow.once("tauri://error", () => reject(new Error("Failed to create capture overlay")));
      });
    }

    await overlayWindow.setPosition(new PhysicalPosition(bounds.x, bounds.y));
    await overlayWindow.setSize(new PhysicalSize(bounds.width, bounds.height));
    await overlayWindow.show();
    await overlayWindow.setFocus();
    overlayActive = true;
    return overlayWindow;
  }

  async function waitForOverlayResult(overlayWindow: WebviewWindow): Promise<CaptureOverlayResult> {
    return new Promise<CaptureOverlayResult>(async (resolve) => {
      let settled = false;
      const unlistenResult = await currentWindow.listen<CaptureOverlayResult>(CAPTURE_RESULT_EVENT, async (event) => {
        if (settled) return;
        settled = true;
        await unlistenResult();
        resolve(event.payload);
      });
      await overlayWindow.once("tauri://destroyed", async () => {
        if (settled) return;
        settled = true;
        await unlistenResult();
        resolve({ kind: "cancel" });
      });
    });
  }

  async function openOverlaySession(mode: CaptureOverlayMode, blob: Blob, bounds: CaptureDesktopBounds) {
    const overlayWindow = await ensureOverlayWindow(bounds);
    const resultPromise = waitForOverlayResult(overlayWindow);
    const payload: CaptureOverlayInitPayload = {
      mode,
      desktopBounds: bounds,
      imageDataUrl: await blobToDataUrl(blob),
    };
    await overlayWindow.emitTo(CAPTURE_OVERLAY_LABEL, CAPTURE_INIT_EVENT, payload);
    return resultPromise;
  }

  async function runOverlayCapture(mode: CaptureOverlayMode, failureLabel: string, logPrefix: string) {
    try {
      await snapshotWindowStateBeforeCapture();
      await hideWindowForCapture();
      await runCaptureCountdown();
      const [blob, bounds] = await Promise.all([captureVirtualDesktopBlob(), getVirtualDesktopBounds()]);
      const result = await openOverlaySession(mode, blob, bounds);
      await closeOverlayWindow();
      await restoreWindowAfterCapture();
      if (result.kind === "cancel") {
        return;
      }
      if (result.kind === "picker") {
        deps.applyPickedColour(result.colour);
        deps.showToast(`Sampled ${result.colour}`);
        return;
      }
      await deliverCaptureBlob(`Snip ${Date.now()}.png`, await dataUrlToBlob(result.imageDataUrl));
    } catch (error) {
      await closeOverlayWindow().catch(() => undefined);
      await restoreWindowAfterCapture().catch(() => undefined);
      const message = describeCaptureFailure(error, failureLabel);
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
          const message = describeCaptureFailure(error, "Window capture failed");
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
      const message = describeCaptureFailure(error, "Could not list capturable windows");
      deps.log(`Window list failed: ${message}`, "ERROR");
      deps.showToast(message, "error");
    }
  }

  async function captureFullscreen() {
    try {
      await snapshotWindowStateBeforeCapture();
      await hideWindowForCapture();
      await runCaptureCountdown();
      const blob = await captureVirtualDesktopBlob();
      await restoreWindowAfterCapture();
      await deliverCaptureBlob(`Screen ${Date.now()}.png`, blob);
    } catch (error) {
      await restoreWindowAfterCapture().catch(() => undefined);
      const message = describeCaptureFailure(error, "Full screen capture failed");
      deps.log(`Full screen capture failed: ${message}`, "ERROR");
      deps.showToast(message, "error");
    }
  }

  function bindOverlay() {
    // Overlay interaction now lives in the dedicated capture overlay window.
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
    isOverlayActive: () => overlayActive,
  };
}
