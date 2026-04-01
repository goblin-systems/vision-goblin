import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_AI_SETTINGS, cloneAiSettings, normalizeAiSettings, type AiSettings } from "./app/ai/config";
import { isUiTheme, type UiTheme } from "./app/theme";

export type AppTab = "editor" | "settings";
export type ToolName = "move" | "marquee" | "transform" | "crop" | "brush" | "eraser" | "eyedropper" | "smudge" | "clone-stamp" | "healing-brush" | "text" | "shape" | "lasso" | "polygon-lasso" | "magic-wand";
export type ColourFormat = "hex" | "rgb" | "hsl";
export type ExportFormat = "png" | "jpg" | "webp";
export type CaptureDestination = "new-canvas" | "add-layer" | "clipboard";

export interface ColourPalette {
  id: string;
  name: string;
  colours: string[];
}

export const DEFAULT_PALETTES: ColourPalette[] = [
  {
    id: "goblin-neon",
    name: "Goblin Neon",
    colours: ["#6C63FF", "#1A1A2E", "#4ADE80", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7", "#EC4899", "#14B8A6", "#F97316"],
  },
  {
    id: "earth-tones",
    name: "Earth Tones",
    colours: ["#8B5E3C", "#F5F0EB", "#C4956A", "#D4A574", "#6B7B3A", "#A0522D", "#DEB887", "#556B2F", "#CD853F", "#8FBC8F"],
  },
  {
    id: "pastel-dream",
    name: "Pastel Dream",
    colours: ["#B4A7D6", "#FDFCFB", "#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#E8BAFF", "#FFD1DC", "#C9F0FF"],
  },
  {
    id: "midnight-aurora",
    name: "Midnight Aurora",
    colours: ["#00E5FF", "#0A0E1A", "#00E676", "#7C4DFF", "#FF4081", "#00BFA5", "#FFD740", "#536DFE", "#FF6E40", "#B388FF"],
  },
  {
    id: "sunset-coast",
    name: "Sunset Coast",
    colours: ["#FF6B35", "#1B1B3A", "#F7931E", "#FFCC33", "#FF3366", "#FF7BAC", "#C1440E", "#FFE0B2", "#D4145A", "#FFC107"],
  },
  {
    id: "forest-moss",
    name: "Forest Moss",
    colours: ["#2D6A4F", "#F0F4F0", "#40916C", "#52B788", "#74C69D", "#95D5B2", "#1B4332", "#B7E4C7", "#D8F3DC", "#081C15"],
  },
  {
    id: "retrowave",
    name: "Retrowave",
    colours: ["#FF00FF", "#0D0221", "#FF6EC7", "#8B5CF6", "#06D6A0", "#FFD166", "#EF476F", "#00F5D4", "#F72585", "#7209B7"],
  },
  {
    id: "ink-wash",
    name: "Ink Wash",
    colours: ["#2C2C2C", "#F5F5F0", "#4A4A4A", "#6B6B6B", "#8C8C8C", "#ABABAB", "#C8C8C8", "#E0E0E0", "#1A1A1A", "#D5D5CF"],
  },
];

function clonePalettes(palettes: ColourPalette[]): ColourPalette[] {
  return palettes.map((p) => ({ ...p, colours: [...p.colours] }));
}

function isValidPalette(p: unknown): p is ColourPalette {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    Array.isArray(obj.colours) &&
    obj.colours.every((c: unknown) => typeof c === "string") &&
    obj.colours.length >= 2 &&
    obj.colours.length <= 10
  );
}

/** Migrate old palettes that had separate primary/secondary fields. */
function migratePalette(p: ColourPalette & { primary?: string; secondary?: string }): ColourPalette {
  if (p.primary && p.secondary) {
    const merged = [p.primary, p.secondary, ...p.colours];
    return { id: p.id, name: p.name, colours: merged.slice(0, 10) };
  }
  return p;
}

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
  ai: AiSettings;
  uiTheme: UiTheme;
  palettes: ColourPalette[];
  activePaletteId: string;
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
  ai: cloneAiSettings(DEFAULT_AI_SETTINGS),
  uiTheme: "goblin" as UiTheme,
  palettes: clonePalettes(DEFAULT_PALETTES),
  activePaletteId: "goblin-neon",
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return store;
}

export function getDefaultSettings(): VisionSettings {
  return {
    ...DEFAULTS,
    recentImages: [...DEFAULTS.recentImages],
    recentProjects: [...DEFAULTS.recentProjects],
    keybindings: { ...DEFAULTS.keybindings },
    ai: cloneAiSettings(DEFAULTS.ai),
    palettes: clonePalettes(DEFAULTS.palettes),
  };
}

export async function loadSettings(): Promise<VisionSettings> {
  const next = getDefaultSettings();
  const s = await getStore();

  const lastTab = await s.get<string>("lastTab");
  if (lastTab === "editor" || lastTab === "settings") {
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

  next.ai = normalizeAiSettings(await s.get<unknown>("ai"));

  const uiTheme = await s.get<unknown>("uiTheme");
  if (isUiTheme(uiTheme)) next.uiTheme = uiTheme;

  const palettes = await s.get<unknown[]>("palettes");
  if (Array.isArray(palettes)) {
    const valid = palettes.filter(isValidPalette).map(migratePalette);
    if (valid.length > 0) next.palettes = valid.map((p) => ({ ...p, colours: [...p.colours] }));
  }
  // Merge any new default palettes that aren't in the loaded set
  const loadedIds = new Set(next.palettes.map((p) => p.id));
  for (const dp of DEFAULT_PALETTES) {
    if (!loadedIds.has(dp.id)) {
      next.palettes.push({ ...dp, colours: [...dp.colours] });
    }
  }

  const activePaletteId = await s.get<string>("activePaletteId");
  if (typeof activePaletteId === "string" && next.palettes.some((p) => p.id === activePaletteId)) {
    next.activePaletteId = activePaletteId;
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
  await s.set("ai", settings.ai);
  await s.set("uiTheme", settings.uiTheme);
  await s.set("palettes", settings.palettes);
  await s.set("activePaletteId", settings.activePaletteId);
  await s.save();
}
