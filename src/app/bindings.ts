import { byId } from "./dom";
import { isCaptureDestination, normalizeCaptureDelaySeconds } from "./capture";
import type { VisionSettings } from "../settings";
import type { ActiveTool, ResizeAnchor } from "../editor/types";
import { clamp } from "../editor/utils";

interface BindingDeps {
  getSettings: () => VisionSettings;
  setSettings: (settings: VisionSettings) => Promise<void>;
  renderEditorState: () => void;
  renderSettingsUI: () => void;
  showToast: (message: string) => void;
}

export function bindToolSelection(deps: BindingDeps & { onToolChanged: (tool: ActiveTool) => void }) {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tool = button.dataset.tool as ActiveTool;
      await deps.setSettings({ ...deps.getSettings(), activeTool: tool });
      deps.onToolChanged(tool);
    });
  });
}

export function bindSettingsInputs(deps: BindingDeps) {
  byId<HTMLInputElement>("confirm-layer-deletion-checkbox").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), confirmLayerDeletion: (event.currentTarget as HTMLInputElement).checked });
  });
  byId<HTMLInputElement>("show-goblin-note-checkbox").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), showGoblinNote: (event.currentTarget as HTMLInputElement).checked });
  });
  byId<HTMLSelectElement>("colour-format-select").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), colourFormat: (event.currentTarget as HTMLSelectElement).value as VisionSettings["colourFormat"] });
  });
  byId<HTMLSelectElement>("export-format-select").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), exportFormat: (event.currentTarget as HTMLSelectElement).value as VisionSettings["exportFormat"] });
  });
  byId<HTMLInputElement>("export-quality-range").addEventListener("input", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), exportQuality: Number((event.currentTarget as HTMLInputElement).value) });
    deps.renderSettingsUI();
  });
  byId<HTMLSelectElement>("capture-destination-select").addEventListener("change", async (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isCaptureDestination(value)) return;
    await deps.setSettings({ ...deps.getSettings(), captureDestination: value });
  });
  byId<HTMLSelectElement>("capture-delay-select").addEventListener("change", async (event: Event) => {
    const value = normalizeCaptureDelaySeconds(Number((event.currentTarget as HTMLSelectElement).value));
    await deps.setSettings({ ...deps.getSettings(), captureDelaySeconds: value });
  });
  byId<HTMLInputElement>("capture-hide-window-checkbox").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), captureHideWindow: (event.currentTarget as HTMLInputElement).checked });
  });
}

export function bindPanelResizer(
  deps: BindingDeps,
  resizerId: string,
  key: "leftPanelWidth" | "rightPanelWidth",
  min: number,
  max: number
) {
  const resizer = byId<HTMLElement>(resizerId);
  let pointerId: number | null = null;
  resizer.addEventListener("pointerdown", (event: PointerEvent) => {
    pointerId = event.pointerId;
    resizer.setPointerCapture(pointerId);
    document.body.style.cursor = "col-resize";
  });
  resizer.addEventListener("pointermove", (event: PointerEvent) => {
    if (pointerId === null) return;
    const workspace = document.querySelector(".editor-workspace") as HTMLElement;
    const rect = workspace.getBoundingClientRect();
    const nextWidth = key === "leftPanelWidth"
      ? clamp(event.clientX - rect.left, min, max)
      : clamp(rect.right - event.clientX, min, max);
    const next = { ...deps.getSettings(), [key]: Math.round(nextWidth) } as VisionSettings;
    void deps.setSettings(next);
  });
  resizer.addEventListener("pointerup", () => {
    pointerId = null;
    document.body.style.cursor = "";
  });
}

export function bindPaintControls(setBrushSize: (value: number) => void, setBrushOpacity: (value: number) => void, showToast: (message: string) => void) {
  byId<HTMLInputElement>("brush-size-range").addEventListener("input", (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    setBrushSize(value);
    showToast(`Brush size ${value}px`);
  });
  byId<HTMLInputElement>("brush-opacity-range").addEventListener("input", (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value) / 100;
    setBrushOpacity(value);
    showToast(`Brush opacity ${Math.round(value * 100)}%`);
  });
}
