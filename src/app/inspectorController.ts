import { applyIcons, closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { GRADIENT_PRESETS } from "../editor/adjustments";
import { pushHistory } from "../editor/history";
import { addLayerMask, clearLayerMask, invertLayerMask, removeLayerMask } from "../editor/layerMask";
import { applyPreset, createEffect, getAllPresets, getEffectMeta, loadCustomPresets, saveCustomPresets } from "../editor/layerStyles";
import { rasterizeLayer } from "../editor/layers";
import { renderInspector as renderInspectorView } from "../editor/render";
import { renderSmartObjectLayer, replaceSmartObjectSource } from "../editor/smartObject";
import {
  type AdjustmentLayer,
  type DocumentState,
  type EffectType,
  type Layer,
  type LayerEffect,
  type ShapeKind,
  type ShapeLayer,
  type SmartObjectLayer,
  type TextLayer,
} from "../editor/types";
import { refreshLayerCanvas, snapshotDocument } from "../editor/documents";
import { byId } from "./dom";

type ToastVariant = "success" | "error" | "info";
type LogLevel = "INFO" | "WARN" | "ERROR";

export interface TextInspectorState {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  kerning: number;
  boxWidth: number | null;
  alignment: TextLayer["textData"]["alignment"];
  fillColor: string;
  bold: boolean;
  italic: boolean;
}

export interface ShapeInspectorState {
  kind: ShapeKind;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface SmartObjectInspectorState {
  scaleXPercent: number;
  scaleYPercent: number;
  rotateDeg: number;
}

export interface EffectInputChange {
  index: number;
  field: string;
  value: string;
  checked?: boolean;
}

export interface MaskInspectorUiState {
  hidden: boolean;
  addDisabled: boolean;
  deleteDisabled: boolean;
  editRowHidden: boolean;
  editChecked: boolean;
}

export interface InspectorControllerDeps {
  getActiveDocument: () => DocumentState | null;
  getActiveLayer: (doc: DocumentState) => Layer | null;
  getMaskEditTarget: () => string | null;
  setMaskEditTarget: (layerId: string | null) => void;
  renderEditorState: () => void;
  showToast: (message: string, variant?: ToastVariant) => void;
  log: (message: string, level?: LogLevel) => void;
}

export interface InspectorController {
  bind(): void;
  render(doc: DocumentState): void;
  handleRasterizeLayer(): void;
}

interface InspectorDomRefs {
  backgroundColourInput: HTMLInputElement;
  inspectorMode: HTMLElement;
  inspectorSelection: HTMLElement;
  inspectorBlend: HTMLElement;
  inspectorOpacity: HTMLElement;
  inspectorPosition: HTMLElement;
  inspectorLayer: HTMLElement;
  textInspector: HTMLElement;
  shapeInspector: HTMLElement;
  adjustmentInspector: HTMLElement;
  smartObjectInspector: HTMLElement;
  effectsInspector: HTMLElement;
  textValue: HTMLTextAreaElement;
  textFontFamily: HTMLInputElement;
  textFontSize: HTMLInputElement;
  textLineHeight: HTMLInputElement;
  textKerning: HTMLInputElement;
  textBoxWidth: HTMLInputElement;
  textAlignment: HTMLSelectElement;
  textFill: HTMLInputElement;
  textBold: HTMLInputElement;
  textItalic: HTMLInputElement;
  shapeKind: HTMLSelectElement;
  shapeWidth: HTMLInputElement;
  shapeHeight: HTMLInputElement;
  shapeFill: HTMLInputElement;
  shapeStroke: HTMLInputElement;
  shapeStrokeWidth: HTMLInputElement;
  shapeCornerRadius: HTMLInputElement;
  effectsList: HTMLElement;
  effectsAddSelect: HTMLSelectElement;
  effectsClearBtn: HTMLButtonElement;
  effectsPresetSelect: HTMLSelectElement;
  effectsSavePresetBtn: HTMLButtonElement;
  savePresetModal: HTMLElement;
  savePresetNameInput: HTMLInputElement;
  savePresetSubmitBtn: HTMLButtonElement;
  adjKindBadge: HTMLElement;
  adjBcFields: HTMLElement;
  adjBcBrightness: HTMLInputElement;
  adjBcContrast: HTMLInputElement;
  adjHsFields: HTMLElement;
  adjHsHue: HTMLInputElement;
  adjHsSaturation: HTMLInputElement;
  adjHsLightness: HTMLInputElement;
  adjLevelsFields: HTMLElement;
  adjLevelsBlack: HTMLInputElement;
  adjLevelsGamma: HTMLInputElement;
  adjLevelsWhite: HTMLInputElement;
  adjCurvesFields: HTMLElement;
  adjCurvesMidX: HTMLInputElement;
  adjCurvesMidY: HTMLInputElement;
  adjCbFields: HTMLElement;
  adjCbShCr: HTMLInputElement;
  adjCbShMg: HTMLInputElement;
  adjCbShYb: HTMLInputElement;
  adjCbMtCr: HTMLInputElement;
  adjCbMtMg: HTMLInputElement;
  adjCbMtYb: HTMLInputElement;
  adjCbHlCr: HTMLInputElement;
  adjCbHlMg: HTMLInputElement;
  adjCbHlYb: HTMLInputElement;
  adjGmFields: HTMLElement;
  adjGmPreset: HTMLSelectElement;
  adjMaskFields: HTMLElement;
  adjMaskAddBtn: HTMLButtonElement;
  adjMaskDeleteBtn: HTMLButtonElement;
  adjMaskEditRow: HTMLElement;
  adjMaskEditToggle: HTMLInputElement;
  adjMaskInvertBtn: HTMLButtonElement;
  adjMaskClearBtn: HTMLButtonElement;
  soSourceDims: HTMLElement;
  soScaleX: HTMLInputElement;
  soScaleY: HTMLInputElement;
  soRotateDeg: HTMLInputElement;
  soRasterizeBtn: HTMLButtonElement;
  soReplaceBtn: HTMLButtonElement;
}

function getInspectorDomRefs(): InspectorDomRefs {
  return {
    backgroundColourInput: byId<HTMLInputElement>("background-colour-input"),
    inspectorMode: byId<HTMLElement>("inspector-mode"),
    inspectorSelection: byId<HTMLElement>("inspector-selection"),
    inspectorBlend: byId<HTMLElement>("inspector-blend"),
    inspectorOpacity: byId<HTMLElement>("inspector-opacity"),
    inspectorPosition: byId<HTMLElement>("inspector-position"),
    inspectorLayer: byId<HTMLElement>("inspector-layer"),
    textInspector: byId<HTMLElement>("text-inspector"),
    shapeInspector: byId<HTMLElement>("shape-inspector"),
    adjustmentInspector: byId<HTMLElement>("adjustment-inspector"),
    smartObjectInspector: byId<HTMLElement>("smart-object-inspector"),
    effectsInspector: byId<HTMLElement>("effects-inspector"),
    textValue: byId<HTMLTextAreaElement>("text-value-input"),
    textFontFamily: byId<HTMLInputElement>("text-font-family-input"),
    textFontSize: byId<HTMLInputElement>("text-font-size-input"),
    textLineHeight: byId<HTMLInputElement>("text-line-height-input"),
    textKerning: byId<HTMLInputElement>("text-kerning-input"),
    textBoxWidth: byId<HTMLInputElement>("text-box-width-input"),
    textAlignment: byId<HTMLSelectElement>("text-alignment-select"),
    textFill: byId<HTMLInputElement>("text-fill-input"),
    textBold: byId<HTMLInputElement>("text-bold-input"),
    textItalic: byId<HTMLInputElement>("text-italic-input"),
    shapeKind: byId<HTMLSelectElement>("shape-kind-inspector-select"),
    shapeWidth: byId<HTMLInputElement>("shape-width-input"),
    shapeHeight: byId<HTMLInputElement>("shape-height-input"),
    shapeFill: byId<HTMLInputElement>("shape-fill-input"),
    shapeStroke: byId<HTMLInputElement>("shape-stroke-input"),
    shapeStrokeWidth: byId<HTMLInputElement>("shape-stroke-width-input"),
    shapeCornerRadius: byId<HTMLInputElement>("shape-corner-radius-input"),
    effectsList: byId<HTMLElement>("effects-list"),
    effectsAddSelect: byId<HTMLSelectElement>("effects-add-select"),
    effectsClearBtn: byId<HTMLButtonElement>("effects-clear-btn"),
    effectsPresetSelect: byId<HTMLSelectElement>("effects-preset-select"),
    effectsSavePresetBtn: byId<HTMLButtonElement>("effects-save-preset-btn"),
    savePresetModal: byId<HTMLElement>("save-preset-modal"),
    savePresetNameInput: byId<HTMLInputElement>("save-preset-name-input"),
    savePresetSubmitBtn: byId<HTMLButtonElement>("save-preset-submit-btn"),
    adjKindBadge: byId<HTMLElement>("adj-kind-badge"),
    adjBcFields: byId<HTMLElement>("adj-bc-fields"),
    adjBcBrightness: byId<HTMLInputElement>("adj-bc-brightness"),
    adjBcContrast: byId<HTMLInputElement>("adj-bc-contrast"),
    adjHsFields: byId<HTMLElement>("adj-hs-fields"),
    adjHsHue: byId<HTMLInputElement>("adj-hs-hue"),
    adjHsSaturation: byId<HTMLInputElement>("adj-hs-saturation"),
    adjHsLightness: byId<HTMLInputElement>("adj-hs-lightness"),
    adjLevelsFields: byId<HTMLElement>("adj-levels-fields"),
    adjLevelsBlack: byId<HTMLInputElement>("adj-levels-black"),
    adjLevelsGamma: byId<HTMLInputElement>("adj-levels-gamma"),
    adjLevelsWhite: byId<HTMLInputElement>("adj-levels-white"),
    adjCurvesFields: byId<HTMLElement>("adj-curves-fields"),
    adjCurvesMidX: byId<HTMLInputElement>("adj-curves-mid-x"),
    adjCurvesMidY: byId<HTMLInputElement>("adj-curves-mid-y"),
    adjCbFields: byId<HTMLElement>("adj-cb-fields"),
    adjCbShCr: byId<HTMLInputElement>("adj-cb-sh-cr"),
    adjCbShMg: byId<HTMLInputElement>("adj-cb-sh-mg"),
    adjCbShYb: byId<HTMLInputElement>("adj-cb-sh-yb"),
    adjCbMtCr: byId<HTMLInputElement>("adj-cb-mt-cr"),
    adjCbMtMg: byId<HTMLInputElement>("adj-cb-mt-mg"),
    adjCbMtYb: byId<HTMLInputElement>("adj-cb-mt-yb"),
    adjCbHlCr: byId<HTMLInputElement>("adj-cb-hl-cr"),
    adjCbHlMg: byId<HTMLInputElement>("adj-cb-hl-mg"),
    adjCbHlYb: byId<HTMLInputElement>("adj-cb-hl-yb"),
    adjGmFields: byId<HTMLElement>("adj-gm-fields"),
    adjGmPreset: byId<HTMLSelectElement>("adj-gm-preset"),
    adjMaskFields: byId<HTMLElement>("adj-mask-fields"),
    adjMaskAddBtn: byId<HTMLButtonElement>("adj-mask-add-btn"),
    adjMaskDeleteBtn: byId<HTMLButtonElement>("adj-mask-delete-btn"),
    adjMaskEditRow: byId<HTMLElement>("adj-mask-edit-row"),
    adjMaskEditToggle: byId<HTMLInputElement>("adj-mask-edit-toggle"),
    adjMaskInvertBtn: byId<HTMLButtonElement>("adj-mask-invert-btn"),
    adjMaskClearBtn: byId<HTMLButtonElement>("adj-mask-clear-btn"),
    soSourceDims: byId<HTMLElement>("so-source-dims"),
    soScaleX: byId<HTMLInputElement>("so-scale-x"),
    soScaleY: byId<HTMLInputElement>("so-scale-y"),
    soRotateDeg: byId<HTMLInputElement>("so-rotate-deg"),
    soRasterizeBtn: byId<HTMLButtonElement>("so-rasterize-btn"),
    soReplaceBtn: byId<HTMLButtonElement>("so-replace-btn"),
  };
}

export function applyTextInspectorState(layer: TextLayer, state: TextInspectorState) {
  layer.textData.text = state.text || "Text";
  layer.textData.fontFamily = state.fontFamily || "Georgia";
  layer.textData.fontSize = Math.max(8, state.fontSize || 64);
  layer.textData.lineHeight = Math.max(0.8, state.lineHeight || 1.2);
  layer.textData.kerning = state.kerning || 0;
  layer.textData.boxWidth = Math.max(0, state.boxWidth || 0) || null;
  layer.textData.alignment = state.alignment;
  layer.textData.fillColor = state.fillColor;
  layer.textData.bold = state.bold;
  layer.textData.italic = state.italic;
  refreshLayerCanvas(layer);
}

export function applyShapeInspectorState(layer: ShapeLayer, state: ShapeInspectorState) {
  layer.shapeData.kind = state.kind;
  layer.shapeData.width = Math.max(1, state.width || layer.shapeData.width);
  layer.shapeData.height = Math.max(1, state.height || layer.shapeData.height);
  layer.shapeData.fillColor = state.fillColor;
  layer.shapeData.strokeColor = state.strokeColor;
  layer.shapeData.strokeWidth = Math.max(0, state.strokeWidth || 0);
  layer.shapeData.cornerRadius = Math.max(0, state.cornerRadius || 0);
  refreshLayerCanvas(layer);
}

export function applyAdjustmentInspectorState(layer: AdjustmentLayer, refs: Pick<
  InspectorDomRefs,
  | "adjBcBrightness"
  | "adjBcContrast"
  | "adjHsHue"
  | "adjHsSaturation"
  | "adjHsLightness"
  | "adjLevelsBlack"
  | "adjLevelsGamma"
  | "adjLevelsWhite"
  | "adjCurvesMidX"
  | "adjCurvesMidY"
  | "adjCbShCr"
  | "adjCbShMg"
  | "adjCbShYb"
  | "adjCbMtCr"
  | "adjCbMtMg"
  | "adjCbMtYb"
  | "adjCbHlCr"
  | "adjCbHlMg"
  | "adjCbHlYb"
  | "adjGmPreset"
>) {
  const ad = layer.adjustmentData;
  if (ad.kind === "brightness-contrast") {
    ad.params.brightness = Number(refs.adjBcBrightness.value) || 0;
    ad.params.contrast = Number(refs.adjBcContrast.value) || 0;
    return;
  }
  if (ad.kind === "hue-saturation") {
    ad.params.hue = Number(refs.adjHsHue.value) || 0;
    ad.params.saturation = Number(refs.adjHsSaturation.value) || 0;
    ad.params.lightness = Number(refs.adjHsLightness.value) || 0;
    return;
  }
  if (ad.kind === "levels") {
    ad.params.inputBlack = Number(refs.adjLevelsBlack.value) || 0;
    ad.params.gamma = (Number(refs.adjLevelsGamma.value) || 100) / 100;
    ad.params.inputWhite = Number(refs.adjLevelsWhite.value) || 255;
    return;
  }
  if (ad.kind === "curves") {
    const midX = Number(refs.adjCurvesMidX.value) || 128;
    const midY = Number(refs.adjCurvesMidY.value) || 128;
    ad.params.points = [{ x: 0, y: 0 }, { x: midX, y: midY }, { x: 255, y: 255 }];
    return;
  }
  if (ad.kind === "color-balance") {
    ad.params.shadowsCyanRed = Number(refs.adjCbShCr.value) || 0;
    ad.params.shadowsMagentaGreen = Number(refs.adjCbShMg.value) || 0;
    ad.params.shadowsYellowBlue = Number(refs.adjCbShYb.value) || 0;
    ad.params.midtonesCyanRed = Number(refs.adjCbMtCr.value) || 0;
    ad.params.midtonesMagentaGreen = Number(refs.adjCbMtMg.value) || 0;
    ad.params.midtonesYellowBlue = Number(refs.adjCbMtYb.value) || 0;
    ad.params.highlightsCyanRed = Number(refs.adjCbHlCr.value) || 0;
    ad.params.highlightsMagentaGreen = Number(refs.adjCbHlMg.value) || 0;
    ad.params.highlightsYellowBlue = Number(refs.adjCbHlYb.value) || 0;
    return;
  }
  const presetIdx = Number(refs.adjGmPreset.value) || 0;
  const preset = GRADIENT_PRESETS[presetIdx];
  if (preset) {
    ad.params.stops = preset.stops.map((stop) => ({ ...stop }));
  }
}

export function applySmartObjectInspectorState(layer: SmartObjectLayer, state: SmartObjectInspectorState) {
  layer.smartObjectData.scaleX = Math.max(0.01, (state.scaleXPercent || 100) / 100);
  layer.smartObjectData.scaleY = Math.max(0.01, (state.scaleYPercent || 100) / 100);
  layer.smartObjectData.rotateDeg = state.rotateDeg || 0;
  renderSmartObjectLayer(layer);
}

export function applyEffectInputChanges(effects: LayerEffect[], changes: EffectInputChange[]) {
  for (const change of changes) {
    if (change.index < 0 || change.index >= effects.length || !change.field) continue;
    const effect = effects[change.index] as unknown as Record<string, unknown>;
    const meta = getEffectMeta(effects[change.index].type as EffectType);
    const fieldMeta = meta?.fields.find((field) => field.key === change.field);
    if (change.field === "enabled") {
      effect.enabled = !!change.checked;
    } else if (fieldMeta?.type === "color") {
      effect[change.field] = change.value;
    } else if (fieldMeta?.type === "range" && fieldMeta.uiScale) {
      effect[change.field] = Math.max(0, Math.min(1, (Number(change.value) || 0) / fieldMeta.uiScale));
    } else {
      effect[change.field] = Number(change.value) || 0;
    }
  }
}

export function getMaskInspectorUiState(activeLayer: Layer | null, maskEditTarget: string | null): MaskInspectorUiState {
  if (!activeLayer || activeLayer.type !== "adjustment") {
    return {
      hidden: true,
      addDisabled: true,
      deleteDisabled: true,
      editRowHidden: true,
      editChecked: false,
    };
  }
  if (activeLayer.mask) {
    return {
      hidden: false,
      addDisabled: true,
      deleteDisabled: false,
      editRowHidden: false,
      editChecked: maskEditTarget === activeLayer.id,
    };
  }
  return {
    hidden: false,
    addDisabled: false,
    deleteDisabled: true,
    editRowHidden: true,
    editChecked: false,
  };
}

function readTextInspectorState(refs: InspectorDomRefs): TextInspectorState {
  return {
    text: refs.textValue.value,
    fontFamily: refs.textFontFamily.value,
    fontSize: Number(refs.textFontSize.value) || 0,
    lineHeight: Number(refs.textLineHeight.value) || 0,
    kerning: Number(refs.textKerning.value) || 0,
    boxWidth: refs.textBoxWidth.value ? Number(refs.textBoxWidth.value) : null,
    alignment: refs.textAlignment.value as TextLayer["textData"]["alignment"],
    fillColor: refs.textFill.value,
    bold: refs.textBold.checked,
    italic: refs.textItalic.checked,
  };
}

function readShapeInspectorState(refs: InspectorDomRefs): ShapeInspectorState {
  return {
    kind: refs.shapeKind.value as ShapeKind,
    width: Number(refs.shapeWidth.value) || 0,
    height: Number(refs.shapeHeight.value) || 0,
    fillColor: refs.shapeFill.value,
    strokeColor: refs.shapeStroke.value,
    strokeWidth: Number(refs.shapeStrokeWidth.value) || 0,
    cornerRadius: Number(refs.shapeCornerRadius.value) || 0,
  };
}

function readSmartObjectInspectorState(refs: InspectorDomRefs): SmartObjectInspectorState {
  return {
    scaleXPercent: Number(refs.soScaleX.value) || 100,
    scaleYPercent: Number(refs.soScaleY.value) || 100,
    rotateDeg: Number(refs.soRotateDeg.value) || 0,
  };
}

function readEffectInputChanges(container: HTMLElement): EffectInputChange[] {
  const inputs = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-effect-index][data-effect-field]");
  return Array.from(inputs, (input) => ({
    index: Number(input.dataset.effectIndex),
    field: input.dataset.effectField ?? "",
    value: input.value,
    checked: input instanceof HTMLInputElement ? input.checked : undefined,
  }));
}

function applyMaskInspectorUi(refs: InspectorDomRefs, state: MaskInspectorUiState) {
  refs.adjMaskFields.hidden = state.hidden;
  refs.adjMaskAddBtn.disabled = state.addDisabled;
  refs.adjMaskDeleteBtn.disabled = state.deleteDisabled;
  refs.adjMaskEditRow.hidden = state.editRowHidden;
  refs.adjMaskEditToggle.checked = state.editChecked;
}

function populateEffectPresetSelect(select: HTMLSelectElement) {
  const presets = getAllPresets();
  if (select.options.length !== presets.length + 1) {
    select.innerHTML = '<option value="">Apply preset...</option>';
    presets.forEach((preset, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = preset.name + (preset.builtIn ? "" : " (custom)");
      select.appendChild(option);
    });
  }
}

export function createInspectorController(deps: InspectorControllerDeps): InspectorController {
  const refs = getInspectorDomRefs();

  function applyInspectorLayerEdits() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer || layer.isBackground) return;
    if (layer.type === "text") {
      applyTextInspectorState(layer, readTextInspectorState(refs));
    } else if (layer.type === "shape") {
      applyShapeInspectorState(layer, readShapeInspectorState(refs));
    } else if (layer.type === "adjustment") {
      applyAdjustmentInspectorState(layer, refs);
    } else if (layer.type === "smart-object") {
      applySmartObjectInspectorState(layer, readSmartObjectInspectorState(refs));
    }
    doc.dirty = true;
    deps.renderEditorState();
  }

  function applyEffectsFromDynamicUi() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer) return;
    applyEffectInputChanges(layer.effects ?? [], readEffectInputChanges(refs.effectsList));
    doc.dirty = true;
    deps.renderEditorState();
  }

  function handleEffectPresetSave(layer: Layer) {
    refs.savePresetNameInput.value = "";
    let settled = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      onSubmit();
    };
    const cleanup = () => {
      refs.savePresetSubmitBtn.removeEventListener("click", onSubmit);
      refs.savePresetNameInput.removeEventListener("keydown", onKeyDown);
    };
    const onSubmit = () => {
      const presetName = refs.savePresetNameInput.value.trim();
      if (!presetName) {
        deps.showToast("Preset name cannot be empty", "error");
        refs.savePresetNameInput.focus();
        return;
      }
      closeModal({ backdrop: refs.savePresetModal });
      cleanup();
      if (settled) return;
      settled = true;
      const custom = loadCustomPresets();
      custom.push({ name: presetName, effects: layer.effects!.map((effect) => ({ ...effect })) });
      saveCustomPresets(custom);
      deps.showToast(`Saved preset "${presetName}"`);
      deps.renderEditorState();
    };

    refs.savePresetSubmitBtn.addEventListener("click", onSubmit);
    refs.savePresetNameInput.addEventListener("keydown", onKeyDown);
    openModal({
      backdrop: refs.savePresetModal,
      acceptBtnSelector: ".modal-never",
      onReject: () => {
        cleanup();
        settled = true;
      },
    });
    requestAnimationFrame(() => {
      refs.savePresetNameInput.focus();
    });
  }

  async function replaceActiveSmartObjectSource() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer || layer.type !== "smart-object") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        doc.undoStack.push(snapshotDocument(doc));
        doc.redoStack = [];
        replaceSmartObjectSource(layer, canvas);
        doc.dirty = true;
        pushHistory(doc, `Replaced source for '${layer.name}'`);
        deps.showToast("Smart object source replaced", "success");
        deps.renderEditorState();
        URL.revokeObjectURL(objectUrl);
      };
      image.onerror = () => {
        deps.showToast("Could not load replacement image", "error");
        URL.revokeObjectURL(objectUrl);
      };
      image.src = objectUrl;
    };
    input.click();
  }

  function handleMaskAdd() {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    if (!layer || layer.type !== "adjustment" || layer.mask) return;
    snapshotDocument(doc);
    addLayerMask(layer, doc.width, doc.height);
    doc.dirty = true;
    pushHistory(doc, "Add mask");
    deps.log(`Added mask to layer '${layer.name}'`, "INFO");
    deps.showToast("Mask added");
    deps.renderEditorState();
  }

  function handleMaskDelete() {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    if (!layer || !layer.mask) return;
    if (deps.getMaskEditTarget() === layer.id) deps.setMaskEditTarget(null);
    snapshotDocument(doc);
    removeLayerMask(layer);
    doc.dirty = true;
    pushHistory(doc, "Delete mask");
    deps.log(`Deleted mask from layer '${layer.name}'`, "INFO");
    deps.showToast("Mask deleted");
    deps.renderEditorState();
  }

  function handleMaskToggle(event: Event) {
    const checkbox = event.target as HTMLInputElement;
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    if (!layer || !layer.mask) {
      checkbox.checked = false;
      return;
    }
    deps.setMaskEditTarget(checkbox.checked ? layer.id : null);
    deps.log(`Mask edit ${checkbox.checked ? "enabled" : "disabled"} for '${layer.name}'`, "INFO");
  }

  function handleMaskInvert() {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    if (!layer || !layer.mask) return;
    snapshotDocument(doc);
    invertLayerMask(layer);
    doc.dirty = true;
    pushHistory(doc, "Invert mask");
    deps.log(`Inverted mask on layer '${layer.name}'`, "INFO");
    deps.showToast("Mask inverted");
    deps.renderEditorState();
  }

  function handleMaskClear() {
    const doc = deps.getActiveDocument();
    if (!doc) return;
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    if (!layer || !layer.mask) return;
    snapshotDocument(doc);
    clearLayerMask(layer);
    doc.dirty = true;
    pushHistory(doc, "Reset mask");
    deps.log(`Reset mask on layer '${layer.name}'`, "INFO");
    deps.showToast("Mask reset to white");
    deps.renderEditorState();
  }

  function handleRasterizeLayer() {
    const doc = deps.getActiveDocument();
    if (!doc) {
      deps.showToast("No document open", "error");
      return;
    }
    const layer = deps.getActiveLayer(doc);
    if (!layer || layer.type === "raster" || layer.type === "adjustment") {
      deps.showToast("Select a text, shape, or smart object layer to rasterize", "error");
      return;
    }
    doc.undoStack.push(snapshotDocument(doc));
    doc.redoStack = [];
    const raster = rasterizeLayer(doc.layers, layer.id);
    if (!raster) {
      deps.showToast("Could not rasterize layer", "error");
      return;
    }
    doc.dirty = true;
    pushHistory(doc, `Rasterized '${raster.name}'`);
    deps.log(`Rasterized ${layer.type} layer '${raster.name}'`, "INFO");
    deps.showToast(`Rasterized '${raster.name}'`, "success");
    deps.renderEditorState();
  }

  function render(doc: DocumentState) {
    renderInspectorView({
      doc,
      activeLayer: deps.getActiveLayer(doc),
      backgroundColourInput: refs.backgroundColourInput,
      inspectorMode: refs.inspectorMode,
      inspectorSelection: refs.inspectorSelection,
      inspectorBlend: refs.inspectorBlend,
      inspectorOpacity: refs.inspectorOpacity,
      inspectorPosition: refs.inspectorPosition,
      inspectorLayer: refs.inspectorLayer,
      textInspector: refs.textInspector,
      shapeInspector: refs.shapeInspector,
      adjustmentInspector: refs.adjustmentInspector,
      smartObjectInspector: refs.smartObjectInspector,
      effectsInspector: refs.effectsInspector,
      textValue: refs.textValue,
      textFontFamily: refs.textFontFamily,
      textFontSize: refs.textFontSize,
      textLineHeight: refs.textLineHeight,
      textKerning: refs.textKerning,
      textBoxWidth: refs.textBoxWidth,
      textAlignment: refs.textAlignment,
      textFill: refs.textFill,
      textBold: refs.textBold,
      textItalic: refs.textItalic,
      shapeKind: refs.shapeKind,
      shapeWidth: refs.shapeWidth,
      shapeHeight: refs.shapeHeight,
      shapeFill: refs.shapeFill,
      shapeStroke: refs.shapeStroke,
      shapeStrokeWidth: refs.shapeStrokeWidth,
      shapeCornerRadius: refs.shapeCornerRadius,
      onEffectChange: applyEffectsFromDynamicUi,
      effectsList: refs.effectsList,
      adjKindBadge: refs.adjKindBadge,
      adjBcFields: refs.adjBcFields,
      adjBcBrightness: refs.adjBcBrightness,
      adjBcContrast: refs.adjBcContrast,
      adjHsFields: refs.adjHsFields,
      adjHsHue: refs.adjHsHue,
      adjHsSaturation: refs.adjHsSaturation,
      adjHsLightness: refs.adjHsLightness,
      adjLevelsFields: refs.adjLevelsFields,
      adjLevelsBlack: refs.adjLevelsBlack,
      adjLevelsGamma: refs.adjLevelsGamma,
      adjLevelsWhite: refs.adjLevelsWhite,
      adjCurvesFields: refs.adjCurvesFields,
      adjCurvesMidX: refs.adjCurvesMidX,
      adjCurvesMidY: refs.adjCurvesMidY,
      adjCbFields: refs.adjCbFields,
      adjCbShCr: refs.adjCbShCr,
      adjCbShMg: refs.adjCbShMg,
      adjCbShYb: refs.adjCbShYb,
      adjCbMtCr: refs.adjCbMtCr,
      adjCbMtMg: refs.adjCbMtMg,
      adjCbMtYb: refs.adjCbMtYb,
      adjCbHlCr: refs.adjCbHlCr,
      adjCbHlMg: refs.adjCbHlMg,
      adjCbHlYb: refs.adjCbHlYb,
      adjGmFields: refs.adjGmFields,
      adjGmPreset: refs.adjGmPreset,
      soSourceDims: refs.soSourceDims,
      soScaleX: refs.soScaleX,
      soScaleY: refs.soScaleY,
      soRotateDeg: refs.soRotateDeg,
    });
    populateEffectPresetSelect(refs.effectsPresetSelect);
    applyMaskInspectorUi(refs, getMaskInspectorUiState(deps.getActiveLayer(doc), deps.getMaskEditTarget()));
    applyIcons();
  }

  function bind() {
    const inspectorIds = [
      "text-value-input", "text-font-family-input", "text-font-size-input", "text-line-height-input", "text-kerning-input", "text-box-width-input",
      "text-alignment-select", "text-fill-input", "text-bold-input", "text-italic-input", "shape-kind-inspector-select", "shape-width-input",
      "shape-height-input", "shape-fill-input", "shape-stroke-input", "shape-stroke-width-input", "shape-corner-radius-input",
      "adj-bc-brightness", "adj-bc-contrast",
      "adj-hs-hue", "adj-hs-saturation", "adj-hs-lightness",
      "adj-levels-black", "adj-levels-gamma", "adj-levels-white",
      "adj-curves-mid-x", "adj-curves-mid-y",
      "adj-cb-sh-cr", "adj-cb-sh-mg", "adj-cb-sh-yb",
      "adj-cb-mt-cr", "adj-cb-mt-mg", "adj-cb-mt-yb",
      "adj-cb-hl-cr", "adj-cb-hl-mg", "adj-cb-hl-yb",
      "adj-gm-preset", "so-scale-x", "so-scale-y", "so-rotate-deg",
    ] as const;
    inspectorIds.forEach((id) => {
      byId<HTMLElement>(id).addEventListener("input", applyInspectorLayerEdits);
      byId<HTMLElement>(id).addEventListener("change", applyInspectorLayerEdits);
    });

    refs.effectsAddSelect.addEventListener("change", () => {
      const type = refs.effectsAddSelect.value as EffectType;
      if (!type) return;
      refs.effectsAddSelect.value = "";
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer) return;
      layer.effects ??= [];
      layer.effects.push(createEffect(type));
      doc.dirty = true;
      deps.renderEditorState();
    });

    refs.effectsList.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-effect-delete-index]");
      if (!target) return;
      const idx = Number(target.dataset.effectDeleteIndex);
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer || !layer.effects) return;
      if (idx >= 0 && idx < layer.effects.length) {
        layer.effects.splice(idx, 1);
        doc.dirty = true;
        deps.renderEditorState();
      }
    });

    refs.effectsClearBtn.addEventListener("click", () => {
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer) return;
      layer.effects = [];
      doc.dirty = true;
      deps.renderEditorState();
    });

    refs.effectsPresetSelect.addEventListener("change", () => {
      const idx = Number(refs.effectsPresetSelect.value);
      if (Number.isNaN(idx) || refs.effectsPresetSelect.value === "") return;
      refs.effectsPresetSelect.value = "";
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer) return;
      const preset = getAllPresets()[idx];
      if (!preset) return;
      layer.effects = applyPreset(preset);
      doc.dirty = true;
      deps.renderEditorState();
    });

    refs.effectsSavePresetBtn.addEventListener("click", () => {
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer || !layer.effects || layer.effects.length === 0) {
        deps.showToast("No effects to save as preset");
        return;
      }
      handleEffectPresetSave(layer);
    });

    refs.adjMaskAddBtn.addEventListener("click", handleMaskAdd);
    refs.adjMaskDeleteBtn.addEventListener("click", handleMaskDelete);
    refs.adjMaskEditToggle.addEventListener("change", handleMaskToggle);
    refs.adjMaskInvertBtn.addEventListener("click", handleMaskInvert);
    refs.adjMaskClearBtn.addEventListener("click", handleMaskClear);

    refs.soRasterizeBtn.addEventListener("click", handleRasterizeLayer);
    refs.soReplaceBtn.addEventListener("click", () => {
      void replaceActiveSmartObjectSource();
    });
  }

  return {
    bind,
    render,
    handleRasterizeLayer,
  };
}
