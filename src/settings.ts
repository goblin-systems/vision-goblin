import { load, type Store } from "@tauri-apps/plugin-store";

export type AppTab = "editor" | "tools" | "settings";
export type ToolName = "move" | "marquee" | "transform" | "crop" | "brush" | "eraser" | "eyedropper" | "smudge" | "clone-stamp" | "healing-brush" | "text" | "shape" | "lasso" | "polygon-lasso" | "magic-wand";
export type ColourFormat = "hex" | "rgb" | "hsl";
export type ExportFormat = "png" | "jpg" | "webp";
export type CaptureDestination = "new-canvas" | "add-layer" | "clipboard";

export interface VisionSettings {
  lastTab: AppTab;
  activeTool: ToolName;
  showCheckerboard: boolean;
  showGrid: boolean;
  gridSize: number;
  snapEnabled: boolean;
  defaultZoom: number;
  colourFormat: ColourFormat;
  exportFormat: ExportFormat;
  exportQuality: number;
  captureDestination: CaptureDestination;
  captureDelaySeconds: number;
  captureHideWindow: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  debugLoggingEnabled: boolean;
  recentImages: string[];
  recentProjects: string[];
  autosaveEnabled: boolean;
  autosaveIntervalSeconds: number;
  confirmLayerDeletion: boolean;
  keybindings: Record<string, string>;
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  "tool-move": "V",
  "tool-marquee": "M",
  "tool-transform": "T",
  "tool-crop": "C",
  "tool-brush": "B",
  "tool-eraser": "E",
  "tool-eyedropper": "I",
  "tool-smudge": "S",
  "tool-clone-stamp": "K",
  "tool-healing-brush": "J",
  "tool-text": "Y",
  "tool-shape": "U",
  "tool-lasso": "L",
  "tool-polygon-lasso": "P",
  "tool-magic-wand": "W",
  "new-document": "Ctrl+N",
  "open-image": "Ctrl+O",
  "open-project": "Ctrl+Shift+O",
  "save-project": "Ctrl+S",
  "save-project-as": "Ctrl+Shift+S",
  "export-image": "Ctrl+E",
  "capture-region": "Ctrl+Shift+4",
  "capture-window": "Ctrl+Shift+6",
  "capture-fullscreen": "Ctrl+Shift+5",
  "pick-from-screen": "Ctrl+Shift+C",
  "undo": "Ctrl+Z",
  "redo": "Ctrl+Y",
  "redo-alt": "Ctrl+Shift+Z",
  "select-all": "Ctrl+A",
  "deselect": "Ctrl+D",
  "invert-selection": "Ctrl+Shift+I",
};

const DEFAULTS: VisionSettings = {
  lastTab: "editor",
  activeTool: "move",
  showCheckerboard: true,
  showGrid: true,
  gridSize: 60,
  snapEnabled: false,
  defaultZoom: 100,
  colourFormat: "hex",
  exportFormat: "png",
  exportQuality: 90,
  captureDestination: "new-canvas",
  captureDelaySeconds: 0,
  captureHideWindow: true,
  leftPanelWidth: 220,
  rightPanelWidth: 260,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  debugLoggingEnabled: false,
  recentImages: [],
  recentProjects: [],
  autosaveEnabled: true,
  autosaveIntervalSeconds: 60,
  confirmLayerDeletion: false,
  keybindings: { ...DEFAULT_KEYBINDINGS },
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return store;
}

export function getDefaultSettings(): VisionSettings {
  return { ...DEFAULTS };
}

