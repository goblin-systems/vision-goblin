import { applyIcons, bindNavigation, bindSplitPaneResize, bindTabs } from "@goblin-systems/goblin-design-system";
import { bindSettingsInputs as bindSettingsInputsView, bindToolSelection as bindToolSelectionView } from "./bindings";
import { byId } from "./dom";
import { renderDocumentTabs as renderDocumentTabsView, renderSettingsUI as renderSettingsUIView, renderToolState as renderToolStateView, updateBrushUI as updateBrushUIView } from "../editor/render";
import { clamp } from "../editor/utils";
import { DEFAULT_KEYBINDINGS, getDefaultSettings, type AppTab, type VisionSettings } from "../settings";
import type { ActiveTool, DocumentState, Layer, ShapeKind } from "../editor/types";
import { SHAPE_NAMES, type SelectionMode } from "../editor/selection";
import type { TransformMode } from "../editor/transformController";
import type { UiTheme } from "./theme";

const TOOL_COPY: Record<ActiveTool, string> = {
  move: "Move tool active. Drag the current layer to reposition it on the canvas.",
  marquee: "Marquee tool active. Drag on the canvas to create a rectangular selection.",
  transform: "Transform tool active. Drag a corner handle to scale the active layer.",
  crop: "Crop tool active. Drag a region and it applies automatically when you release.",
  brush: "Brush tool active. Paint directly onto the active raster layer.",
  eraser: "Eraser tool active. Destructively erase pixels from the active raster layer.",
  eyedropper: "Eyedropper active. Click the canvas to sample a colour into the paint swatch.",
  smudge: "Smudge tool active. Drag to smudge pixels on the active layer.",
  "clone-stamp": "Clone stamp active. Alt-click to set source, then paint to clone pixels.",
  "healing-brush": "Healing brush active. Paint over dust and blemishes to blend nearby tone and texture.",
  text: "Text tool active. Click for point text or drag to create wrapped box text.",
  shape: "Shape tool active. Click or drag to create an editable shape layer.",
  lasso: "Lasso tool active. Draw a freehand selection path around the area you want.",
  "polygon-lasso": "Polygonal lasso active. Click to place vertices, double-click or Enter to close.",
  "magic-wand": "Magic wand active. Click to select pixels with similar colour.",
};

export const KEYBINDING_LABELS: Record<string, string> = {
  "tool-move": "Move tool",
  "tool-marquee": "Marquee tool",
  "tool-transform": "Transform tool",
  "tool-crop": "Crop tool",
  "tool-brush": "Brush tool",
  "tool-eraser": "Eraser tool",
  "tool-eyedropper": "Eyedropper tool",
  "tool-smudge": "Smudge tool",
  "tool-clone-stamp": "Clone stamp tool",
  "tool-lasso": "Lasso tool",
  "tool-polygon-lasso": "Polygon lasso tool",
  "tool-magic-wand": "Magic wand tool",
  "new-document": "New document",
  "open-image": "Open image",
  "open-project": "Open project",
  "save-project": "Save project",
  "save-project-as": "Save project as",
  "export-image": "Export image",
  "capture-region": "Capture region",
  "capture-window": "Capture window",
  "capture-fullscreen": "Capture full screen",
  "pick-from-screen": "Pick colour from screen",
  undo: "Undo",
  redo: "Redo",
  "redo-alt": "Redo (alt)",
  "select-all": "Select all",
  deselect: "Deselect",
  "invert-selection": "Invert selection",
};

