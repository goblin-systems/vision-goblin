import type { ToolName, VisionSettings } from "../settings";
import { getSelectedLayerIds } from "../editor/layers";
import type { CommandDefinition } from "../editor/commands";
import type { DocumentState, Layer } from "../editor/types";
import type { UiTheme } from "./theme";

type AlignmentKind = "left" | "right" | "top" | "bottom" | "center-h" | "center-v" | "distribute-h" | "distribute-v";
type AdjustmentLayerKind = "brightness-contrast" | "hue-saturation" | "levels" | "curves" | "color-balance" | "gradient-map";

export interface RegisterEditorCommandsDeps {
  getSettings: () => VisionSettings;
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  createNewDocumentFlow: () => void | Promise<void>;
  handleOpenImage: () => void | Promise<void>;
  handleOpenProject: () => void | Promise<void>;
  duplicateActiveDocument: () => void;
  tryPasteImageFromClipboard: () => Promise<boolean>;
  handleSaveProject: (saveAs: boolean) => void | Promise<void>;
  handleExportImage: () => void | Promise<void>;
  handleUndo: () => void | Promise<void>;
  handleRedo: () => void | Promise<void>;
  renameCanvas: () => void | Promise<void>;
  openResizeCanvasModal: () => void;
  resetCanvasView: () => void;
  toggleCanvasSetting: (key: "showCheckerboard" | "showGrid" | "snapEnabled", enabledLabel: string, disabledLabel: string) => void | Promise<void>;
  selectEntireCanvas: () => void;
  clearSelection: (showMessage?: boolean) => void;
  invertSelection: () => void;
  deleteSelectedArea: () => void;
  openColorRangeModal: () => void;
  openRefineEdgeModal: () => void;
  toggleQuickMask: () => void;
  openBrightnessContrastModal: () => void;
  openHueSaturationModal: () => void;
  openGaussianBlurModal: () => void;
  openSharpenModal: () => void;
  openColorBalanceModal: () => void;
  openLUTModal: () => void;
  openGradientMapModal: () => void;
  openCurvesModal: () => void;
  openLevelsModal: () => void;
  openMotionBlurModal: () => void;
  openAddNoiseModal: () => void;
  openReduceNoiseModal: () => void;
  openWarpModal: () => void;
  openLiquifyModal: () => void;
  handleAddAdjustmentLayer: (kind: AdjustmentLayerKind) => void;
  handleConvertToSmartObject: () => void;
  handleRasterizeLayer: () => void;
  executeAlignment: (kind: AlignmentKind) => void;
  toggleAlignTarget: () => void;
  toggleWindowPanel: (side: "left" | "right") => void | Promise<void>;
  togglePalette: () => void;
  beginRegionSnip: () => void | Promise<void>;
  chooseWindowCapture: () => void | Promise<void>;
  captureFullscreen: () => void | Promise<void>;
  openManagePalettes: () => void;
  beginGlobalColourPick: () => void | Promise<void>;
  clearRecent: () => void | Promise<void>;
  switchTool: (tool: ToolName) => void | Promise<void>;
  openAiJobs: () => void | Promise<void>;
  openAiSettings: () => void | Promise<void>;
  selectAiSubject: () => void | Promise<void>;
  selectAiBackground: () => void | Promise<void>;
  selectAiObjectByPrompt: () => void | Promise<void>;
  removeAiBackground: () => void | Promise<void>;
  removeAiObject: () => void | Promise<void>;
  openAiAutoEnhanceModal: () => void | Promise<void>;
  runAiUpscale: () => void | Promise<void>;
  openAiDenoiseModal: () => void | Promise<void>;
  runAiInpaint: () => void | Promise<void>;
  runAiOutpaint: () => void | Promise<void>;
  openAiStyleTransferModal: () => void | Promise<void>;
  openAiRestoreModal: () => void | Promise<void>;
  runAiThumbnail: () => void | Promise<void>;
  runAiFreeform: () => void | Promise<void>;
  setTheme: (theme: UiTheme) => void | Promise<void>;
}

const TOOL_LABELS: Record<ToolName, string> = {
  move: "Move",
  marquee: "Marquee",
  transform: "Transform",
  crop: "Crop",
  brush: "Brush",
  eraser: "Eraser",
  fill: "Fill",
  gradient: "Gradient",
  eyedropper: "Eyedropper",
  smudge: "Smudge",
  "clone-stamp": "Clone stamp",
  "healing-brush": "Healing brush",
  text: "Text",
  shape: "Shape",
  lasso: "Lasso",
  "polygon-lasso": "Polygon lasso",
  "magic-wand": "Magic wand",
};

