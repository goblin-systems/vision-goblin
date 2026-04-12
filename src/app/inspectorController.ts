import { applyIcons, closeModal, openModal } from "@goblin-systems/goblin-design-system";
import { GRADIENT_PRESETS } from "../editor/adjustments";
import { pushHistory } from "../editor/history";
import { addLayerMask, clearLayerMask, invertLayerMask, removeLayerMask } from "../editor/layerMask";
import { applyPreset, cloneEffects, createEffect, getAllPresets, getEffectMeta, saveCustomPreset } from "../editor/layerStyles";
import { rasterizeLayer } from "../editor/layers";
import { renderInspector as renderInspectorView } from "../editor/render";
import { renderSmartObjectLayer, replaceSmartObjectSource } from "../editor/smartObject";
import {
  getTextFillColor,
  type AdjustmentLayer,
  type DocumentState,
  type EffectType,
  type Layer,
  type LayerEffect,
  type LinearGradientFill,
  type RadialGradientFill,
  type ShapeKind,
  type ShapeLayer,
  type SmartObjectLayer,
  type TextFill,
  type TextLayer,
} from "../editor/types";
import { gradientConfigToTextFill, createDefaultGradientConfig } from "../editor/gradient";
import type { GradientEditorResult } from "./gradientToolController";
import { refreshLayerCanvas, snapshotDocument } from "../editor/documents";
import { byId } from "./dom";
import { createFontFamilyPicker } from "./fontFamilyPicker";
import { CURATED_LOCAL_FONT_FAMILIES } from "../fonts/curatedFontFamilies";
import { getCustomFontFamilies, loadFontFromBuffer, type CustomFontEntry } from "./customFontRegistry";

type ToastVariant = "success" | "error" | "info";
type LogLevel = "INFO" | "WARN" | "ERROR";

export interface TextInspectorState {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  kerning: number;
  boxWidth: number | null;
  boxHeight: number | null;
  alignment: TextLayer["textData"]["alignment"];
  fill: TextFill;
  strokeColor: string;
  strokeWidth: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
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
  effectType?: EffectType;
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
  openGradientEditorForText: (
    currentFill: LinearGradientFill | RadialGradientFill,
    onConfirm: (result: GradientEditorResult) => void,
  ) => void;
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
  inspectorBlendSelect: HTMLSelectElement;
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
  textFontFamilyOptions: HTMLElement;
  textFontSize: HTMLInputElement;
  textLineHeight: HTMLInputElement;
  textKerning: HTMLInputElement;
  textBoxWidth: HTMLInputElement;
  textBoxHeight: HTMLInputElement;
  textAlignment: HTMLSelectElement;
  textFill: HTMLInputElement;
  textFillTypeSelect: HTMLSelectElement;
  textFillColorField: HTMLElement;
  textFillGradientFields: HTMLElement;
  textFillEditGradientBtn: HTMLButtonElement;
  textStrokeColor: HTMLInputElement;
  textStrokeWidth: HTMLInputElement;
  textBold: HTMLInputElement;
  textItalic: HTMLInputElement;
  textUnderline: HTMLInputElement;
  textStrikethrough: HTMLInputElement;
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
  textLoadFontBtn: HTMLButtonElement;
}

