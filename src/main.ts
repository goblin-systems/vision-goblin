import "@goblin-systems/goblin-design-system/style.css";
import "./styles.css";
import {
  closeModal,
  openModal,
  setupWindowControls,
  showToast as showGoblinToast,
} from "@goblin-systems/goblin-design-system";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getDefaultSettings,
  loadSettings,
  saveSettings,
  type ToolName,
  type VisionSettings,
} from "./settings";
import { byId, createAppDom } from "./app/dom";
import { createAdjustmentModalController } from "./app/adjustmentModalController";
import { createCanvasWorkspaceController } from "./app/canvasWorkspaceController";
import { createCaptureController } from "./app/captureController";
import { createDistortModalController } from "./app/distortModalController";
import { createDocumentWorkflowController } from "./app/documentWorkflowController";
import { createDocumentSession } from "./app/documentSession";
import { createEditorInteractionController } from "./app/editorInteractionController";
import { createInspectorController } from "./app/inspectorController";
import { createIoController } from "./app/io";
import { createLayerPanelController } from "./app/layerPanelController";
import { buildEditorCommands } from "./app/registerEditorCommands";
import { createSelectionToolsController } from "./app/selectionToolsController";
import { createWorkspaceShellController, type WorkspaceShellController } from "./app/workspaceShellController";
import { applyTheme } from "./app/theme";
import type { UiTheme } from "./app/theme";
import { createAiController } from "./app/ai/controller";
import { createAiEditingController } from "./app/ai/editingController";
import { configureDebugLogging, debugLog, getDebugLogPath, openDebugLogFolder, saveAiDebugImage } from "./logger";
import { pushHistory } from "./editor/history";
import { getResizeOffset } from "./editor/geometry";
import { addLayer, addAdjustmentLayer, addShapeLayer, addTextLayer, getSelectedLayerIds, setBackgroundLayerColor } from "./editor/layers";
import type { AdjustmentKind, DocumentState, Layer, PointerState, ResizeAnchor } from "./editor/types";
import { createCanvasPointerController } from "./editor/canvasPointer";
import { getLayerContext, resizeCanvasDocument, restoreDocumentFromSnapshot, snapshotDocument, syncLayerSource } from "./editor/documents";
import { clamp } from "./editor/utils";
import { ADJUSTMENT_LABELS } from "./editor/adjustmentLayers";
import { convertToSmartObject } from "./editor/smartObject";
import { alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV, distributeH, distributeV, type AlignTarget } from "./editor/alignment";
import { togglePalette } from "./editor/commandPalette";
import { applySelectionClip, type SelectionMode } from "./editor/selection";
import { registerCommands, executeCommand, applyKeybindings } from "./editor/commands";
import { createSelectionController } from "./editor/selectionController";
import { createTransformController } from "./editor/transformController";
import { createGoblinPersonalityController } from "./app/goblin/personalityController";
import { createPaletteController } from "./app/paletteController";

const documentSession = createDocumentSession();
const documents = documentSession.documents;
const currentWindow = getCurrentWindow();

const dom = createAppDom();
const { editorCanvas, canvasStage, canvasWrap, fileOpenInput } = dom;
const io = createIoController();

let settings = getDefaultSettings();
let maskEditTarget: string | null = null;
let alignTarget: AlignTarget = "selection";
let cloneSource: { x: number; y: number } | null = null;
let workspaceShellController: WorkspaceShellController;
let layerPanelController: ReturnType<typeof createLayerPanelController>;
let canvasWorkspaceController: ReturnType<typeof createCanvasWorkspaceController>;
let aiController: ReturnType<typeof createAiController>;
let aiEditingController: ReturnType<typeof createAiEditingController>;
let goblinPersonalityController: ReturnType<typeof createGoblinPersonalityController>;

const windowSubtitle = document.querySelector<HTMLElement>(".window-subtitle");
if (!windowSubtitle) {
  throw new Error("Missing .window-subtitle element");
}

function renderEditorState() {
  workspaceShellController.renderEditorState();
}

function renderToolState() {
  workspaceShellController.renderToolState();
}

function renderSettingsUI() {
  workspaceShellController.renderSettingsUI();
}

function updateBrushUI() {
  workspaceShellController.renderBrushUI();
}

function renderCanvas() {
  canvasWorkspaceController.renderCanvas();
}

function renderLayers(doc: DocumentState) {
  layerPanelController.renderLayers(doc);
}

function renderHistory(doc: DocumentState) {
  layerPanelController.renderHistory(doc);
}

function emitWorkspaceEvent(name: string, detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(`vision-goblin:${name}`, { detail }));
}

