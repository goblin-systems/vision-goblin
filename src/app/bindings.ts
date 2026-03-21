import { byId } from "./dom";
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

export function bindTabNavigation(deps: BindingDeps & { onTabChanged: (tab: string) => void }) {
  document.querySelectorAll<HTMLButtonElement>("[data-tab-trigger]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextTab = button.dataset.tabTrigger as VisionSettings["lastTab"];
      await deps.setSettings({ ...deps.getSettings(), lastTab: nextTab });
      deps.onTabChanged(nextTab);
    });
  });
}

export function bindToolSelection(deps: BindingDeps & { onToolChanged: (tool: ActiveTool) => void }) {
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tool = button.dataset.tool as ActiveTool;
      await deps.setSettings({ ...deps.getSettings(), activeTool: tool, lastTab: "editor" });
      deps.onToolChanged(tool);
    });
  });
}

export function bindSettingsInputs(deps: BindingDeps) {
  byId<HTMLInputElement>("checkerboard-toggle").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), showCheckerboard: (event.currentTarget as HTMLInputElement).checked });
  });
  byId<HTMLInputElement>("grid-toggle").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), showGrid: (event.currentTarget as HTMLInputElement).checked });
  });
  byId<HTMLInputElement>("grid-size-input").addEventListener("change", async (event: Event) => {
    const value = clamp(Math.round(Number((event.currentTarget as HTMLInputElement).value)), 4, 500);
    await deps.setSettings({ ...deps.getSettings(), gridSize: value });
  });
  byId<HTMLInputElement>("snap-toggle").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), snapEnabled: (event.currentTarget as HTMLInputElement).checked });
  });
  byId<HTMLSelectElement>("default-zoom-select").addEventListener("change", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), defaultZoom: Number((event.currentTarget as HTMLSelectElement).value) });
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
  byId<HTMLInputElement>("left-panel-width-range").addEventListener("input", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), leftPanelWidth: Number((event.currentTarget as HTMLInputElement).value), leftPanelCollapsed: false });
  });
  byId<HTMLInputElement>("right-panel-width-range").addEventListener("input", async (event: Event) => {
    await deps.setSettings({ ...deps.getSettings(), rightPanelWidth: Number((event.currentTarget as HTMLInputElement).value), rightPanelCollapsed: false });
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