export function buildEditorCommands(deps: RegisterEditorCommandsDeps): CommandDefinition[] {
  const hasDoc = () => !!deps.getActiveDocument();
  const hasSelection = () => {
    const doc = deps.getActiveDocument();
    return !!doc?.selectionRect;
  };
  const getActiveRasterCandidate = () => {
    const doc = deps.getActiveDocument();
    return doc ? deps.getActiveLayer(doc) : null;
  };

  const commands: CommandDefinition[] = [
    { id: "new-document", label: "New document", category: "file", enabled: () => true, execute: () => void deps.createNewDocumentFlow() },
    { id: "open-image", label: "Open image", category: "file", enabled: () => true, execute: () => void deps.handleOpenImage() },
    { id: "open-project", label: "Open project", category: "file", enabled: () => true, execute: () => void deps.handleOpenProject() },
    { id: "duplicate-document", label: "Duplicate document", category: "file", enabled: hasDoc, execute: () => deps.duplicateActiveDocument() },
    { id: "paste-image", label: "Paste image", category: "file", enabled: () => true, execute: async () => {
      const pasted = await deps.tryPasteImageFromClipboard();
      if (!pasted) return;
    } },
    { id: "save-project", label: "Save project", category: "file", enabled: hasDoc, execute: () => void deps.handleSaveProject(false) },
    { id: "save-project-as", label: "Save project as", category: "file", enabled: hasDoc, execute: () => void deps.handleSaveProject(true) },
    { id: "export-image", label: "Export image", category: "file", enabled: hasDoc, execute: () => void deps.handleExportImage() },
    { id: "clear-recent", label: "Clear recent", category: "file", enabled: () => {
      const settings = deps.getSettings();
      return settings.recentImages.length > 0 || settings.recentProjects.length > 0;
    }, execute: () => void deps.clearRecent() },

    { id: "undo", label: "Undo", category: "edit", enabled: () => {
      const doc = deps.getActiveDocument();
      return !!(doc && doc.undoStack.length > 0);
    }, execute: () => void deps.handleUndo() },
    { id: "redo", label: "Redo", category: "edit", enabled: () => {
      const doc = deps.getActiveDocument();
      return !!(doc && doc.redoStack.length > 0);
    }, execute: () => void deps.handleRedo() },
    { id: "redo-alt", label: "Redo", category: "edit", enabled: () => {
      const doc = deps.getActiveDocument();
      return !!(doc && doc.redoStack.length > 0);
    }, execute: () => void deps.handleRedo() },

    { id: "rename-canvas", label: "Rename canvas", category: "canvas", enabled: hasDoc, execute: () => void deps.renameCanvas() },
    { id: "resize-canvas", label: "Resize canvas", category: "canvas", enabled: hasDoc, execute: () => deps.openResizeCanvasModal() },
    { id: "reset-view", label: "Reset view", category: "canvas", enabled: hasDoc, execute: () => deps.resetCanvasView() },
    { id: "toggle-checkerboard", label: "Toggle checkerboard", category: "canvas", enabled: () => true, execute: () => void deps.toggleCanvasSetting("showCheckerboard", "Checkerboard on", "Checkerboard off") },
    { id: "toggle-grid", label: "Toggle grid", category: "canvas", enabled: () => true, execute: () => void deps.toggleCanvasSetting("showGrid", "Grid on", "Grid off") },
    { id: "toggle-snap", label: "Toggle snap", category: "canvas", enabled: () => true, execute: () => void deps.toggleCanvasSetting("snapEnabled", "Snap on", "Snap off") },

    { id: "select-all", label: "Select all", category: "select", enabled: hasDoc, execute: () => deps.selectEntireCanvas() },
    { id: "deselect", label: "Deselect", category: "select", enabled: hasSelection, execute: () => deps.clearSelection(true) },
    { id: "invert-selection", label: "Invert selection", category: "select", enabled: hasDoc, execute: () => deps.invertSelection() },
    { id: "delete-selection", label: "Delete selected area", category: "select", enabled: hasSelection, execute: () => deps.deleteSelectedArea() },
    { id: "color-range", label: "Select by Color Range", category: "select", enabled: hasDoc, execute: () => deps.openColorRangeModal() },
    { id: "refine-edge", label: "Refine Edge", category: "select", enabled: hasSelection, execute: () => deps.openRefineEdgeModal() },
    { id: "toggle-quick-mask", label: "Quick Mask Mode", shortcut: "Q", category: "select", enabled: hasDoc, execute: () => deps.toggleQuickMask() },
    { id: "ai-select-subject", label: "AI: Select Subject", category: "ai", enabled: hasDoc, execute: () => void deps.selectAiSubject() },
    { id: "ai-select-background", label: "AI: Select Background", category: "ai", enabled: hasDoc, execute: () => void deps.selectAiBackground() },
    { id: "ai-select-object", label: "AI: Select Object by Prompt", category: "ai", enabled: hasDoc, execute: () => void deps.selectAiObjectByPrompt() },

    { id: "brightness-contrast", label: "Brightness / Contrast", category: "adjust", enabled: hasDoc, execute: () => deps.openBrightnessContrastModal() },
    { id: "hue-saturation", label: "Hue / Saturation", category: "adjust", enabled: hasDoc, execute: () => deps.openHueSaturationModal() },
    { id: "gaussian-blur", label: "Gaussian blur", category: "adjust", enabled: hasDoc, execute: () => deps.openGaussianBlurModal() },
    { id: "sharpen", label: "Sharpen", category: "adjust", enabled: hasDoc, execute: () => deps.openSharpenModal() },
    { id: "color-balance", label: "Colour balance", category: "adjust", enabled: hasDoc, execute: () => deps.openColorBalanceModal() },
    { id: "lut", label: "Apply LUT", category: "adjust", enabled: hasDoc, execute: () => deps.openLUTModal() },
    { id: "gradient-map", label: "Gradient map", category: "adjust", enabled: hasDoc, execute: () => deps.openGradientMapModal() },
    { id: "curves", label: "Curves", category: "adjust", enabled: hasDoc, execute: () => deps.openCurvesModal() },
    { id: "levels", label: "Levels", category: "adjust", enabled: hasDoc, execute: () => deps.openLevelsModal() },
    { id: "motion-blur", label: "Motion blur", category: "adjust", enabled: hasDoc, execute: () => deps.openMotionBlurModal() },
    { id: "add-noise", label: "Add noise", category: "adjust", enabled: hasDoc, execute: () => deps.openAddNoiseModal() },
    { id: "reduce-noise", label: "Reduce noise", category: "adjust", enabled: hasDoc, execute: () => deps.openReduceNoiseModal() },
    { id: "warp", label: "Warp", category: "adjust", enabled: hasDoc, execute: () => deps.openWarpModal() },
    { id: "liquify", label: "Liquify", category: "adjust", enabled: hasDoc, execute: () => deps.openLiquifyModal() },
    { id: "ai-remove-background", label: "AI: Remove Background", category: "ai", enabled: hasDoc, execute: () => void deps.removeAiBackground() },
    { id: "ai-remove-object", label: "AI: Remove Object", category: "ai", enabled: hasDoc, execute: () => void deps.removeAiObject() },
    { id: "ai-auto-enhance", label: "AI: Auto Enhance", category: "ai", enabled: hasDoc, execute: () => void deps.openAiAutoEnhanceModal() },
    { id: "ai-upscale", label: "AI: Upscale", category: "ai", enabled: hasDoc, execute: () => void deps.runAiUpscale() },
    { id: "ai-denoise", label: "AI: Denoise", category: "ai", enabled: hasDoc, execute: () => void deps.openAiDenoiseModal() },
    { id: "ai-inpaint", label: "AI: Inpaint Selection", category: "ai", enabled: hasSelection, execute: () => void deps.runAiInpaint() },
    { id: "ai-outpaint", label: "AI: Outpaint Canvas", category: "ai", enabled: hasDoc, execute: () => void deps.runAiOutpaint() },
    { id: "ai-style-transfer", label: "AI: Style Transfer", category: "ai", enabled: hasDoc, execute: () => void deps.openAiStyleTransferModal() },
    { id: "ai-restore-photo", label: "AI: Restore Photo", category: "ai", enabled: hasDoc, execute: () => void deps.openAiRestoreModal() },
    { id: "ai-generate-thumbnail", label: "AI: Generate Thumbnail", category: "ai", enabled: hasDoc, execute: () => void deps.runAiThumbnail() },
    { id: "ai-freeform", label: "AI: Freeform", category: "ai", enabled: hasDoc, execute: () => void deps.runAiFreeform() },

    { id: "add-adj-brightness-contrast", label: "Add Brightness/Contrast layer", category: "layer", enabled: hasDoc, execute: () => deps.handleAddAdjustmentLayer("brightness-contrast") },
    { id: "add-adj-hue-saturation", label: "Add Hue/Saturation layer", category: "layer", enabled: hasDoc, execute: () => deps.handleAddAdjustmentLayer("hue-saturation") },
    { id: "add-adj-levels", label: "Add Levels layer", category: "layer", enabled: hasDoc, execute: () => deps.handleAddAdjustmentLayer("levels") },
    { id: "add-adj-curves", label: "Add Curves layer", category: "layer", enabled: hasDoc, execute: () => deps.handleAddAdjustmentLayer("curves") },
    { id: "add-adj-color-balance", label: "Add Color Balance layer", category: "layer", enabled: hasDoc, execute: () => deps.handleAddAdjustmentLayer("color-balance") },
    { id: "add-adj-gradient-map", label: "Add Gradient Map layer", category: "layer", enabled: hasDoc, execute: () => deps.handleAddAdjustmentLayer("gradient-map") },
    { id: "convert-to-smart-object", label: "Convert to Smart Object", category: "layer", enabled: () => {
      const layer = getActiveRasterCandidate();
      return layer?.type === "raster" && !layer.isBackground;
    }, execute: () => deps.handleConvertToSmartObject() },
    { id: "rasterize-layer", label: "Rasterize Layer", category: "layer", enabled: () => {
      const layer = getActiveRasterCandidate();
      return !!layer && layer.type !== "raster" && layer.type !== "adjustment" && !layer.isBackground;
    }, execute: () => deps.handleRasterizeLayer() },
    { id: "align-left", label: "Align Left", category: "layer", enabled: hasDoc, execute: () => deps.executeAlignment("left") },
    { id: "align-right", label: "Align Right", category: "layer", enabled: hasDoc, execute: () => deps.executeAlignment("right") },
    { id: "align-top", label: "Align Top", category: "layer", enabled: hasDoc, execute: () => deps.executeAlignment("top") },
    { id: "align-bottom", label: "Align Bottom", category: "layer", enabled: hasDoc, execute: () => deps.executeAlignment("bottom") },
    { id: "align-center-h", label: "Align Center Horizontal", category: "layer", enabled: hasDoc, execute: () => deps.executeAlignment("center-h") },
    { id: "align-center-v", label: "Align Center Vertical", category: "layer", enabled: hasDoc, execute: () => deps.executeAlignment("center-v") },
    { id: "distribute-h", label: "Distribute Horizontal", category: "layer", enabled: () => {
      const doc = deps.getActiveDocument();
      return !!doc && getSelectedLayerIds(doc).length >= 3;
    }, execute: () => deps.executeAlignment("distribute-h") },
    { id: "distribute-v", label: "Distribute Vertical", category: "layer", enabled: () => {
      const doc = deps.getActiveDocument();
      return !!doc && getSelectedLayerIds(doc).length >= 3;
    }, execute: () => deps.executeAlignment("distribute-v") },
    { id: "toggle-align-target", label: "Toggle align target", category: "layer", enabled: hasDoc, execute: () => deps.toggleAlignTarget() },

    { id: "toggle-tools-panel", label: "Toggle tools panel", category: "window", enabled: () => true, execute: () => void deps.toggleWindowPanel("left") },
    { id: "toggle-inspector-panel", label: "Toggle inspector panel", category: "window", enabled: () => true, execute: () => void deps.toggleWindowPanel("right") },
    { id: "command-palette", label: "Command Palette", shortcut: "Ctrl+K", category: "window", enabled: () => true, execute: () => deps.togglePalette() },
    { id: "open-ai-jobs", label: "AI: Open Jobs", category: "ai", enabled: () => true, execute: () => void deps.openAiJobs() },
    { id: "open-ai-settings", label: "AI: Open Settings", category: "ai", enabled: () => true, execute: () => void deps.openAiSettings() },

    { id: "manage-palettes", label: "Manage Palettes", category: "tool", enabled: () => true, execute: () => deps.openManagePalettes() },
    { id: "capture-region", label: "Capture region", category: "tool", enabled: () => true, execute: () => void deps.beginRegionSnip() },
    { id: "capture-window", label: "Capture window", category: "tool", enabled: () => true, execute: () => void deps.chooseWindowCapture() },
    { id: "capture-fullscreen", label: "Capture full screen", category: "tool", enabled: () => true, execute: () => void deps.captureFullscreen() },
    { id: "pick-from-screen", label: "Pick colour from screen", category: "tool", enabled: () => true, execute: () => void deps.beginGlobalColourPick() },

    { id: "set-theme-goblin", label: "Theme: Goblin", category: "view", enabled: () => true, execute: () => void deps.setTheme("goblin") },
    { id: "set-theme-dark", label: "Theme: Dark", category: "view", enabled: () => true, execute: () => void deps.setTheme("dark") },
    { id: "set-theme-light", label: "Theme: Light", category: "view", enabled: () => true, execute: () => void deps.setTheme("light") },
  ];

  for (const tool of Object.keys(TOOL_LABELS) as ToolName[]) {
    commands.push({
      id: `tool-${tool}`,
      label: TOOL_LABELS[tool],
      shortcut: deps.getSettings().keybindings[`tool-${tool}`],
      category: "tool",
      enabled: () => true,
      execute: () => void deps.switchTool(tool),
    });
  }

  return commands;
}