function showToast(message: string, variant: "success" | "error" | "info" = "success") {
  showGoblinToast(message, variant, 2200, "app-toast");
}

function getActiveDocument(): DocumentState | null {
  return documentSession.getActiveDocument();
}

function getActiveLayer(doc: DocumentState): Layer | null {
  return documentSession.getActiveLayer(doc);
}

const selectionController = createSelectionController({
  getActiveDocument,
  getActiveLayer,
  getActiveTool: () => settings.activeTool,
  setActiveTool: (tool) => {
    settings.activeTool = tool;
  },
  renderEditorState,
  renderToolState,
  showToast,
  log: debugLog,
  snapshotDocument,
});

const transformController = createTransformController({
  getActiveDocument,
  getActiveLayer,
  renderEditorState,
  showToast,
  getInput: (id) => byId<HTMLInputElement>(id),
});

let pointerState: PointerState = {
  mode: "none",
  lastDocX: 0,
  lastDocY: 0,
  startDocX: 0,
  startDocY: 0,
  startClientX: 0,
  startClientY: 0,
  startLayerX: 0,
  startLayerY: 0,
  startPanX: 0,
  startPanY: 0,
  startSelectionRect: null,
  startSelectionInverted: false,
  transformHandle: null,
  startLayerWidth: 0,
  startLayerHeight: 0,
  startScaleX: 1,
  startScaleY: 1,
  startCenterX: 0,
  startCenterY: 0,
  startPivotX: 0,
  startPivotY: 0,
  startRotateDeg: 0,
  startSkewXDeg: 0,
  startSkewYDeg: 0,
  cloneOffsetX: 0,
  cloneOffsetY: 0,
  creationLayerId: null,
};

function getEffectiveMarqueeMode(): SelectionMode {
  return selectionController.getEffectiveMarqueeMode();
}

function getCapturedOrEffectiveMode(): SelectionMode {
  return selectionController.getCapturedOrEffectiveMode();
}

function getMarqueeModifiers() {
  return selectionController.getMarqueeModifiers(editorInteractionController.getModifierState());
}

function syncTransformInputs() {
  transformController.syncInputs();
}

function ensureTransformDraft(doc: DocumentState, layer: Layer) {
  return transformController.ensureDraft(doc, layer);
}

function ensureTransformDraftForActiveLayer() {
  return transformController.ensureDraftForActiveLayer();
}

function cancelTransformDraft(showMessage = true) {
  transformController.cancel(showMessage);
}

function commitTransformDraft() {
  transformController.commit();
}

function updateTransformDraftInputs() {
  transformController.updateDraftFromInputs();
}

async function toggleCanvasSetting(key: "showCheckerboard" | "showGrid" | "snapEnabled", enabledLabel: string, disabledLabel: string) {
  const nextValue = !settings[key];
  await persistSettings({ ...settings, [key]: nextValue });
  showToast(nextValue ? enabledLabel : disabledLabel, "info");
}

function completeLassoSelection() {
  selectionController.completeLassoSelection(pointerState.startDocX, pointerState.startDocY);
}

function clearSelection(showMessage = false) {
  selectionController.clearSelection(showMessage);
}

function selectEntireCanvas() {
  selectionController.selectEntireCanvas();
}

function invertSelection() {
  selectionController.invertSelection();
}

function magicWandSelect(docX: number, docY: number) {
  selectionController.magicWandSelect(docX, docY);
}

function setMarqueeMode(nextMode: SelectionMode) {
  selectionController.setMarqueeMode(nextMode);
}

function setMarqueeSides(sides: number) {
  selectionController.setMarqueeSides(sides);
}

function updateMarqueeModeFromModifiers(ctrlKey: boolean, shiftKey: boolean, altKey: boolean) {
  selectionController.updateMarqueeModeFromModifiers(ctrlKey, shiftKey, altKey);
}

function setTransformMode(nextMode: "scale" | "rotate") {
  transformController.setMode(nextMode);
}

const documentWorkflowController = createDocumentWorkflowController({
  documentSession,
  io,
  getSettings: () => settings,
  persistSettings,
  renderEditorState,
  showToast,
  log: debugLog,
  emitWorkspaceEvent,
  requestFileOpenFallback: () => fileOpenInput.click(),
  onDocumentActivated: () => {
    maskEditTarget = null;
  },
  hasActiveTransform: () => !!transformController.getDraft(),
  cancelActiveTransform: cancelTransformDraft,
});