export async function loadSettings(): Promise<VisionSettings> {
  const next = getDefaultSettings();
  const s = await getStore();

  const lastTab = await s.get<AppTab>("lastTab");
  if (lastTab === "editor" || lastTab === "tools" || lastTab === "settings") {
    next.lastTab = lastTab;
  }

  const activeTool = await s.get<ToolName>("activeTool");
  if (
    activeTool === "move" ||
    activeTool === "marquee" ||
    activeTool === "transform" ||
    activeTool === "crop" ||
    activeTool === "brush" ||
    activeTool === "eraser" ||
    activeTool === "eyedropper" ||
    activeTool === "smudge" ||
    activeTool === "clone-stamp" ||
    activeTool === "healing-brush" ||
    activeTool === "text" ||
    activeTool === "shape" ||
    activeTool === "lasso" ||
    activeTool === "polygon-lasso" ||
    activeTool === "magic-wand"
  ) {
    next.activeTool = activeTool;
  }

  const showCheckerboard = await s.get<boolean>("showCheckerboard");
  if (typeof showCheckerboard === "boolean") next.showCheckerboard = showCheckerboard;

  const showGrid = await s.get<boolean>("showGrid");
  if (typeof showGrid === "boolean") next.showGrid = showGrid;

  const gridSize = await s.get<number>("gridSize");
  if (typeof gridSize === "number" && gridSize >= 4 && gridSize <= 500) next.gridSize = gridSize;

  const snapEnabled = await s.get<boolean>("snapEnabled");
  if (typeof snapEnabled === "boolean") next.snapEnabled = snapEnabled;

  const defaultZoom = await s.get<number>("defaultZoom");
  if (defaultZoom === 50 || defaultZoom === 75 || defaultZoom === 100 || defaultZoom === 150) {
    next.defaultZoom = defaultZoom;
  }

  const colourFormat = await s.get<ColourFormat>("colourFormat");
  if (colourFormat === "hex" || colourFormat === "rgb" || colourFormat === "hsl") {
    next.colourFormat = colourFormat;
  }

  const exportFormat = await s.get<ExportFormat>("exportFormat");
  if (exportFormat === "png" || exportFormat === "jpg" || exportFormat === "webp") {
    next.exportFormat = exportFormat;
  }

  const exportQuality = await s.get<number>("exportQuality");
  if (typeof exportQuality === "number" && exportQuality >= 50 && exportQuality <= 100) {
    next.exportQuality = exportQuality;
  }

  const captureDestination = await s.get<CaptureDestination>("captureDestination");
  if (captureDestination === "new-canvas" || captureDestination === "add-layer" || captureDestination === "clipboard") {
    next.captureDestination = captureDestination;
  }

  const captureDelaySeconds = await s.get<number>("captureDelaySeconds");
  if (captureDelaySeconds === 0 || captureDelaySeconds === 3 || captureDelaySeconds === 5) {
    next.captureDelaySeconds = captureDelaySeconds;
  }

  const captureHideWindow = await s.get<boolean>("captureHideWindow");
  if (typeof captureHideWindow === "boolean") {
    next.captureHideWindow = captureHideWindow;
  }

  const leftPanelWidth = await s.get<number>("leftPanelWidth");
  if (typeof leftPanelWidth === "number" && leftPanelWidth >= 180 && leftPanelWidth <= 360) {
    next.leftPanelWidth = leftPanelWidth;
  }

  const rightPanelWidth = await s.get<number>("rightPanelWidth");
  if (typeof rightPanelWidth === "number" && rightPanelWidth >= 220 && rightPanelWidth <= 420) {
    next.rightPanelWidth = rightPanelWidth;
  }

  const leftPanelCollapsed = await s.get<boolean>("leftPanelCollapsed");
  if (typeof leftPanelCollapsed === "boolean") next.leftPanelCollapsed = leftPanelCollapsed;

  const rightPanelCollapsed = await s.get<boolean>("rightPanelCollapsed");
  if (typeof rightPanelCollapsed === "boolean") next.rightPanelCollapsed = rightPanelCollapsed;

  const debugLoggingEnabled = await s.get<boolean>("debugLoggingEnabled");
  if (typeof debugLoggingEnabled === "boolean") next.debugLoggingEnabled = debugLoggingEnabled;

  const recentImages = await s.get<string[]>("recentImages");
  if (Array.isArray(recentImages)) next.recentImages = recentImages.filter((item): item is string => typeof item === "string").slice(0, 8);

  const recentProjects = await s.get<string[]>("recentProjects");
  if (Array.isArray(recentProjects)) next.recentProjects = recentProjects.filter((item): item is string => typeof item === "string").slice(0, 8);

  const autosaveEnabled = await s.get<boolean>("autosaveEnabled");
  if (typeof autosaveEnabled === "boolean") next.autosaveEnabled = autosaveEnabled;

  const autosaveIntervalSeconds = await s.get<number>("autosaveIntervalSeconds");
  if (typeof autosaveIntervalSeconds === "number" && autosaveIntervalSeconds >= 10 && autosaveIntervalSeconds <= 600) {
    next.autosaveIntervalSeconds = autosaveIntervalSeconds;
  }

  const confirmLayerDeletion = await s.get<boolean>("confirmLayerDeletion");
  if (typeof confirmLayerDeletion === "boolean") next.confirmLayerDeletion = confirmLayerDeletion;

  const keybindings = await s.get<Record<string, string>>("keybindings");
  if (keybindings && typeof keybindings === "object" && !Array.isArray(keybindings)) {
    next.keybindings = { ...DEFAULT_KEYBINDINGS };
    for (const [key, value] of Object.entries(keybindings)) {
      if (typeof value === "string" && key in DEFAULT_KEYBINDINGS) {
        next.keybindings[key] = value;
      }
    }
  }

  return next;
}

export async function saveSettings(settings: VisionSettings): Promise<void> {
  const s = await getStore();
  await s.set("lastTab", settings.lastTab);
  await s.set("activeTool", settings.activeTool);
  await s.set("showCheckerboard", settings.showCheckerboard);
  await s.set("showGrid", settings.showGrid);
  await s.set("gridSize", settings.gridSize);
  await s.set("snapEnabled", settings.snapEnabled);
  await s.set("defaultZoom", settings.defaultZoom);
  await s.set("colourFormat", settings.colourFormat);
  await s.set("exportFormat", settings.exportFormat);
  await s.set("exportQuality", settings.exportQuality);
  await s.set("captureDestination", settings.captureDestination);
  await s.set("captureDelaySeconds", settings.captureDelaySeconds);
  await s.set("captureHideWindow", settings.captureHideWindow);
  await s.set("leftPanelWidth", settings.leftPanelWidth);
  await s.set("rightPanelWidth", settings.rightPanelWidth);
  await s.set("leftPanelCollapsed", settings.leftPanelCollapsed);
  await s.set("rightPanelCollapsed", settings.rightPanelCollapsed);
  await s.set("debugLoggingEnabled", settings.debugLoggingEnabled);
  await s.set("recentImages", settings.recentImages);
  await s.set("recentProjects", settings.recentProjects);
  await s.set("autosaveEnabled", settings.autosaveEnabled);
  await s.set("autosaveIntervalSeconds", settings.autosaveIntervalSeconds);
  await s.set("confirmLayerDeletion", settings.confirmLayerDeletion);
  await s.set("keybindings", settings.keybindings);
  await s.save();
}