const EMPTY_DOC_DISABLED_NAV_IDS = [
  "duplicate-document-nav",
  "save-project-nav",
  "save-project-as-nav",
  "export-image-nav",
  "rename-canvas-nav",
  "resize-canvas-nav",
  "reset-view-nav",
  "select-all-nav",
  "deselect-nav",
  "invert-selection-nav",
  "brightness-contrast-nav",
  "hue-saturation-nav",
  "lut-nav",
  "gradient-map-nav",
  "curves-nav",
  "levels-nav",
  "gaussian-blur-nav",
  "sharpen-nav",
  "color-balance-nav",
  "motion-blur-nav",
  "add-noise-nav",
  "reduce-noise-nav",
  "warp-nav",
  "liquify-nav",
  "add-adj-brightness-contrast-nav",
  "add-adj-hue-saturation-nav",
  "add-adj-levels-nav",
  "add-adj-curves-nav",
  "add-adj-color-balance-nav",
  "add-adj-gradient-map-nav",
  "convert-to-smart-object-nav",
  "rasterize-layer-nav",
  "align-left-nav",
  "align-right-nav",
  "align-top-nav",
  "align-bottom-nav",
  "align-center-h-nav",
  "align-center-v-nav",
  "distribute-h-nav",
  "distribute-v-nav",
  "align-to-canvas-nav",
  "color-range-nav",
  "refine-edge-nav",
  "quick-mask-nav",
] as const;

interface WorkspaceShellState {
  hasDocument: boolean;
  activeDocMeta: string;
  zoomReadout: string;
  statusRight: string;
  saveProjectLabel: string;
  floatingChip: string;
  quickMaskActive: boolean;
  undoDisabled: boolean;
  redoDisabled: boolean;
  navDisabled: Record<string, boolean>;
  navLabels: Record<string, string>;
  navIcons: Record<string, string>;
}

interface BuildWorkspaceShellStateParams {
  settings: VisionSettings;
  doc: DocumentState | null;
  activeLayer: Layer | null;
  selectedLayerCount: number;
  quickMaskActive: boolean;
  activeShapeKind: ShapeKind;
}

function formatSelectionDimension(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return Number.parseFloat(value.toFixed(2)).toString();
}

export function formatShortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}

export function getToolTooltipLabel(baseName: string, shortcut: string | undefined) {
  return shortcut ? `${baseName} (${shortcut})` : baseName;
}

export function getCanvasFloatingChipText(params: {
  quickMaskActive: boolean;
  activeTool: ActiveTool;
  activeShapeKind: ShapeKind;
}) {
  if (params.quickMaskActive) {
    return "Quick Mask - Brush adds to selection, Eraser removes. Press Q to exit.";
  }
  switch (params.activeTool) {
    case "move":
      return "Drag active layer. Right drag or Space+drag pans the viewport.";
    case "marquee":
      return "Drag to create a selection. Escape clears it.";
    case "transform":
      return "Drag a corner handle to scale the active layer.";
    case "brush":
      return "Paint on the active layer. Adjust size and opacity in the tools column.";
    case "eraser":
      return "Erase pixels from the active layer.";
    case "eyedropper":
      return "Click the canvas to sample a colour.";
    case "smudge":
      return "Drag to smudge pixels on the active layer.";
    case "clone-stamp":
      return "Alt-click to set source, then paint to clone pixels.";
    case "healing-brush":
      return "Paint across small defects to blend nearby tone and texture.";
    case "text":
      return "Click for point text or drag for box text.";
    case "shape":
      return `Click or drag to create a ${params.activeShapeKind}.`;
    default:
      return "Wheel to zoom. Right drag or Space+drag to pan.";
  }
}