const editorInteractionController = createEditorInteractionController({
  canvasStage,
  getDocuments: () => documents,
  getActiveDocument,
  getActiveTool: () => settings.activeTool,
  getPointerState: () => pointerState,
  getTransformDraft: () => transformController.getDraft(),
  ensureTransformDraftForActiveLayer,
  updateTransformDraftInputs,
  commitTransformDraft,
  cancelTransformDraft,
  setTransformMode: (mode, announce) => transformController.setMode(mode, announce),
  updateMarqueeModeFromModifiers,
  clearSelection,
  deleteSelectedArea,
  completeLassoSelection,
  addPastedImageToActiveDocument: (name, blob) => documentWorkflowController.addBlobAsLayerToActiveDocument(name, blob),
  loadImageFromDrop: (file) => documentWorkflowController.loadImageFromFileInput(file),
  setMagicWandTolerance: (value) => selectionController.setMagicWandTolerance(value),
  setMagicWandContiguous: (value) => selectionController.setMagicWandContiguous(value),
  renderEditorState,
  renderToolState,
  renderBrushUI: updateBrushUI,
  swapPaletteColours: () => paletteController.swapPrimarySecondary(),
  showToast,
  log: debugLog,
});

const paletteController = createPaletteController({
  getSettings: () => settings,
  persistSettings: async (next, message) => {
    settings = next;
    await saveSettings(settings);
    if (message) debugLog(message, "INFO");
  },
  setActiveColour: (colour) => editorInteractionController.setActiveColour(colour),
  getActiveColour: () => editorInteractionController.getBrushState().activeColour,
  showToast,
});

const captureController = createCaptureController({
  getSettings: () => settings,
  executeCommand,
  openDocumentFromBlob: documentWorkflowController.openDocumentFromBlob,
  addBlobAsLayerToActiveDocument: documentWorkflowController.addBlobAsLayerToActiveDocument,
  applyPickedColour: (colour) => {
    editorInteractionController.setActiveColour(colour);
  },
  showToast,
  log: debugLog,
});

const canvasPointer = createCanvasPointerController({
  editorCanvas,
  canvasWrap,
  getActiveDocument,
  getActiveLayer,
  getActiveTool: () => settings.activeTool,
  commitTransformDraft,
  getBrushState: () => editorInteractionController.getBrushState(),
  getSelectionMode: () => getCapturedOrEffectiveMode(),
  getMarqueeShape: () => selectionController.getMarqueeSides(),
  getMarqueeModifiers,
  getTransformMode: () => transformController.getMode(),
  ensureTransformDraft,
  getTransformDraft: () => transformController.getDraft(),
  syncTransformInputs,
  getSpacePressed: () => editorInteractionController.getModifierState().spacePressed,
  snapLayerPosition: (layer, rawX, rawY) => canvasWorkspaceController.snapLayerPosition(layer, rawX, rawY),
  pointerState,
  renderCanvas,
  renderEditorState,
  onColourPicked: (colour) => {
    editorInteractionController.setActiveColour(colour);
    showToast(`Sampled ${colour}`);
    goblinPersonalityController.signal({ type: "eyedropper-sampled" });
  },
  getCloneSource: () => cloneSource,
  setCloneSource: (source) => {
    cloneSource = source;
    if (source) showToast(`Clone source set at ${Math.round(source.x)},${Math.round(source.y)}`);
  },
  onLassoPoint: (x, y) => {
    const doc = getActiveDocument();
    if (!doc?.selectionPath || doc.selectionPath.closed) return;
    doc.selectionPath.points.push({ x, y });
  },
  onLassoComplete: completeLassoSelection,
  getMaskEditTarget: () => maskEditTarget,
  getQuickMaskCanvas: () => selectionController.getQuickMaskCanvas(),
  onCreateTextLayer: (x, y) => {
    const doc = getActiveDocument();
    if (!doc) return null;
    if (transformController.getDraft()) cancelTransformDraft(false);
    const background = doc.layers[0]?.fillColor?.toUpperCase() ?? null;
    const activeColour = editorInteractionController.getBrushState().activeColour;
    const nextTextColour = background && background === activeColour.toUpperCase()
      ? (background === "#FFFFFF" ? "#111111" : "#FFFFFF")
      : activeColour;
    const layer = addTextLayer(doc, Math.round(x), Math.round(y), undefined, {
      fillColor: nextTextColour,
    });
    debugLog(`Added text layer '${layer.name}'`, "INFO");
    renderEditorState();
    showToast("Added text layer");
    goblinPersonalityController.signal({ type: "layer-created" });
    return layer;
  },
  onCreateShapeLayer: (x, y) => {
    const doc = getActiveDocument();
    if (!doc) return null;
    if (transformController.getDraft()) cancelTransformDraft(false);
    const layer = addShapeLayer(doc, editorInteractionController.getActiveShapeKind(), Math.round(x), Math.round(y));
    debugLog(`Added shape layer '${layer.name}'`, "INFO");
    renderEditorState();
    showToast(`Added ${editorInteractionController.getActiveShapeKind()}`);
    goblinPersonalityController.signal({ type: "layer-created" });
    return layer;
  },
  log: debugLog,
});