function getInspectorDomRefs(): InspectorDomRefs {
  return {
    backgroundColourInput: byId<HTMLInputElement>("background-colour-input"),
    inspectorMode: byId<HTMLElement>("inspector-mode"),
    inspectorSelection: byId<HTMLElement>("inspector-selection"),
    inspectorBlendSelect: byId<HTMLSelectElement>("inspector-blend-select"),
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
    textFontFamilyOptions: byId<HTMLElement>("text-font-family-options"),
    textFontSize: byId<HTMLInputElement>("text-font-size-input"),
    textLineHeight: byId<HTMLInputElement>("text-line-height-input"),
    textKerning: byId<HTMLInputElement>("text-kerning-input"),
    textBoxWidth: byId<HTMLInputElement>("text-box-width-input"),
    textBoxHeight: byId<HTMLInputElement>("text-box-height-input"),
    textAlignment: byId<HTMLSelectElement>("text-alignment-select"),
    textFill: byId<HTMLInputElement>("text-fill-input"),
    textFillTypeSelect: byId<HTMLSelectElement>("text-fill-type-select"),
    textFillColorField: byId<HTMLElement>("text-fill-color-field"),
    textFillGradientFields: byId<HTMLElement>("text-fill-gradient-fields"),
    textFillEditGradientBtn: byId<HTMLButtonElement>("text-fill-edit-gradient-btn"),
    textStrokeColor: byId<HTMLInputElement>("text-stroke-color-input"),
    textStrokeWidth: byId<HTMLInputElement>("text-stroke-width-input"),
    textBold: byId<HTMLInputElement>("text-bold-input"),
    textItalic: byId<HTMLInputElement>("text-italic-input"),
    textUnderline: byId<HTMLInputElement>("text-underline-input"),
    textStrikethrough: byId<HTMLInputElement>("text-strikethrough-input"),
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
    textLoadFontBtn: byId<HTMLButtonElement>("text-load-font-btn"),
  };
}