export function buildWorkspaceShellState(params: BuildWorkspaceShellStateParams): WorkspaceShellState {
  const { settings, doc, activeLayer, selectedLayerCount, quickMaskActive, activeShapeKind } = params;
  const navLabels: Record<string, string> = {
    "checkerboard-nav-label": settings.showCheckerboard ? "Hide checkerboard" : "Show checkerboard",
    "grid-nav-label": settings.showGrid ? "Hide pixel grid" : "Show pixel grid",
    "snap-nav-label": settings.snapEnabled ? "Disable snap" : "Enable snap",
    "toggle-tools-nav-label": settings.leftPanelCollapsed ? "Show tools" : "Hide tools",
    "toggle-inspector-nav-label": settings.rightPanelCollapsed ? "Show inspector" : "Hide inspector",
  };
  const navIcons: Record<string, string> = {
    "toggle-tools-nav": settings.leftPanelCollapsed ? "panel-left-open" : "panel-left-close",
    "toggle-inspector-nav": settings.rightPanelCollapsed ? "panel-right-open" : "panel-right-close",
  };
  const statusRight = `${settings.colourFormat.toUpperCase()} - Snap ${settings.snapEnabled ? "on" : "off"} - Grid ${settings.showGrid ? `${settings.gridSize}px` : "off"}${doc?.selectionRect ? " - Selection on" : ""}`;

  if (!doc) {
    const navDisabled = Object.fromEntries(EMPTY_DOC_DISABLED_NAV_IDS.map((id) => [id, true]));
    return {
      hasDocument: false,
      activeDocMeta: "No canvas open",
      zoomReadout: `${settings.defaultZoom}%`,
      statusRight,
      saveProjectLabel: "Save project",
      floatingChip: getCanvasFloatingChipText({ quickMaskActive, activeTool: settings.activeTool, activeShapeKind }),
      quickMaskActive,
      undoDisabled: true,
      redoDisabled: true,
      navDisabled,
      navLabels,
      navIcons,
    };
  }

  const canWarp = activeLayer?.type === "raster";
  const canRasterize = !!activeLayer && activeLayer.type !== "raster" && activeLayer.type !== "adjustment" && !activeLayer.isBackground;
  const navDisabled: Record<string, boolean> = {
    "duplicate-document-nav": false,
    "save-project-nav": false,
    "save-project-as-nav": false,
    "export-image-nav": false,
    "rename-canvas-nav": false,
    "resize-canvas-nav": false,
    "reset-view-nav": false,
    "select-all-nav": false,
    "deselect-nav": !doc.selectionRect,
    "invert-selection-nav": false,
    "brightness-contrast-nav": false,
    "hue-saturation-nav": false,
    "lut-nav": false,
    "gradient-map-nav": false,
    "curves-nav": false,
    "levels-nav": false,
    "gaussian-blur-nav": false,
    "sharpen-nav": false,
    "color-balance-nav": false,
    "motion-blur-nav": false,
    "add-noise-nav": false,
    "reduce-noise-nav": false,
    "warp-nav": !canWarp,
    "liquify-nav": !canWarp,
    "add-adj-brightness-contrast-nav": false,
    "add-adj-hue-saturation-nav": false,
    "add-adj-levels-nav": false,
    "add-adj-curves-nav": false,
    "add-adj-color-balance-nav": false,
    "add-adj-gradient-map-nav": false,
    "convert-to-smart-object-nav": !(activeLayer?.type === "raster" && !activeLayer.isBackground),
    "rasterize-layer-nav": !canRasterize,
    "align-left-nav": false,
    "align-right-nav": false,
    "align-top-nav": false,
    "align-bottom-nav": false,
    "align-center-h-nav": false,
    "align-center-v-nav": false,
    "distribute-h-nav": selectedLayerCount < 3,
    "distribute-v-nav": selectedLayerCount < 3,
    "align-to-canvas-nav": false,
    "color-range-nav": false,
    "refine-edge-nav": !doc.selectionMask,
    "quick-mask-nav": false,
  };
  return {
    hasDocument: true,
    activeDocMeta: `${doc.width} x ${doc.height} px - ${doc.layers.length} layers${doc.selectionRect ? ` - ${doc.selectionInverted ? "inverted " : ""}selection ${formatSelectionDimension(doc.selectionRect.width)}x${formatSelectionDimension(doc.selectionRect.height)}` : ""}${doc.dirty ? " - unsaved" : ""}`,
    zoomReadout: `${doc.zoom}%`,
    statusRight,
    saveProjectLabel: doc.projectPath ? "Save project" : "Save project as",
    floatingChip: getCanvasFloatingChipText({ quickMaskActive, activeTool: settings.activeTool, activeShapeKind }),
    quickMaskActive,
    undoDisabled: doc.undoStack.length === 0,
    redoDisabled: doc.redoStack.length === 0,
    navDisabled,
    navLabels,
    navIcons,
  };
}