function getEditorContext(): CanvasRenderingContext2D {
  const ctx = editorCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable for editor canvas");
  }
  return ctx;
}

const adjustmentModalController = createAdjustmentModalController({
  getActiveDocument,
  getActiveLayer,
  renderCanvas,
  renderEditorState,
  showToast,
});

const selectionToolsController = createSelectionToolsController({
  getActiveDocument,
  renderEditorState,
  showToast,
  toggleQuickMaskSession: () => selectionController.toggleQuickMask(),
});

const distortModalController = createDistortModalController({
  getActiveDocument,
  getActiveLayer,
  renderEditorState,
  showToast,
});

const inspectorController = createInspectorController({
  getActiveDocument,
  getActiveLayer,
  getMaskEditTarget: () => maskEditTarget,
  setMaskEditTarget: (layerId) => {
    maskEditTarget = layerId;
  },
  renderEditorState,
  showToast,
  log: debugLog,
});

layerPanelController = createLayerPanelController({
  getActiveDocument,
  clearMaskEditTarget: () => {
    maskEditTarget = null;
  },
  getConfirmLayerDeletion: () => settings.confirmLayerDeletion,
  getActiveTransformLayerId: () => transformController.getDraft()?.layerId ?? null,
  cancelTransformDraft,
  renderEditorState,
  showToast,
  log: debugLog,
});

canvasWorkspaceController = createCanvasWorkspaceController({
  editorCanvas,
  getEditorContext,
  getSettings: () => settings,
  getActiveDocument,
  getActiveLayer,
  getPointerState: () => pointerState,
  getTransformDraft: () => transformController.getDraft(),
  getEffectiveMarqueeMode,
  getMarqueeSides: () => selectionController.getMarqueeSides(),
  getMarqueeModifiers,
  getQuickMaskOverlay: () => selectionController.getQuickMaskOverlay(),
  renderEditorState,
  updateMarqueeModeFromModifiers,
  captureSelectionMode: () => selectionController.captureSelectionMode(),
  canvasPointer,
  showToast,
  log: debugLog,
});

workspaceShellController = createWorkspaceShellController({
  canvasStage,
  canvasWrap,
  getSettings: () => settings,
  applySettings,
  persistSettings,
  getDocuments: () => documents,
  getActiveDocument,
  getActiveDocumentId: () => documentSession.activeDocumentId,
  getActiveLayer,
  getSelectedLayerCount: (doc) => getSelectedLayerIds(doc).length,
  getActiveShapeKind: () => editorInteractionController.getActiveShapeKind(),
  getMarqueeSides: () => selectionController.getMarqueeSides(),
  getEffectiveMarqueeMode,
  getTransformMode: () => transformController.getMode(),
  isQuickMaskActive: () => selectionController.isQuickMaskActive(),
  getTransformDraftLayerId: () => transformController.getDraft()?.layerId ?? null,
  syncTransformInputs,
  cancelTransformDraft,
  commitTransformDraft,
  setMarqueeSides,
  setMarqueeMode,
  setTransformMode,
  renderCanvas,
  renderLayers,
  renderHistory,
  renderInspector: (doc) => inspectorController.render(doc),
  renderRecentMenus: () => documentWorkflowController.renderRecentMenus(),
  onActivateDocument: (documentId) => {
    documentWorkflowController.activateDocument(documentId);
  },
  onCloseDocument: async (documentId) => {
    await documentWorkflowController.closeDocument(documentId);
  },
  onToolChanged: (tool) => emitWorkspaceEvent("tool-changed", { tool }),
  emitWorkspaceEvent,
  onAppNavSelect: async (id) => {
    const handled = await documentWorkflowController.handleRecentNavSelection(id);
    if (!handled) {
      executeCommand(id);
    }
  },
  getBrushUiState: () => editorInteractionController.getBrushState(),
  configureAutosaveTimer: () => documentWorkflowController.configureAutosaveTimer(),
  openDebugLogFolder,
  getDebugLogPath,
  showToast,
  log: debugLog,
  setTheme,
});

function resetDocumentsToStarters() {
  documentSession.resetToStarterDocuments(settings.defaultZoom);
  debugLog(`Loaded ${documents.length} starter documents`, "INFO");
}

