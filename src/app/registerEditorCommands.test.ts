import { describe, expect, it, vi } from "vitest";
import { buildEditorCommands, type RegisterEditorCommandsDeps } from "./registerEditorCommands";
import { getDefaultSettings } from "../settings";
import { makeNewDocument } from "../editor/actions/documentActions";

function createDeps(overrides: Partial<RegisterEditorCommandsDeps> = {}): RegisterEditorCommandsDeps {
  const settings = getDefaultSettings();
  const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
  const getActiveDocument = overrides.getActiveDocument ?? (() => doc);

  return {
    getSettings: overrides.getSettings ?? (() => settings),
    getActiveDocument,
    getActiveLayer: overrides.getActiveLayer ?? ((activeDoc) => activeDoc.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? null),
    createNewDocumentFlow: overrides.createNewDocumentFlow ?? vi.fn(),
    handleOpenImage: overrides.handleOpenImage ?? vi.fn(),
    handleOpenProject: overrides.handleOpenProject ?? vi.fn(),
    duplicateActiveDocument: overrides.duplicateActiveDocument ?? vi.fn(),
    tryPasteImageFromClipboard: overrides.tryPasteImageFromClipboard ?? vi.fn(async () => true),
    handleSaveProject: overrides.handleSaveProject ?? vi.fn(),
    handleExportImage: overrides.handleExportImage ?? vi.fn(),
    handleUndo: overrides.handleUndo ?? vi.fn(),
    handleRedo: overrides.handleRedo ?? vi.fn(),
    renameCanvas: overrides.renameCanvas ?? vi.fn(),
    openResizeCanvasModal: overrides.openResizeCanvasModal ?? vi.fn(),
    resetCanvasView: overrides.resetCanvasView ?? vi.fn(),
    toggleCanvasSetting: overrides.toggleCanvasSetting ?? vi.fn(),
    selectEntireCanvas: overrides.selectEntireCanvas ?? vi.fn(),
    clearSelection: overrides.clearSelection ?? vi.fn(),
    invertSelection: overrides.invertSelection ?? vi.fn(),
    deleteSelectedArea: overrides.deleteSelectedArea ?? vi.fn(),
    openColorRangeModal: overrides.openColorRangeModal ?? vi.fn(),
    openRefineEdgeModal: overrides.openRefineEdgeModal ?? vi.fn(),
    toggleQuickMask: overrides.toggleQuickMask ?? vi.fn(),
    openBrightnessContrastModal: overrides.openBrightnessContrastModal ?? vi.fn(),
    openHueSaturationModal: overrides.openHueSaturationModal ?? vi.fn(),
    openGaussianBlurModal: overrides.openGaussianBlurModal ?? vi.fn(),
    openSharpenModal: overrides.openSharpenModal ?? vi.fn(),
    openColorBalanceModal: overrides.openColorBalanceModal ?? vi.fn(),
    openLUTModal: overrides.openLUTModal ?? vi.fn(),
    openGradientMapModal: overrides.openGradientMapModal ?? vi.fn(),
    openCurvesModal: overrides.openCurvesModal ?? vi.fn(),
    openLevelsModal: overrides.openLevelsModal ?? vi.fn(),
    openMotionBlurModal: overrides.openMotionBlurModal ?? vi.fn(),
    openAddNoiseModal: overrides.openAddNoiseModal ?? vi.fn(),
    openReduceNoiseModal: overrides.openReduceNoiseModal ?? vi.fn(),
    openWarpModal: overrides.openWarpModal ?? vi.fn(),
    openLiquifyModal: overrides.openLiquifyModal ?? vi.fn(),
    handleAddAdjustmentLayer: overrides.handleAddAdjustmentLayer ?? vi.fn(),
    handleConvertToSmartObject: overrides.handleConvertToSmartObject ?? vi.fn(),
    handleRasterizeLayer: overrides.handleRasterizeLayer ?? vi.fn(),
    executeAlignment: overrides.executeAlignment ?? vi.fn(),
    toggleAlignTarget: overrides.toggleAlignTarget ?? vi.fn(),
    toggleWindowPanel: overrides.toggleWindowPanel ?? vi.fn(),
    togglePalette: overrides.togglePalette ?? vi.fn(),
    beginRegionSnip: overrides.beginRegionSnip ?? vi.fn(),
    chooseWindowCapture: overrides.chooseWindowCapture ?? vi.fn(),
    captureFullscreen: overrides.captureFullscreen ?? vi.fn(),
    openManagePalettes: overrides.openManagePalettes ?? vi.fn(),
    beginGlobalColourPick: overrides.beginGlobalColourPick ?? vi.fn(),
    clearRecent: overrides.clearRecent ?? vi.fn(),
    switchTool: overrides.switchTool ?? vi.fn(),
    openAiJobs: overrides.openAiJobs ?? vi.fn(),
    openAiSettings: overrides.openAiSettings ?? vi.fn(),
    selectAiSubject: overrides.selectAiSubject ?? vi.fn(),
    selectAiBackground: overrides.selectAiBackground ?? vi.fn(),
    selectAiObjectByPrompt: overrides.selectAiObjectByPrompt ?? vi.fn(),
    removeAiBackground: overrides.removeAiBackground ?? vi.fn(),
    removeAiObject: overrides.removeAiObject ?? vi.fn(),
    openAiAutoEnhanceModal: overrides.openAiAutoEnhanceModal ?? vi.fn(),
    runAiUpscale: overrides.runAiUpscale ?? vi.fn(),
    openAiDenoiseModal: overrides.openAiDenoiseModal ?? vi.fn(),
    runAiInpaint: overrides.runAiInpaint ?? vi.fn(),
    runAiOutpaint: overrides.runAiOutpaint ?? vi.fn(),
    openAiStyleTransferModal: overrides.openAiStyleTransferModal ?? vi.fn(),
    openAiRestoreModal: overrides.openAiRestoreModal ?? vi.fn(),
    runAiThumbnail: overrides.runAiThumbnail ?? vi.fn(),
    runAiFreeform: overrides.runAiFreeform ?? vi.fn(),
    setTheme: overrides.setTheme ?? vi.fn(),
  };
}