export interface WorkspaceShellControllerDeps {
  canvasStage: HTMLElement;
  canvasWrap: HTMLElement;
  getSettings: () => VisionSettings;
  applySettings: (next: VisionSettings) => Promise<void>;
  persistSettings: (next: VisionSettings, message?: string) => Promise<void>;
  getDocuments: () => DocumentState[];
  getActiveDocument: () => DocumentState | null;
  getActiveDocumentId: () => string | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getSelectedLayerCount: (doc: DocumentState) => number;
  getActiveShapeKind: () => ShapeKind;
  getMarqueeSides: () => number;
  getEffectiveMarqueeMode: () => SelectionMode;
  getTransformMode: () => TransformMode;
  isQuickMaskActive: () => boolean;
  getTransformDraftLayerId: () => string | null;
  syncTransformInputs: () => void;
  cancelTransformDraft: (showMessage?: boolean) => void;
  commitTransformDraft: () => void;
  setMarqueeSides: (sides: number) => void;
  setMarqueeMode: (mode: SelectionMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  renderCanvas: () => void;
  renderLayers: (doc: DocumentState) => void;
  renderHistory: (doc: DocumentState) => void;
  renderInspector: (doc: DocumentState) => void;
  renderRecentMenus: () => void;
  onActivateDocument: (documentId: string) => void;
  onCloseDocument: (documentId: string) => Promise<void>;
  onToolChanged: (tool: ActiveTool) => void;
  emitWorkspaceEvent: (name: string, detail: Record<string, unknown>) => void;
  onAppNavSelect: (id: string) => Promise<void>;
  getBrushUiState: () => { brushSize: number; brushOpacity: number; activeColour: string };
  configureAutosaveTimer: () => void;
  openDebugLogFolder: () => Promise<void>;
  getDebugLogPath: () => string;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  setTheme: (theme: UiTheme) => Promise<void>;
}

export interface WorkspaceShellController {
  bind: () => void;
  syncFromSettings: () => void;
  renderEditorState: () => void;
  renderBrushUI: () => void;
  renderToolState: () => void;
  renderSettingsUI: () => void;
  updateToolTooltips: () => void;
  toggleWindowPanel: (panel: "left" | "right") => Promise<void>;
}

export function createWorkspaceShellController(deps: WorkspaceShellControllerDeps): WorkspaceShellController {
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

  function syncThemeMenuIcons(theme: UiTheme) {
    const themes: UiTheme[] = ["goblin", "dark", "light"];
    for (const t of themes) {
      const el = document.querySelector<HTMLElement>(`[data-nav-id="set-theme-${t}"] [data-lucide]`);
      if (el) {
        el.setAttribute("data-lucide", t === theme ? "circle-dot" : "circle");
      }
    }
  }

  function renderTabs(activeTab: AppTab) {
    topTabs?.activate(activeTab);
  }

  function renderDebugLoggingUI() {
    const settings = deps.getSettings();
    byId<HTMLInputElement>("debug-logging-checkbox").checked = settings.debugLoggingEnabled;
    byId<HTMLElement>("debug-log-path").textContent = settings.debugLoggingEnabled
      ? `Debug logs: ${deps.getDebugLogPath()}`
      : "Debug logs are disabled.";
    byId<HTMLInputElement>("autosave-enabled-checkbox").checked = settings.autosaveEnabled;
    byId<HTMLInputElement>("autosave-interval-input").value = String(settings.autosaveIntervalSeconds);
  }

  function renderDocumentTabs() {
    renderDocumentTabsView({
      tabs: byId<HTMLElement>("document-tabs"),
      documents: deps.getDocuments(),
      activeDocumentId: deps.getActiveDocumentId() ?? "",
      onActivate: deps.onActivateDocument,
      onClose: (documentId) => {
        void deps.onCloseDocument(documentId);
      },
    });
    applyIcons();
  }

  function updateBrushUI() {
    const brushUiState = deps.getBrushUiState();
    updateBrushUIView({
      brushSize: brushUiState.brushSize,
      brushOpacity: brushUiState.brushOpacity,
      activeColour: brushUiState.activeColour,
      brushSizeInput: byId<HTMLInputElement>("brush-size-range"),
      brushOpacityInput: byId<HTMLInputElement>("brush-opacity-range"),
      brushColourValue: byId<HTMLElement>("brush-colour-value"),
      primarySwatch: byId<HTMLElement>("palette-primary-swatch"),
    });
  }

  function applyCanvasPreferences(doc: DocumentState | null) {
    const settings = deps.getSettings();
    const workspace = document.querySelector(".editor-workspace") as HTMLElement;
    workspace.style.setProperty("--left-panel-width", `${settings.leftPanelWidth}px`);
    workspace.style.setProperty("--right-panel-width", `${settings.rightPanelWidth}px`);
    workspace.classList.toggle("left-collapsed", settings.leftPanelCollapsed);
    workspace.classList.toggle("right-collapsed", settings.rightPanelCollapsed);
    deps.canvasStage.classList.toggle("checkerboard-on", settings.showCheckerboard);

    const shellState = buildWorkspaceShellState({
      settings,
      doc,
      activeLayer: doc ? deps.getActiveLayer(doc) : null,
      selectedLayerCount: doc ? deps.getSelectedLayerCount(doc) : 0,
      quickMaskActive: deps.isQuickMaskActive(),
      activeShapeKind: deps.getActiveShapeKind(),
    });
    byId<HTMLElement>("status-right").textContent = shellState.statusRight;
    Object.entries(shellState.navLabels).forEach(([id, label]) => setNavOptionLabel(id, label));
    Object.entries(shellState.navIcons).forEach(([id, icon]) => setNavOptionIcon(id, icon));
  }

  function renderToolState() {
    const settings = deps.getSettings();
    renderToolStateView({
      activeTool: settings.activeTool,
      toolCopy: TOOL_COPY,
      canvasWrap: deps.canvasWrap,
      activeToolCopy: byId<HTMLElement>("active-tool-copy"),
      brushSizeField: byId<HTMLElement>("brush-size-field"),
      brushOpacityField: byId<HTMLElement>("brush-opacity-field"),
      brushColourField: byId<HTMLElement>("brush-colour-field"),
      healingToolHint: byId<HTMLElement>("healing-tool-hint"),
      textToolHint: byId<HTMLElement>("text-tool-hint"),
      shapeToolHint: byId<HTMLElement>("shape-tool-hint"),
      shapeKindField: byId<HTMLElement>("shape-kind-field"),
      cropToolHint: byId<HTMLElement>("crop-tool-hint"),
      marqueeToolHint: byId<HTMLElement>("marquee-tool-hint"),
      marqueeShapeField: byId<HTMLElement>("marquee-shape-field"),
      marqueeModeField: byId<HTMLElement>("marquee-mode-field"),
      transformToolHint: byId<HTMLElement>("transform-tool-hint"),
      transformModeField: byId<HTMLElement>("transform-mode-field"),
      transformControlsField: byId<HTMLElement>("transform-controls-field"),
      lassoToolHint: byId<HTMLElement>("lasso-tool-hint"),
      lassoModeField: byId<HTMLElement>("lasso-mode-field"),
      polygonLassoToolHint: byId<HTMLElement>("polygon-lasso-tool-hint"),
      polygonLassoModeField: byId<HTMLElement>("polygon-lasso-mode-field"),
      magicWandToolHint: byId<HTMLElement>("magic-wand-tool-hint"),
      magicWandModeField: byId<HTMLElement>("magic-wand-mode-field"),
      magicWandSettings: byId<HTMLElement>("magic-wand-settings"),
      toolSettingsEmpty: byId<HTMLElement>("tool-settings-empty"),
    });
    const sidesSlider = document.getElementById("marquee-sides-slider") as HTMLInputElement | null;
    const sidesLabel = document.getElementById("marquee-sides-label");
    const marqueeSides = deps.getMarqueeSides();
    if (sidesSlider) sidesSlider.value = String(marqueeSides);
    if (sidesLabel) sidesLabel.textContent = SHAPE_NAMES[marqueeSides] ?? String(marqueeSides);
    const shapeKindSelect = document.getElementById("shape-kind-select") as HTMLSelectElement | null;
    if (shapeKindSelect) shapeKindSelect.value = deps.getActiveShapeKind();
    document.querySelectorAll<HTMLElement>("[data-selection-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-selection-mode") === deps.getEffectiveMarqueeMode());
    });
    document.querySelectorAll<HTMLElement>("[data-transform-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-transform-mode") === deps.getTransformMode());
    });
  }

  function handleKeybindingCapture(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement;
    const commandId = input.dataset.commandId ?? "";
    const settings = deps.getSettings();

    if (event.key === "Escape") {
      void deps.persistSettings({
        ...settings,
        keybindings: { ...settings.keybindings, [commandId]: "" },
      });
      return;
    }

    const shortcut = formatShortcutFromKeyboardEvent(event);
    if (!shortcut) {
      return;
    }

    void deps.persistSettings({
      ...settings,
      keybindings: { ...settings.keybindings, [commandId]: shortcut },
    });
  }

  function renderKeybindingsUI() {
    const grid = document.getElementById("keybindings-grid");
    if (!grid) return;
    const settings = deps.getSettings();
    grid.innerHTML = "";
    for (const [id, label] of Object.entries(KEYBINDING_LABELS)) {
      const row = document.createElement("div");
      row.className = "keybinding-row";
      const lbl = document.createElement("label");
      lbl.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.readOnly = true;
      input.value = settings.keybindings[id] ?? "";
      input.dataset.commandId = id;
      input.addEventListener("keydown", handleKeybindingCapture);
      row.appendChild(lbl);
      row.appendChild(input);
      grid.appendChild(row);
    }
  }

  function renderSettingsUI() {
    renderSettingsUIView(deps.getSettings());
    renderKeybindingsUI();
  }

  function updateToolTooltips() {
    const settings = deps.getSettings();
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      const tool = button.dataset.tool ?? "";
      const shortcut = settings.keybindings[`tool-${tool}`];
      const baseName = button.getAttribute("aria-label")?.replace(/\s*\(.*\)$/, "") ?? tool;
      const title = getToolTooltipLabel(baseName, shortcut);
      button.title = title;
      button.setAttribute("aria-label", title);
    });
  }

  function applyShellState(shellState: WorkspaceShellState) {
    byId<HTMLElement>("active-doc-meta").textContent = shellState.activeDocMeta;
    byId<HTMLElement>("zoom-readout").textContent = shellState.zoomReadout;
    byId<HTMLElement>("canvas-floating-chip").textContent = shellState.floatingChip;
    byId<HTMLButtonElement>("undo-btn").disabled = shellState.undoDisabled;
    byId<HTMLButtonElement>("redo-btn").disabled = shellState.redoDisabled;
    setNavOptionLabel("save-project-nav-label", shellState.saveProjectLabel);
    Object.entries(shellState.navDisabled).forEach(([id, disabled]) => setNavOptionDisabled(id, disabled));
    deps.canvasWrap.classList.toggle("quick-mask-active", shellState.quickMaskActive);
  }

  function renderEditorState() {
    const settings = deps.getSettings();
    const documents = deps.getDocuments();
    const emptyState = byId<HTMLElement>("empty-state");
    const layerList = byId<HTMLElement>("layer-list");
    const historyList = byId<HTMLElement>("history-list");

    renderDocumentTabs();
    setNavOptionLabel("checkerboard-nav-label", settings.showCheckerboard ? "Hide checkerboard" : "Show checkerboard");
    setNavOptionLabel("grid-nav-label", settings.showGrid ? "Hide pixel grid" : "Show pixel grid");
    setNavOptionLabel("snap-nav-label", settings.snapEnabled ? "Disable snap" : "Enable snap");

    if (documents.length === 0) {
      emptyState.hidden = false;
      deps.canvasStage.hidden = true;
      layerList.innerHTML = "";
      historyList.innerHTML = "";
      renderToolState();
      updateBrushUI();
      applyCanvasPreferences(null);
      renderDebugLoggingUI();
      deps.renderRecentMenus();
      applyShellState(buildWorkspaceShellState({
        settings,
        doc: null,
        activeLayer: null,
        selectedLayerCount: 0,
        quickMaskActive: deps.isQuickMaskActive(),
        activeShapeKind: deps.getActiveShapeKind(),
      }));
      syncThemeMenuIcons(settings.uiTheme);
      applyIcons();
      return;
    }

    emptyState.hidden = true;
    deps.canvasStage.hidden = false;
    const doc = deps.getActiveDocument();
    if (!doc) {
      return;
    }
    const activeTransformDraftLayerId = deps.getTransformDraftLayerId();
    if (activeTransformDraftLayerId && !doc.layers.some((layer) => layer.id === activeTransformDraftLayerId)) {
      deps.cancelTransformDraft(false);
    }
    deps.syncTransformInputs();

    renderToolState();
    deps.renderLayers(doc);
    deps.renderHistory(doc);
    deps.renderInspector(doc);
    updateBrushUI();
    applyCanvasPreferences(doc);
    deps.renderCanvas();
    renderDebugLoggingUI();
    deps.renderRecentMenus();

    applyShellState(buildWorkspaceShellState({
      settings,
      doc,
      activeLayer: deps.getActiveLayer(doc),
      selectedLayerCount: deps.getSelectedLayerCount(doc),
      quickMaskActive: deps.isQuickMaskActive(),
      activeShapeKind: deps.getActiveShapeKind(),
    }));
    syncThemeMenuIcons(settings.uiTheme);
    applyIcons();
  }

  function syncFromSettings() {
    renderTabs(deps.getSettings().lastTab);
    renderSettingsUI();
    renderEditorState();
  }

  async function toggleWindowPanel(panel: "left" | "right") {
    const settings = deps.getSettings();
    const nextSettings = panel === "left"
      ? { ...settings, leftPanelCollapsed: !settings.leftPanelCollapsed }
      : { ...settings, rightPanelCollapsed: !settings.rightPanelCollapsed };
    await deps.persistSettings(nextSettings);
  }

  function bindTabNavigation() {
    topTabs = bindTabs({
      onChange: (tabId) => {
        const nextTab = tabId as AppTab;
        if (deps.getSettings().lastTab === nextTab) {
          return;
        }
        void deps.persistSettings({ ...deps.getSettings(), lastTab: nextTab });
        deps.emitWorkspaceEvent("tab-changed", { tab: nextTab });
      },
    });
  }

  function bindAppNavigation() {
    bindNavigation({
      root: byId<HTMLElement>("app-nav"),
      onSelect: (id) => {
        void deps.onAppNavSelect(id);
      },
    });
  }

  function bindToolSelection() {
    bindToolSelectionView({
      getSettings: deps.getSettings,
      setSettings: async (next) => {
        if (deps.getTransformDraftLayerId() && next.activeTool !== "transform") {
          deps.commitTransformDraft();
        }
        await deps.applySettings(next);
      },
      renderEditorState,
      renderSettingsUI,
      showToast: (message) => deps.showToast(message),
      onToolChanged: deps.onToolChanged,
    });
    const sidesSliderEl = document.getElementById("marquee-sides-slider") as HTMLInputElement | null;
    if (sidesSliderEl) {
      sidesSliderEl.addEventListener("input", () => {
        deps.setMarqueeSides(clamp(parseInt(sidesSliderEl.value, 10) || 4, 3, 32));
      });
    }
    document.querySelectorAll<HTMLButtonElement>("[data-selection-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        deps.setMarqueeMode(button.dataset.selectionMode as SelectionMode);
      });
    });
    document.querySelectorAll<HTMLButtonElement>("[data-transform-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        deps.setTransformMode(button.dataset.transformMode as TransformMode);
      });
    });
  }

  function bindSettingsInputs() {
    bindSettingsInputsView({
      getSettings: deps.getSettings,
      setSettings: deps.applySettings,
      renderEditorState,
      renderSettingsUI,
      showToast: (message) => deps.showToast(message),
    });
    byId<HTMLInputElement>("debug-logging-checkbox").addEventListener("change", async (event) => {
      await deps.persistSettings({
        ...deps.getSettings(),
        debugLoggingEnabled: (event.currentTarget as HTMLInputElement).checked,
      });
    });
    byId<HTMLInputElement>("autosave-enabled-checkbox").addEventListener("change", async (event) => {
      await deps.persistSettings({
        ...deps.getSettings(),
        autosaveEnabled: (event.currentTarget as HTMLInputElement).checked,
      });
      deps.configureAutosaveTimer();
    });
    byId<HTMLInputElement>("autosave-interval-input").addEventListener("change", async (event) => {
      const value = Math.max(10, Math.min(600, Number((event.currentTarget as HTMLInputElement).value) || 60));
      await deps.persistSettings({
        ...deps.getSettings(),
        autosaveIntervalSeconds: value,
      });
      deps.configureAutosaveTimer();
    });
    byId<HTMLButtonElement>("reset-defaults-btn").addEventListener("click", async () => {
      await deps.persistSettings(getDefaultSettings(), "Defaults restored");
    });
    byId<HTMLButtonElement>("reset-keybindings-btn").addEventListener("click", async () => {
      await deps.persistSettings({
        ...deps.getSettings(),
        keybindings: { ...DEFAULT_KEYBINDINGS },
      }, "Keyboard shortcuts restored");
    });
    byId<HTMLButtonElement>("open-debug-folder-btn").addEventListener("click", async () => {
      try {
        await deps.openDebugLogFolder();
        deps.log("Opened debug log folder", "INFO");
      } catch (error) {
        console.error("Failed to open debug logs folder:", error);
        deps.log(`Failed to open debug logs folder: ${String(error)}`, "ERROR");
        byId<HTMLElement>("debug-log-path").textContent = "Could not open debug logs folder.";
      }
    });
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
      const settings = deps.getSettings();
      const leftPanelWidth = parseInt(getComputedStyle(workspace).getPropertyValue("--left-panel-width") || String(settings.leftPanelWidth), 10);
      const rightPanelWidth = parseInt(getComputedStyle(workspace).getPropertyValue("--right-panel-width") || String(settings.rightPanelWidth), 10);
      if (leftPanelWidth === settings.leftPanelWidth && rightPanelWidth === settings.rightPanelWidth) {
        return;
      }
      await deps.persistSettings({
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

  function bind() {
    bindTabNavigation();
    bindAppNavigation();
    bindToolSelection();
    bindSettingsInputs();
    bindPanelResizers();
  }

  return {
    bind,
    syncFromSettings,
    renderEditorState,
    renderBrushUI: updateBrushUI,
    renderToolState,
    renderSettingsUI,
    updateToolTooltips,
    toggleWindowPanel,
  };
}