async function switchTool(tool: ToolName) {
  if (transformController.getDraft() && tool !== "transform") {
    commitTransformDraft();
  }
  await persistSettings({ ...settings, activeTool: tool, lastTab: "editor" });
  renderEditorState();
}

async function renameCanvas() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No canvas to rename", "error");
    return;
  }

  const nextName = await layerPanelController.requestCanvasName(doc.name);
  if (!nextName || nextName === doc.name) {
    return;
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  doc.name = nextName;
  doc.dirty = true;
  pushHistory(doc, `Renamed canvas to ${nextName}`);
  debugLog(`Renamed canvas '${doc.id}' to '${nextName}'`, "INFO");
  renderEditorState();
  showToast(`Renamed canvas to ${nextName}`);
}

function resetCanvasView() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to reset", "error");
    return;
  }
  doc.zoom = settings.defaultZoom;
  doc.panX = 0;
  doc.panY = 0;
  debugLog(`View reset for '${doc.name}'`, "INFO");
  renderEditorState();
}

function resizeActiveCanvas() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to resize", "error");
    return;
  }

  const nextWidth = Math.max(1, Number(byId<HTMLInputElement>("canvas-width-input").value));
  const nextHeight = Math.max(1, Number(byId<HTMLInputElement>("canvas-height-input").value));
  const anchor = byId<HTMLSelectElement>("canvas-resize-anchor").value as ResizeAnchor;
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    showToast("Enter valid canvas dimensions", "error");
    return;
  }
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const offset = getResizeOffset(anchor, doc.width, doc.height, Math.round(nextWidth), Math.round(nextHeight));
  resizeCanvasDocument(doc, Math.round(nextWidth), Math.round(nextHeight), offset);
  pushHistory(doc, `Resized canvas to ${Math.round(nextWidth)}x${Math.round(nextHeight)} from ${anchor}`);
  debugLog(`Resized canvas for '${doc.name}' to ${Math.round(nextWidth)}x${Math.round(nextHeight)} from ${anchor}`, "INFO");
  renderEditorState();
}

function openResizeCanvasModal() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document to resize", "error");
    return;
  }

  const backdrop = byId<HTMLElement>("resize-canvas-modal");
  const widthInput = byId<HTMLInputElement>("canvas-width-input");
  const heightInput = byId<HTMLInputElement>("canvas-height-input");
  const anchorInput = byId<HTMLSelectElement>("canvas-resize-anchor");
  const submitBtn = byId<HTMLButtonElement>("resize-canvas-submit-btn");

  widthInput.value = String(doc.width);
  heightInput.value = String(doc.height);
  anchorInput.value = "center";

  let settled = false;
  const onSubmit = () => {
    closeModal({ backdrop });
    resizeActiveCanvas();
    finish();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };
  const cleanup = () => {
    submitBtn.removeEventListener("click", onSubmit);
    widthInput.removeEventListener("keydown", onKeyDown);
    heightInput.removeEventListener("keydown", onKeyDown);
    anchorInput.removeEventListener("keydown", onKeyDown);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  submitBtn.addEventListener("click", onSubmit);
  widthInput.addEventListener("keydown", onKeyDown);
  heightInput.addEventListener("keydown", onKeyDown);
  anchorInput.addEventListener("keydown", onKeyDown);
  openModal({
    backdrop,
    acceptBtnSelector: ".modal-never",
    onReject: finish,
  });
  requestAnimationFrame(() => widthInput.focus());
}

async function applySettings(next: VisionSettings) {
  settings = next;
  await saveSettings(settings);
  workspaceShellController.syncFromSettings();
  aiController.render();
}

async function persistSettings(next: VisionSettings, message?: string) {
  const debugChanged = next.debugLoggingEnabled !== settings.debugLoggingEnabled;
  const keybindingsChanged = JSON.stringify(next.keybindings) !== JSON.stringify(settings.keybindings);
  settings = next;
  await saveSettings(settings);
  if (debugChanged) {
    await configureDebugLogging(settings.debugLoggingEnabled);
    debugLog(`Debug logging ${settings.debugLoggingEnabled ? "enabled" : "disabled"}`, "INFO");
  }
  if (keybindingsChanged) {
    applyKeybindings(settings.keybindings);
    workspaceShellController.updateToolTooltips();
    await captureController.refreshGlobalShortcuts();
  }
  workspaceShellController.syncFromSettings();
  aiController.render();
  if (message) {
    showToast(message);
  }
}

async function setTheme(theme: UiTheme): Promise<void> {
  applyTheme(theme);
  settings = { ...settings, uiTheme: theme };
  await saveSettings(settings);
  renderEditorState();
}