describe("buildEditorCommands", () => {
  it("disables document commands when no document is active", () => {
    const commands = buildEditorCommands(createDeps({ getActiveDocument: () => null }));
    const save = commands.find((command) => command.id === "save-project");
    const selectAll = commands.find((command) => command.id === "select-all");

    expect(save?.enabled()).toBe(false);
    expect(selectAll?.enabled()).toBe(false);
  });

  it("enables smart object conversion only for non-background raster layers", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const commands = buildEditorCommands(createDeps({ getActiveDocument: () => doc }));
    const convert = commands.find((command) => command.id === "convert-to-smart-object");
    const activeLayer = doc.layers.find((layer) => layer.id === doc.activeLayerId)!;

    expect(convert?.enabled()).toBe(true);
    activeLayer.isBackground = true;
    expect(convert?.enabled()).toBe(false);
  });

  it("includes tool commands with shortcuts from settings", () => {
    const settings = getDefaultSettings();
    settings.keybindings["tool-brush"] = "B";
    const commands = buildEditorCommands(createDeps({ getSettings: () => settings }));
    const brush = commands.find((command) => command.id === "tool-brush");

    expect(brush?.shortcut).toBe("B");
    expect(brush?.category).toBe("tool");
  });

  it("registers AI window commands", () => {
    const commands = buildEditorCommands(createDeps());

    expect(commands.find((command) => command.id === "open-ai-jobs")?.enabled()).toBe(true);
    expect(commands.find((command) => command.id === "open-ai-settings")?.enabled()).toBe(true);
    expect(commands.find((command) => command.id === "ai-auto-enhance")?.enabled()).toBe(true);
  });

  it("assigns ai category to all AI commands", () => {
    const commands = buildEditorCommands(createDeps());
    const aiCommands = commands.filter((c) => c.id.startsWith("ai-") || c.id.startsWith("open-ai-"));
    expect(aiCommands.length).toBe(16);
    for (const cmd of aiCommands) {
      expect(cmd.category).toBe("ai");
    }
  });

  it("uses 'AI: ' prefix for all AI command labels", () => {
    const commands = buildEditorCommands(createDeps());
    const aiCommands = commands.filter((c) => c.category === "ai");
    for (const cmd of aiCommands) {
      expect(cmd.label.startsWith("AI: ")).toBe(true);
    }
  });
});