export function applyTextInspectorState(layer: TextLayer, state: TextInspectorState) {
  layer.textData.text = state.text || "Text";
  layer.textData.fontFamily = state.fontFamily || "Georgia";
  layer.textData.fontSize = Math.max(8, state.fontSize || 64);
  layer.textData.lineHeight = Math.max(0.8, state.lineHeight || 1.2);
  layer.textData.kerning = state.kerning || 0;
  layer.textData.boxWidth = Math.max(0, state.boxWidth || 0) || null;
  layer.textData.boxHeight = Math.max(0, state.boxHeight || 0) || null;
  layer.textData.alignment = state.alignment;
  layer.textData.fill = state.fill;
  layer.textData.fillColor = getTextFillColor(state.fill);
  layer.textData.stroke = state.strokeWidth > 0 ? { color: state.strokeColor, width: state.strokeWidth } : null;
  layer.textData.bold = state.bold;
  layer.textData.italic = state.italic;
  layer.textData.underline = state.underline;
  layer.textData.strikethrough = state.strikethrough;
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

function readTextInspectorState(refs: InspectorDomRefs, currentFill?: TextFill): TextInspectorState {
  const fillType = refs.textFillTypeSelect.value as TextFill["type"];
  let fill: TextFill;
  if (fillType === "solid") {
    fill = { type: "solid", color: refs.textFill.value };
  } else if (currentFill && currentFill.type !== "solid") {
    fill = currentFill;
  } else {
    fill = gradientConfigToTextFill(createDefaultGradientConfig());
  }
  return {
    text: refs.textValue.value,
    fontFamily: refs.textFontFamily.value,
    fontSize: Number(refs.textFontSize.value) || 0,
    lineHeight: Number(refs.textLineHeight.value) || 0,
    kerning: Number(refs.textKerning.value) || 0,
    boxWidth: refs.textBoxWidth.value ? Number(refs.textBoxWidth.value) : null,
    boxHeight: refs.textBoxHeight.value ? Number(refs.textBoxHeight.value) : null,
    alignment: refs.textAlignment.value as TextLayer["textData"]["alignment"],
    fill,
    strokeColor: refs.textStrokeColor.value,
    strokeWidth: Number(refs.textStrokeWidth.value) || 0,
    bold: refs.textBold.checked,
    italic: refs.textItalic.checked,
    underline: refs.textUnderline.checked,
    strikethrough: refs.textStrikethrough.checked,
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
    effectType: input.closest<HTMLElement>("[data-effect-type]")?.dataset.effectType as EffectType | undefined,
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
  select.innerHTML = '<option value="">Apply preset...</option>';
  presets.forEach((preset, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name + (preset.builtIn ? "" : " (custom)");
    select.appendChild(option);
  });
}

export function createInspectorController(deps: InspectorControllerDeps): InspectorController {
  const refs = getInspectorDomRefs();
  let pendingEffectSnapshot: string | null = null;
  let pendingEffectEntry = "Edited layer effects";

  function getAllFontOptions(): string[] {
    return [...CURATED_LOCAL_FONT_FAMILIES, ...getCustomFontFamilies()];
  }

  let textFontFamilyPicker = createFontFamilyPicker({
    input: refs.textFontFamily,
    optionsList: refs.textFontFamilyOptions,
  }, getAllFontOptions());

  function refreshFontPickerOptions() {
    textFontFamilyPicker = createFontFamilyPicker({
      input: refs.textFontFamily,
      optionsList: refs.textFontFamilyOptions,
    }, getAllFontOptions());
  }

  function applyInspectorLayerEdits() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer || layer.isBackground) return;
    if (layer.type === "text") {
      applyTextInspectorState(layer, readTextInspectorState(refs, layer.textData.fill));
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

  function handleTextFontFamilyInput() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer || layer.isBackground || layer.type !== "text") return;
    if (refs.textFontFamily.value === "") return;
    applyInspectorLayerEdits();
  }

  function applyEffectsFromDynamicUi() {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer) return;
    applyEffectInputChanges(layer.effects ?? [], readEffectInputChanges(refs.effectsList));
    doc.dirty = true;
    deps.renderEditorState();
  }

  function beginEffectEditSession(doc: DocumentState, entry = "Edited layer effects") {
    if (!pendingEffectSnapshot) {
      pendingEffectSnapshot = snapshotDocument(doc);
    }
    pendingEffectEntry = entry;
  }

  function commitEffectEditSession(doc: DocumentState) {
    if (!pendingEffectSnapshot) return;
    doc.undoStack.push(pendingEffectSnapshot);
    doc.redoStack = [];
    pushHistory(doc, pendingEffectEntry);
    pendingEffectSnapshot = null;
    pendingEffectEntry = "Edited layer effects";
  }

  function discardEffectEditSession() {
    pendingEffectSnapshot = null;
    pendingEffectEntry = "Edited layer effects";
  }

  function applyLayerEffectsChange(entry: string, mutate: (layer: Layer) => boolean) {
    const doc = deps.getActiveDocument();
    const layer = doc ? deps.getActiveLayer(doc) : null;
    if (!doc || !layer) return;
    const snapshot = snapshotDocument(doc);
    const changed = mutate(layer);
    if (!changed) return;
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.dirty = true;
    pushHistory(doc, entry);
    discardEffectEditSession();
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
      const result = saveCustomPreset(presetName, cloneEffects(layer.effects ?? []));
      deps.showToast(result.replacedExisting ? `Updated preset "${result.preset.name}"` : `Saved preset "${result.preset.name}"`);
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
      inspectorBlendSelect: refs.inspectorBlendSelect,
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
      textBoxHeight: refs.textBoxHeight,
      textAlignment: refs.textAlignment,
      textFill: refs.textFill,
      textBold: refs.textBold,
      textItalic: refs.textItalic,
      textUnderline: refs.textUnderline,
      textStrikethrough: refs.textStrikethrough,
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
    textFontFamilyPicker.setValue(refs.textFontFamily.value);
    populateEffectPresetSelect(refs.effectsPresetSelect);
    applyMaskInspectorUi(refs, getMaskInspectorUiState(deps.getActiveLayer(doc), deps.getMaskEditTarget()));

    const activeLayer = deps.getActiveLayer(doc);
    if (activeLayer?.type === "text") {
      const fill = activeLayer.textData.fill;
      refs.textFillTypeSelect.value = fill.type;
      if (fill.type === "solid") {
        refs.textFill.value = fill.color;
      }
      syncTextFillTypeVisibility();
      refs.textStrokeColor.value = activeLayer.textData.stroke?.color ?? "#000000";
      refs.textStrokeWidth.value = String(activeLayer.textData.stroke?.width ?? 0);
    }

    applyIcons();
  }

  function syncTextFillTypeVisibility() {
    const fillType = refs.textFillTypeSelect.value;
    const isGradient = fillType !== "solid";
    refs.textFillColorField.hidden = isGradient;
    refs.textFillGradientFields.hidden = !isGradient;
  }

  async function pickAndLoadFont(): Promise<CustomFontEntry | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".ttf,.otf,.woff,.woff2";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const buffer = await file.arrayBuffer();
        const entry = await loadFontFromBuffer(buffer, file.name);
        resolve(entry);
      });
      input.click();
    });
  }

  function bind() {
    const inspectorIds = [
      "text-value-input", "text-font-size-input", "text-line-height-input", "text-kerning-input", "text-box-width-input", "text-box-height-input",
      "text-alignment-select", "text-fill-input", "text-bold-input", "text-italic-input", "text-underline-input", "text-strikethrough-input", "shape-kind-inspector-select", "shape-width-input",
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
    refs.textFontFamily.addEventListener("input", handleTextFontFamilyInput);
    refs.textFontFamily.addEventListener("change", applyInspectorLayerEdits);

    refs.inspectorBlendSelect.addEventListener("change", () => {
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer) return;
      doc.undoStack.push(snapshotDocument(doc));
      doc.redoStack = [];
      layer.blendMode = (refs.inspectorBlendSelect.value || undefined) as GlobalCompositeOperation | undefined;
      doc.dirty = true;
      pushHistory(doc, `Blend mode → ${refs.inspectorBlendSelect.value || "Normal"}`);
      deps.renderEditorState();
    });

    refs.textFillTypeSelect.addEventListener("change", () => {
      syncTextFillTypeVisibility();
      const fillType = refs.textFillTypeSelect.value;
      if (fillType !== "solid") {
        const doc = deps.getActiveDocument();
        const layer = doc ? deps.getActiveLayer(doc) : null;
        if (!doc || !layer || layer.type !== "text") return;
        const defaultFill = gradientConfigToTextFill(createDefaultGradientConfig());
        const targetFill: LinearGradientFill | RadialGradientFill = fillType === "radial-gradient"
          ? { ...defaultFill, type: "radial-gradient" } as RadialGradientFill
          : { ...defaultFill, type: "linear-gradient" } as LinearGradientFill;
        applyTextInspectorState(layer, readTextInspectorState(refs, targetFill));
        doc.dirty = true;
        deps.renderEditorState();
        deps.openGradientEditorForText(targetFill, (result) => {
          const updatedFill = gradientConfigToTextFill(result.config);
          applyTextInspectorState(layer, readTextInspectorState(refs, updatedFill));
          doc.dirty = true;
          deps.renderEditorState();
        });
        return;
      }
      applyInspectorLayerEdits();
    });

    refs.textFillEditGradientBtn.addEventListener("click", () => {
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer || layer.type !== "text") return;
      let currentFill = layer.textData.fill;
      if (currentFill.type === "solid") {
        const defaultFill = gradientConfigToTextFill(createDefaultGradientConfig());
        applyTextInspectorState(layer, readTextInspectorState(refs, defaultFill));
        doc.dirty = true;
        deps.renderEditorState();
        currentFill = defaultFill;
      }
      deps.openGradientEditorForText(currentFill as LinearGradientFill | RadialGradientFill, (result) => {
        const updatedFill = gradientConfigToTextFill(result.config);
        applyTextInspectorState(layer, readTextInspectorState(refs, updatedFill));
        doc.dirty = true;
        deps.renderEditorState();
      });
    });

    refs.textStrokeColor.addEventListener("input", applyInspectorLayerEdits);
    refs.textStrokeColor.addEventListener("change", applyInspectorLayerEdits);
    refs.textStrokeWidth.addEventListener("input", applyInspectorLayerEdits);
    refs.textStrokeWidth.addEventListener("change", applyInspectorLayerEdits);

    refs.effectsAddSelect.addEventListener("change", () => {
      const type = refs.effectsAddSelect.value as EffectType;
      if (!type) return;
      refs.effectsAddSelect.value = "";
      applyLayerEffectsChange(`Added ${getEffectMeta(type)?.label ?? type}`, (layer) => {
        layer.effects ??= [];
        layer.effects.push(createEffect(type));
        return true;
      });
    });

    refs.effectsList.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (!target?.matches("[data-effect-index][data-effect-field]")) return;
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer) return;
      const effectType = target.closest<HTMLElement>("[data-effect-type]")?.dataset.effectType as EffectType | undefined;
      const label = effectType ? `Edited ${getEffectMeta(effectType)?.label ?? effectType}` : "Edited layer effects";
      beginEffectEditSession(doc, label);
      applyEffectsFromDynamicUi();
    });

    refs.effectsList.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (!target?.matches("[data-effect-index][data-effect-field]")) return;
      const doc = deps.getActiveDocument();
      const layer = doc ? deps.getActiveLayer(doc) : null;
      if (!doc || !layer) return;
      if (!pendingEffectSnapshot) {
        const effectType = target.closest<HTMLElement>("[data-effect-type]")?.dataset.effectType as EffectType | undefined;
        const label = effectType ? `Edited ${getEffectMeta(effectType)?.label ?? effectType}` : "Edited layer effects";
        beginEffectEditSession(doc, label);
        applyEffectsFromDynamicUi();
      }
      commitEffectEditSession(doc);
    });

    refs.effectsList.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-effect-delete-index]");
      if (!target) return;
      const idx = Number(target.dataset.effectDeleteIndex);
      applyLayerEffectsChange("Removed layer effect", (layer) => {
        if (!layer.effects || idx < 0 || idx >= layer.effects.length) {
          return false;
        }
        layer.effects.splice(idx, 1);
        return true;
      });
    });

    refs.effectsClearBtn.addEventListener("click", () => {
      applyLayerEffectsChange("Cleared layer effects", (layer) => {
        if (!layer.effects || layer.effects.length === 0) {
          return false;
        }
        layer.effects = [];
        return true;
      });
    });

    refs.effectsPresetSelect.addEventListener("change", () => {
      const idx = Number(refs.effectsPresetSelect.value);
      if (Number.isNaN(idx) || refs.effectsPresetSelect.value === "") return;
      refs.effectsPresetSelect.value = "";
      const preset = getAllPresets()[idx];
      if (!preset) return;
      applyLayerEffectsChange(`Applied preset \"${preset.name}\"`, (layer) => {
        layer.effects = applyPreset(preset);
        return true;
      });
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

    refs.textLoadFontBtn.addEventListener("click", () => {
      void pickAndLoadFont().then((result) => {
        if (!result) return;
        const doc = deps.getActiveDocument();
        if (!doc) return;
        // Add to document for persistence
        if (!doc.customFonts.some((f) => f.family === result.family)) {
          doc.customFonts.push({ family: result.family, dataUrl: result.dataUrl, fileName: result.fileName });
        }
        // Update font picker options
        refreshFontPickerOptions();
        // Auto-select the loaded font
        textFontFamilyPicker.setValue(result.family);
        // Trigger apply to the active text layer
        const layer = doc ? deps.getActiveLayer(doc) : null;
        if (layer?.type === "text") {
          refs.textFontFamily.value = result.family;
          refs.textFontFamily.dispatchEvent(new Event("change", { bubbles: true }));
        }
        deps.showToast(`Loaded font: ${result.family}`, "success");
      }).catch((err: unknown) => {
        deps.log(`Font loading failed: ${err}`, "ERROR");
        deps.showToast("Failed to load font", "error");
      });
    });
  }

  return {
    bind,
    render,
    handleRasterizeLayer,
  };
}