async function handleUndo() {
  if (transformController.getDraft()) {
    cancelTransformDraft(false);
  }
  const doc = getActiveDocument();
  if (!doc || doc.undoStack.length === 0) {
    debugLog("Undo requested with empty stack", "WARN");
    showToast("Nothing to undo");
    return;
  }

  const current = snapshotDocument(doc);
  const previous = doc.undoStack.pop();
  if (!previous) {
    return;
  }

  doc.redoStack.push(current);
  await restoreDocumentFromSnapshot(doc, previous);
  doc.historyIndex = Math.min(doc.historyIndex + 1, doc.history.length);
  debugLog(`Undo applied for document '${doc.name}'`, "INFO");
  renderEditorState();
  goblinPersonalityController.signal({ type: "undo-succeeded" });
}

async function handleRedo() {
  if (transformController.getDraft()) {
    cancelTransformDraft(false);
  }
  const doc = getActiveDocument();
  if (!doc || doc.redoStack.length === 0) {
    debugLog("Redo requested with empty stack", "WARN");
    showToast("Nothing to redo");
    return;
  }

  const current = snapshotDocument(doc);
  const next = doc.redoStack.pop();
  if (!next) {
    return;
  }

  doc.undoStack.push(current);
  await restoreDocumentFromSnapshot(doc, next);
  doc.historyIndex = Math.max(doc.historyIndex - 1, 0);
  debugLog(`Redo applied for document '${doc.name}'`, "INFO");
  renderEditorState();
}

function deleteSelectedArea() {
  if (transformController.getDraft()) {
    commitTransformDraft();
  }
  const doc = getActiveDocument();
  if (!doc?.selectionRect) {
    return;
  }
  const layer = getActiveLayer(doc);
  if (!layer || layer.locked || layer.isBackground) {
    showToast("Select an editable layer to clear the selection", "error");
    return;
  }

  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const ctx = getLayerContext(layer);

  if (doc.selectionMask) {
    const tmp = document.createElement("canvas");
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    const tmpCtx = tmp.getContext("2d");
    if (!tmpCtx) {
      return;
    }
    tmpCtx.fillStyle = "#fff";
    tmpCtx.fillRect(0, 0, tmp.width, tmp.height);
    tmpCtx.globalCompositeOperation = doc.selectionInverted ? "destination-out" : "destination-in";
    tmpCtx.drawImage(doc.selectionMask, -layer.x, -layer.y);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(tmp, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.save();
    applySelectionClip(ctx, doc.selectionRect, doc.selectionShape, doc.selectionInverted, doc.selectionPath, layer.x, layer.y, layer.canvas.width, layer.canvas.height);
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.restore();
  }

  syncLayerSource(layer);
  pushHistory(doc, "Cleared selected area");
  debugLog(`Cleared selected area on layer '${layer.name}'`, "INFO");
  renderEditorState();
  showToast("Selection cleared from layer", "success");
}

function handleAddAdjustmentLayer(kind: AdjustmentKind) {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document open", "error");
    return;
  }
  const layer = addAdjustmentLayer(doc, kind);
  debugLog(`Added adjustment layer '${layer.name}' (${kind}) to '${doc.name}'`, "INFO");
  showToast(`Added ${ADJUSTMENT_LABELS[kind]} adjustment layer`, "success");
  renderEditorState();
  goblinPersonalityController.signal({ type: "layer-created" });
}

function handleConvertToSmartObject() {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document open", "error");
    return;
  }
  const layer = getActiveLayer(doc);
  if (!layer || layer.type !== "raster") {
    showToast("Select a raster layer to convert", "error");
    return;
  }
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  const smart = convertToSmartObject(doc.layers, layer.id);
  if (!smart) {
    showToast("Could not convert layer", "error");
    return;
  }
  doc.dirty = true;
  pushHistory(doc, `Converted '${smart.name}' to smart object`);
  debugLog(`Converted '${smart.name}' to smart object`, "INFO");
  showToast(`Converted '${smart.name}' to smart object`, "success");
  renderEditorState();
}

function executeAlignment(kind: "left" | "right" | "top" | "bottom" | "center-h" | "center-v" | "distribute-h" | "distribute-v") {
  const doc = getActiveDocument();
  if (!doc) {
    showToast("No document open", "error");
    return;
  }
  const ids = getSelectedLayerIds(doc);
  doc.undoStack.push(snapshotDocument(doc));
  doc.redoStack = [];
  let moved = false;
  switch (kind) {
    case "left": moved = alignLeft(doc, ids, alignTarget); break;
    case "right": moved = alignRight(doc, ids, alignTarget); break;
    case "top": moved = alignTop(doc, ids, alignTarget); break;
    case "bottom": moved = alignBottom(doc, ids, alignTarget); break;
    case "center-h": moved = alignCenterH(doc, ids, alignTarget); break;
    case "center-v": moved = alignCenterV(doc, ids, alignTarget); break;
    case "distribute-h": moved = distributeH(doc, ids); break;
    case "distribute-v": moved = distributeV(doc, ids); break;
  }
  if (moved) {
    doc.dirty = true;
    pushHistory(doc, `Align ${kind}`);
    renderEditorState();
  } else {
    doc.undoStack.pop();
    showToast("Nothing to align", "info");
  }
}

function registerEditorCommands() {
  registerCommands(buildEditorCommands({
    getSettings: () => settings,
    getActiveDocument,
    getActiveLayer,
    createNewDocumentFlow: documentWorkflowController.createNewDocumentFlow,
    handleOpenImage: documentWorkflowController.handleOpenImage,
    handleOpenProject: documentWorkflowController.handleOpenProject,
    duplicateActiveDocument: documentWorkflowController.duplicateActiveDocument,
    tryPasteImageFromClipboard: async () => {
      const pasted = await documentWorkflowController.tryPasteImageFromClipboard();
      if (!pasted) showToast("Use Ctrl+V after copying an image if paste is blocked", "info");
      return pasted;
    },
    handleSaveProject: documentWorkflowController.handleSaveProject,
    handleExportImage: documentWorkflowController.handleExportImage,
    handleUndo,
    handleRedo,
    renameCanvas,
    openResizeCanvasModal,
    resetCanvasView,
    toggleCanvasSetting,
    selectEntireCanvas,
    clearSelection,
    invertSelection,
    deleteSelectedArea,
    openColorRangeModal: selectionToolsController.openColorRangeModal,
    openRefineEdgeModal: selectionToolsController.openRefineEdgeModal,
    toggleQuickMask: selectionToolsController.toggleQuickMask,
    openBrightnessContrastModal: adjustmentModalController.openBrightnessContrastModal,
    openHueSaturationModal: adjustmentModalController.openHueSaturationModal,
    openGaussianBlurModal: adjustmentModalController.openGaussianBlurModal,
    openSharpenModal: adjustmentModalController.openSharpenModal,
    openColorBalanceModal: adjustmentModalController.openColorBalanceModal,
    openLUTModal: adjustmentModalController.openLUTModal,
    openGradientMapModal: adjustmentModalController.openGradientMapModal,
    openCurvesModal: adjustmentModalController.openCurvesModal,
    openLevelsModal: adjustmentModalController.openLevelsModal,
    openMotionBlurModal: adjustmentModalController.openMotionBlurModal,
    openAddNoiseModal: adjustmentModalController.openAddNoiseModal,
    openReduceNoiseModal: adjustmentModalController.openReduceNoiseModal,
    openWarpModal: distortModalController.openWarpModal,
    openLiquifyModal: distortModalController.openLiquifyModal,
    handleAddAdjustmentLayer,
    handleConvertToSmartObject,
    handleRasterizeLayer: inspectorController.handleRasterizeLayer,
    executeAlignment,
    toggleAlignTarget: () => {
      alignTarget = alignTarget === "selection" ? "canvas" : "selection";
      byId<HTMLElement>("align-to-canvas-label").textContent = alignTarget === "canvas" ? "Align to Selection" : "Align to Canvas";
      showToast(`Align target: ${alignTarget}`);
    },
    toggleWindowPanel: (panel) => workspaceShellController.toggleWindowPanel(panel),
    togglePalette,
    beginRegionSnip: () => captureController.beginRegionSnip(),
    chooseWindowCapture: () => captureController.chooseWindowCapture(),
    captureFullscreen: () => captureController.captureFullscreen(),
    openManagePalettes: () => paletteController.openManageModal(),
    beginGlobalColourPick: () => captureController.beginGlobalColourPick(),
    clearRecent: documentWorkflowController.clearRecent,
    switchTool,
    openAiJobs: () => aiController.focusJobs(),
    openAiSettings: () => aiController.focusSettings(),
    selectAiSubject: () => aiEditingController.selectSubject(),
    selectAiBackground: () => aiEditingController.selectBackground(),
    selectAiObjectByPrompt: () => aiEditingController.selectObjectByPrompt(),
    removeAiBackground: () => aiEditingController.removeBackground(),
    removeAiObject: () => aiEditingController.removeObject(),
    openAiAutoEnhanceModal: () => aiEditingController.openAutoEnhanceModal(),
    runAiUpscale: () => aiEditingController.upscaleActiveLayer(),
    openAiDenoiseModal: () => aiEditingController.openDenoiseModal(),
    runAiInpaint: () => aiEditingController.inpaintSelection(),
    runAiOutpaint: () => aiEditingController.outpaintCanvas(),
    openAiStyleTransferModal: () => aiEditingController.openStyleTransferModal(),
    openAiRestoreModal: () => aiEditingController.openRestoreModal(),
    runAiThumbnail: () => aiEditingController.generateThumbnail(),
    runAiFreeform: () => aiEditingController.freeformAi(),
    setTheme,
  }));
  applyKeybindings(settings.keybindings);
}

function bindDocumentActions() {
  byId<HTMLButtonElement>("empty-new-doc-btn").addEventListener("click", () => {
    void documentWorkflowController.createNewDocumentFlow();
  });
  byId<HTMLButtonElement>("empty-restore-docs-btn").addEventListener("click", () => {
    resetDocumentsToStarters();
    renderEditorState();
  });
  byId<HTMLButtonElement>("undo-btn").addEventListener("click", () => {
    void handleUndo();
  });
  byId<HTMLButtonElement>("redo-btn").addEventListener("click", () => {
    void handleRedo();
  });
  byId<HTMLButtonElement>("reset-view-btn").addEventListener("click", () => {
    resetCanvasView();
  });
  fileOpenInput.addEventListener("change", () => {
    const file = fileOpenInput.files?.[0];
    if (!file) return;
    void documentWorkflowController.loadImageFromFileInput(file);
    fileOpenInput.value = "";
  });
  byId<HTMLButtonElement>("add-layer-btn").addEventListener("click", () => {
    const doc = getActiveDocument();
    if (!doc) return;
    const layer = addLayer(doc);
    debugLog(`Added layer '${layer.name}' to '${doc.name}'`, "INFO");
    renderEditorState();
    goblinPersonalityController.signal({ type: "layer-created" });
  });
  byId<HTMLInputElement>("background-colour-input").addEventListener("input", (event) => {
    const doc = getActiveDocument();
    if (!doc || doc.layers.length === 0) {
      return;
    }
    const value = (event.currentTarget as HTMLInputElement).value;
    if (setBackgroundLayerColor(doc, value)) {
      debugLog(`Changed background colour to ${value} for '${doc.name}'`, "INFO");
      renderEditorState();
    } else {
      debugLog(`Failed to change background colour for '${doc.name}'`, "WARN");
    }
  });
}

async function init() {
  setupWindowControls();
  goblinPersonalityController.init();
  settings = await loadSettings();
  settings = {
    ...settings,
    leftPanelCollapsed: false,
    leftPanelWidth: Math.max(220, settings.leftPanelWidth),
  };
  applyTheme(settings.uiTheme);
  await configureDebugLogging(settings.debugLoggingEnabled);
  resetDocumentsToStarters();
  debugLog("Vision Goblin initialized", "INFO");
  window.addEventListener("error", (event) => {
    debugLog(`Unhandled error: ${event.message}`, "ERROR");
  });
  window.addEventListener("unhandledrejection", (event) => {
    debugLog(`Unhandled rejection: ${String(event.reason)}`, "ERROR");
  });

  registerEditorCommands();
  workspaceShellController.updateToolTooltips();
  workspaceShellController.bind();
  aiController.bind();
  aiEditingController.bind();
  canvasWorkspaceController.bindZoomControls();
  bindDocumentActions();
  editorInteractionController.bind();
  paletteController.bind();
  inspectorController.bind();
  captureController.bindOverlay();
  canvasWorkspaceController.bindCanvasInteractions();
  await captureController.refreshGlobalShortcuts();

  workspaceShellController.syncFromSettings();
  aiController.render();
  await documentWorkflowController.checkCrashRecovery();
  documentWorkflowController.configureAutosaveTimer();

  window.addEventListener("beforeunload", () => {
    goblinPersonalityController.destroy();
    void documentWorkflowController.cleanShutdown();
  });
  currentWindow.onCloseRequested(async () => {
    goblinPersonalityController.destroy();
    await documentWorkflowController.cleanShutdown();
  });
}

aiController = createAiController({
  getSettings: () => settings,
  persistSettings,
  showToast,
  log: debugLog,
});

aiEditingController = createAiEditingController({
  aiController,
  getActiveDocument,
  getActiveLayer,
  renderCanvas,
  renderEditorState,
  showToast,
  log: debugLog,
  saveDebugImage: saveAiDebugImage,
});

goblinPersonalityController = createGoblinPersonalityController({
  subtitleElement: windowSubtitle,
  toastRoot: byId<HTMLElement>("goblin-toast"),
  canvasStage,
  editorCanvas,
  getActiveTool: () => settings.activeTool,
});

void init();
