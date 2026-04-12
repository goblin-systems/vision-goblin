import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@goblin-systems/goblin-design-system", () => ({
  applyIcons: vi.fn(),
  closeModal: vi.fn(),
  openModal: vi.fn(),
  byId: <T extends HTMLElement>(id: string) => document.getElementById(id) as T,
}));

import { makeNewDocument } from "../editor/actions/documentActions";
import { addAdjustmentLayer } from "../editor/layers";
import { createEffect } from "../editor/layerStyles";
import type { DocumentState, LinearGradientFill, RadialGradientFill, ShapeLayer, SmartObjectLayer, TextFill, TextLayer } from "../editor/types";
import type { GradientEditorResult } from "./gradientToolController";
import type { GradientConfig } from "../editor/gradient";
import {
  applyAdjustmentInspectorState,
  applyEffectInputChanges,
  applyShapeInspectorState,
  applySmartObjectInspectorState,
  applyTextInspectorState,
  createInspectorController,
  getMaskInspectorUiState,
} from "./inspectorController";

function createTextLayerFixture(): TextLayer {
  return {
    id: "text-1",
    type: "text",
    name: "Title",
    canvas: document.createElement("canvas"),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    textData: {
      text: "Hello",
      fontFamily: "Arial",
      fontSize: 24,
      lineHeight: 1.2,
      kerning: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      alignment: "left",
      fill: { type: "solid", color: "#000000" },
      stroke: null,
      fillColor: "#000000",
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      boxWidth: null,
      boxHeight: null,
    },
  };
}

function createShapeLayerFixture(): ShapeLayer {
  return {
    id: "shape-1",
    type: "shape",
    name: "Shape",
    canvas: document.createElement("canvas"),
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    shapeData: {
      kind: "rectangle",
      width: 12,
      height: 10,
      rotationDeg: 0,
      fillColor: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 1,
      cornerRadius: 2,
    },
  };
}

function createSmartObjectLayerFixture(): SmartObjectLayer {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 10;
  sourceCanvas.height = 8;
  return {
    id: "so-1",
    type: "smart-object",
    name: "SO",
    canvas: document.createElement("canvas"),
    sourceCanvas,
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    locked: false,
    smartObjectData: {
      sourceDataUrl: "data:image/png;base64,AAA",
      sourceWidth: 10,
      sourceHeight: 8,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      sourceCanvas,
    },
  };
}

function setupInspectorDomFixture() {
  const container = document.createElement("div");
  const textareaIds = ["text-value-input"];
  const buttonIds = [
    "effects-clear-btn",
    "effects-save-preset-btn",
    "save-preset-submit-btn",
    "adj-mask-add-btn",
    "adj-mask-delete-btn",
    "adj-mask-invert-btn",
    "adj-mask-clear-btn",
    "so-rasterize-btn",
    "so-replace-btn",
    "text-fill-edit-gradient-btn",
    "text-load-font-btn",
  ];
  const selectIds = [
    "inspector-blend-select",
    "text-alignment-select",
    "text-fill-type-select",
    "shape-kind-inspector-select",
    "effects-add-select",
    "effects-preset-select",
    "adj-gm-preset",
  ];
  const checkboxIds = ["text-bold-input", "text-italic-input", "text-underline-input", "text-strikethrough-input", "adj-mask-edit-toggle"];
  const inputIds = [
    "background-colour-input",
    "text-font-family-input",
    "text-font-size-input",
    "text-line-height-input",
    "text-kerning-input",
    "text-box-width-input",
    "text-box-height-input",
    "text-fill-input",
    "text-stroke-color-input",
    "text-stroke-width-input",
    "shape-width-input",
    "shape-height-input",
    "shape-fill-input",
    "shape-stroke-input",
    "shape-stroke-width-input",
    "shape-corner-radius-input",
    "save-preset-name-input",
    "adj-bc-brightness",
    "adj-bc-contrast",
    "adj-hs-hue",
    "adj-hs-saturation",
    "adj-hs-lightness",
    "adj-levels-black",
    "adj-levels-gamma",
    "adj-levels-white",
    "adj-curves-mid-x",
    "adj-curves-mid-y",
    "adj-cb-sh-cr",
    "adj-cb-sh-mg",
    "adj-cb-sh-yb",
    "adj-cb-mt-cr",
    "adj-cb-mt-mg",
    "adj-cb-mt-yb",
    "adj-cb-hl-cr",
    "adj-cb-hl-mg",
    "adj-cb-hl-yb",
    "so-scale-x",
    "so-scale-y",
    "so-rotate-deg",
  ];
  const divIds = [
    "inspector-mode",
    "inspector-selection",
    "inspector-opacity",
    "inspector-position",
    "inspector-layer",
    "text-inspector",
    "shape-inspector",
    "adjustment-inspector",
    "smart-object-inspector",
    "effects-inspector",
    "effects-list",
    "save-preset-modal",
    "adj-kind-badge",
    "adj-bc-fields",
    "adj-hs-fields",
    "adj-levels-fields",
    "adj-curves-fields",
    "adj-cb-fields",
    "adj-gm-fields",
    "adj-mask-fields",
    "adj-mask-edit-row",
    "so-source-dims",
    "text-font-family-options",
    "text-fill-color-field",
    "text-fill-gradient-fields",
  ];

  for (const id of textareaIds) {
    const element = document.createElement("textarea");
    element.id = id;
    container.appendChild(element);
  }
  for (const id of buttonIds) {
    const element = document.createElement("button");
    element.id = id;
    container.appendChild(element);
  }
  for (const id of selectIds) {
    const element = document.createElement("select");
    element.id = id;
    container.appendChild(element);
  }
  for (const id of checkboxIds) {
    const element = document.createElement("input");
    element.id = id;
    element.type = "checkbox";
    container.appendChild(element);
  }
  for (const id of inputIds) {
    const element = document.createElement("input");
    element.id = id;
    container.appendChild(element);
  }
  for (const id of divIds) {
    const element = document.createElement("div");
    element.id = id;
    container.appendChild(element);
  }

  document.body.appendChild(container);

  return {
    container,
    teardown() {
      container.remove();
    },
  };
}

function createTextDocumentFixture(): { doc: DocumentState; layer: TextLayer } {
  const doc = makeNewDocument("Doc", 64, 64, 100, "transparent");
  const layer = createTextLayerFixture();
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;
  return { doc, layer };
}

describe("inspectorController helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("applies text inspector state with editor-safe defaults", () => {
    const layer = createTextLayerFixture();

    applyTextInspectorState(layer, {
      text: "",
      fontFamily: "",
      fontSize: 4,
      lineHeight: 0.4,
      kerning: 12,
      boxWidth: 0,
      boxHeight: 0,
      alignment: "center",
      fill: { type: "solid", color: "#123456" },
      strokeColor: "#000000",
      strokeWidth: 0,
      bold: true,
      italic: true,
      underline: false,
      strikethrough: false,
    });

    expect(layer.textData.text).toBe("Text");
    expect(layer.textData.fontFamily).toBe("Georgia");
    expect(layer.textData.fontSize).toBe(8);
    expect(layer.textData.lineHeight).toBe(0.8);
    expect(layer.textData.kerning).toBe(12);
    expect(layer.textData.boxWidth).toBeNull();
    expect(layer.textData.boxHeight).toBeNull();
    expect(layer.textData.alignment).toBe("center");
    expect(layer.textData.fill).toEqual({ type: "solid", color: "#123456" });
    expect(layer.textData.fillColor).toBe("#123456");
    expect(layer.textData.stroke).toBeNull();
    expect(layer.textData.bold).toBe(true);
    expect(layer.textData.italic).toBe(true);
  });

  it("applies shape inspector state and clamps invalid geometry", () => {
    const layer = createShapeLayerFixture();

    applyShapeInspectorState(layer, {
      kind: "ellipse",
      width: 0,
      height: -4,
      fillColor: "#abcdef",
      strokeColor: "#111111",
      strokeWidth: -3,
      cornerRadius: -8,
    });

    expect(layer.shapeData.kind).toBe("ellipse");
    expect(layer.shapeData.width).toBe(12);
    expect(layer.shapeData.height).toBe(1);
    expect(layer.shapeData.fillColor).toBe("#abcdef");
    expect(layer.shapeData.strokeColor).toBe("#111111");
    expect(layer.shapeData.strokeWidth).toBe(0);
    expect(layer.shapeData.cornerRadius).toBe(0);
  });

  it("applies adjustment inspector values for curves and gradient map", () => {
    const doc = makeNewDocument("Doc", 32, 32, 100, "transparent");
    const curves = addAdjustmentLayer(doc, "curves", "Curves");
    applyAdjustmentInspectorState(curves, {
      adjBcBrightness: { value: "0" } as HTMLInputElement,
      adjBcContrast: { value: "0" } as HTMLInputElement,
      adjHsHue: { value: "0" } as HTMLInputElement,
      adjHsSaturation: { value: "0" } as HTMLInputElement,
      adjHsLightness: { value: "0" } as HTMLInputElement,
      adjLevelsBlack: { value: "0" } as HTMLInputElement,
      adjLevelsGamma: { value: "100" } as HTMLInputElement,
      adjLevelsWhite: { value: "255" } as HTMLInputElement,
      adjCurvesMidX: { value: "120" } as HTMLInputElement,
      adjCurvesMidY: { value: "180" } as HTMLInputElement,
      adjCbShCr: { value: "0" } as HTMLInputElement,
      adjCbShMg: { value: "0" } as HTMLInputElement,
      adjCbShYb: { value: "0" } as HTMLInputElement,
      adjCbMtCr: { value: "0" } as HTMLInputElement,
      adjCbMtMg: { value: "0" } as HTMLInputElement,
      adjCbMtYb: { value: "0" } as HTMLInputElement,
      adjCbHlCr: { value: "0" } as HTMLInputElement,
      adjCbHlMg: { value: "0" } as HTMLInputElement,
      adjCbHlYb: { value: "0" } as HTMLInputElement,
      adjGmPreset: { value: "0" } as HTMLSelectElement,
    });

    expect(curves.adjustmentData.params.points).toEqual([{ x: 0, y: 0 }, { x: 120, y: 180 }, { x: 255, y: 255 }]);

    const gradientMap = addAdjustmentLayer(doc, "gradient-map", "Gradient");
    applyAdjustmentInspectorState(gradientMap, {
      adjBcBrightness: { value: "0" } as HTMLInputElement,
      adjBcContrast: { value: "0" } as HTMLInputElement,
      adjHsHue: { value: "0" } as HTMLInputElement,
      adjHsSaturation: { value: "0" } as HTMLInputElement,
      adjHsLightness: { value: "0" } as HTMLInputElement,
      adjLevelsBlack: { value: "0" } as HTMLInputElement,
      adjLevelsGamma: { value: "100" } as HTMLInputElement,
      adjLevelsWhite: { value: "255" } as HTMLInputElement,
      adjCurvesMidX: { value: "128" } as HTMLInputElement,
      adjCurvesMidY: { value: "128" } as HTMLInputElement,
      adjCbShCr: { value: "0" } as HTMLInputElement,
      adjCbShMg: { value: "0" } as HTMLInputElement,
      adjCbShYb: { value: "0" } as HTMLInputElement,
      adjCbMtCr: { value: "0" } as HTMLInputElement,
      adjCbMtMg: { value: "0" } as HTMLInputElement,
      adjCbMtYb: { value: "0" } as HTMLInputElement,
      adjCbHlCr: { value: "0" } as HTMLInputElement,
      adjCbHlMg: { value: "0" } as HTMLInputElement,
      adjCbHlYb: { value: "0" } as HTMLInputElement,
      adjGmPreset: { value: "1" } as HTMLSelectElement,
    });

    expect(Array.isArray(gradientMap.adjustmentData.params.stops)).toBe(true);
    expect((gradientMap.adjustmentData.params.stops as Array<{ position: number }>).length).toBeGreaterThan(0);
  });

  it("applies smart object inspector state and rerenders the source", () => {
    const layer = createSmartObjectLayerFixture();

    applySmartObjectInspectorState(layer, {
      scaleXPercent: 250,
      scaleYPercent: 0,
      rotateDeg: 30,
    });

    expect(layer.smartObjectData.scaleX).toBe(2.5);
    expect(layer.smartObjectData.scaleY).toBe(1);
    expect(layer.smartObjectData.rotateDeg).toBe(30);
  });

  it("maps effect inputs into the stored effect values", () => {
    const effects = [createEffect("drop-shadow")];

    applyEffectInputChanges(effects, [
      { index: 0, field: "enabled", value: "", checked: false },
      { index: 0, field: "color", value: "#ff0000" },
      { index: 0, field: "blur", value: "12" },
      { index: 0, field: "opacity", value: "65" },
    ]);

    expect(effects[0].enabled).toBe(false);
    expect(effects[0].color).toBe("#ff0000");
    expect((effects[0] as { blur: number }).blur).toBe(12);
    expect(effects[0].opacity).toBe(0.65);
  });

  it("derives mask inspector UI state from adjustment layer mask state", () => {
    const doc = makeNewDocument("Doc", 32, 32, 100, "transparent");
    const layer = addAdjustmentLayer(doc, "levels", "Levels");

    expect(getMaskInspectorUiState(layer, null)).toEqual({
      hidden: false,
      addDisabled: false,
      deleteDisabled: true,
      editRowHidden: true,
      editChecked: false,
    });

    layer.mask = document.createElement("canvas");
    expect(getMaskInspectorUiState(layer, layer.id)).toEqual({
      hidden: false,
      addDisabled: true,
      deleteDisabled: false,
      editRowHidden: false,
      editChecked: true,
    });

    const text = createTextLayerFixture();
    expect(getMaskInspectorUiState(text, layer.id)).toEqual({
      hidden: true,
      addDisabled: true,
      deleteDisabled: true,
      editRowHidden: true,
      editChecked: false,
    });
  });

  it("renders the active text layer font into the picker input", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    layer.textData.fontFamily = "Times New Roman";

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.render(doc);

    expect((document.getElementById("text-font-family-input") as HTMLInputElement).value).toBe("Times New Roman");
    dom.teardown();
  });

  it("updates the active text layer when a font is selected from the picker", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();
    controller.render(doc);

    const input = document.getElementById("text-font-family-input") as HTMLInputElement;
    input.focus();
    const option = document.querySelector<HTMLButtonElement>("[data-font-family-option='Arial']");
    option?.click();

    expect(layer.textData.fontFamily).toBe("Arial");
    expect(renderEditorState).toHaveBeenCalled();

    dom.teardown();
  });

  it("lets the font input stay empty while the user types a replacement font", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    layer.textData.fontFamily = "Georgia";
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();
    controller.render(doc);

    const input = document.getElementById("text-font-family-input") as HTMLInputElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("");
    expect(layer.textData.fontFamily).toBe("Georgia");
    expect(renderEditorState).not.toHaveBeenCalled();

    input.value = "Verdana";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(layer.textData.fontFamily).toBe("Verdana");
    expect(input.value).toBe("Verdana");
    expect(renderEditorState).toHaveBeenCalledTimes(1);

    dom.teardown();
  });

  it("applies linear gradient fill from inspector state", () => {
    const layer = createTextLayerFixture();
    const gradientFill: TextFill = {
      type: "linear-gradient",
      angle: 45,
      stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }],
    };

    applyTextInspectorState(layer, {
      text: "Gradient",
      fontFamily: "Arial",
      fontSize: 32,
      lineHeight: 1.2,
      kerning: 0,
      boxWidth: null,
      boxHeight: 88,
      alignment: "center",
      fill: gradientFill,
      strokeColor: "#000000",
      strokeWidth: 0,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
    });

    expect(layer.textData.fill).toEqual(gradientFill);
    expect(layer.textData.fillColor).toBe("#ff0000");
    expect(layer.textData.stroke).toBeNull();
    expect(layer.textData.boxHeight).toBe(88);
  });

  it("applies stroke from inspector state when width is positive", () => {
    const layer = createTextLayerFixture();

    applyTextInspectorState(layer, {
      text: "Outlined",
      fontFamily: "Arial",
      fontSize: 24,
      lineHeight: 1.2,
      kerning: 0,
      boxWidth: null,
      boxHeight: null,
      alignment: "left",
      fill: { type: "solid", color: "#ffffff" },
      strokeColor: "#ff0000",
      strokeWidth: 3,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
    });

    expect(layer.textData.stroke).toEqual({ color: "#ff0000", width: 3 });
  });

  it("sets stroke to null when width is zero", () => {
    const layer = createTextLayerFixture();
    layer.textData.stroke = { color: "#ff0000", width: 2 };

    applyTextInspectorState(layer, {
      text: "No stroke",
      fontFamily: "Arial",
      fontSize: 24,
      lineHeight: 1.2,
      kerning: 0,
      boxWidth: null,
      boxHeight: null,
      alignment: "left",
      fill: { type: "solid", color: "#ffffff" },
      strokeColor: "#000000",
      strokeWidth: 0,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
    });

    expect(layer.textData.stroke).toBeNull();
  });

  it("clicking Edit gradient button calls openGradientEditorForText with current fill", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const gradientFill: TextFill = {
      type: "linear-gradient",
      angle: 90,
      stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }],
    };
    layer.textData.fill = gradientFill;
    const openGradientEditorForText = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText,
    });

    controller.bind();
    controller.render(doc);

    const btn = document.getElementById("text-fill-edit-gradient-btn") as HTMLButtonElement;
    btn.click();

    expect(openGradientEditorForText).toHaveBeenCalledTimes(1);
    expect(openGradientEditorForText.mock.calls[0][0]).toEqual(gradientFill);
    expect(typeof openGradientEditorForText.mock.calls[0][1]).toBe("function");

    dom.teardown();
  });

  it("switching fill type to gradient auto-opens gradient editor", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const openGradientEditorForText = vi.fn();
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText,
    });

    controller.bind();
    controller.render(doc);

    const select = document.getElementById("text-fill-type-select") as HTMLSelectElement;
    select.value = "linear-gradient";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(openGradientEditorForText).toHaveBeenCalledTimes(1);
    const passedFill = openGradientEditorForText.mock.calls[0][0];
    expect(passedFill.type).toBe("linear-gradient");
    expect(layer.textData.fill.type).toBe("linear-gradient");

    dom.teardown();
  });

  it("gradient editor onConfirm callback updates layer fill", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const gradientFill: TextFill = {
      type: "linear-gradient",
      angle: 45,
      stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#00ff00" }],
    };
    layer.textData.fill = gradientFill;
    let capturedOnConfirm: ((result: GradientEditorResult) => void) | null = null;
    const openGradientEditorForText = vi.fn((_fill: LinearGradientFill | RadialGradientFill, onConfirm: (result: GradientEditorResult) => void) => {
      capturedOnConfirm = onConfirm;
    });
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText,
    });

    controller.bind();
    controller.render(doc);

    const btn = document.getElementById("text-fill-edit-gradient-btn") as HTMLButtonElement;
    btn.click();

    expect(capturedOnConfirm).toBeTruthy();

    // Simulate the gradient editor returning a new config
    const newConfig: GradientConfig = {
      gradientType: "radial",
      nodes: [
        { id: "a", x: 0, y: 0, color: "#000000" },
        { id: "b", x: 1, y: 1, color: "#ffffff" },
      ],
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    };
    capturedOnConfirm!({ config: newConfig });

    expect(layer.textData.fill.type).toBe("radial-gradient");
    expect(renderEditorState).toHaveBeenCalled();

    dom.teardown();
  });

  it("applyTextInspectorState sets underline and strikethrough on the layer", () => {
    const layer = createTextLayerFixture();
    expect(layer.textData.underline).toBe(false);
    expect(layer.textData.strikethrough).toBe(false);

    applyTextInspectorState(layer, {
      text: "Decorated",
      fontFamily: "Arial",
      fontSize: 24,
      lineHeight: 1.2,
      kerning: 0,
      boxWidth: null,
      boxHeight: 72,
      alignment: "left",
      fill: { type: "solid", color: "#ffffff" },
      strokeColor: "#000000",
      strokeWidth: 0,
      bold: false,
      italic: false,
      underline: true,
      strikethrough: true,
    });

    expect(layer.textData.underline).toBe(true);
    expect(layer.textData.strikethrough).toBe(true);
    expect(layer.textData.boxHeight).toBe(72);
  });

  it("updates text box height from the inspector input", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();
    controller.render(doc);

    const heightInput = document.getElementById("text-box-height-input") as HTMLInputElement;
    heightInput.value = "96";
    heightInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(layer.textData.boxHeight).toBe(96);

    heightInput.value = "";
    heightInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(layer.textData.boxHeight).toBeNull();
    expect(renderEditorState).toHaveBeenCalled();

    dom.teardown();
  });

  it("blend mode select change updates layer blendMode and triggers render", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();

    const blendSelect = document.getElementById("inspector-blend-select") as HTMLSelectElement;
    // Add options so jsdom can set the value
    const normalOpt = document.createElement("option");
    normalOpt.value = "";
    normalOpt.textContent = "Normal";
    blendSelect.appendChild(normalOpt);
    const multiplyOpt = document.createElement("option");
    multiplyOpt.value = "multiply";
    multiplyOpt.textContent = "Multiply";
    blendSelect.appendChild(multiplyOpt);

    blendSelect.value = "multiply";
    blendSelect.dispatchEvent(new Event("change"));

    expect(layer.blendMode).toBe("multiply");
    expect(renderEditorState).toHaveBeenCalled();

    // Switching back to Normal (empty value) clears blendMode
    blendSelect.value = "";
    blendSelect.dispatchEvent(new Event("change"));

    expect(layer.blendMode).toBeUndefined();

    dom.teardown();
  });

  it("adds effects with undo history and supports inline editing", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const renderEditorState = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();
    controller.render(doc);

    const addSelect = document.getElementById("effects-add-select") as HTMLSelectElement;
    addSelect.appendChild(new Option("Drop Shadow", "drop-shadow"));
    addSelect.value = "drop-shadow";
    addSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(layer.effects).toHaveLength(1);
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.history[0]).toBe("Added Drop Shadow");

    controller.render(doc);
    const enabledInput = document.querySelector<HTMLInputElement>("[data-effect-field='enabled']");
    enabledInput!.checked = false;
    enabledInput!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(layer.effects?.[0]?.enabled).toBe(false);
    expect(doc.undoStack).toHaveLength(2);
    expect(doc.history[0]).toBe("Edited Drop Shadow");

    controller.render(doc);
    const blurInput = document.querySelector<HTMLInputElement>("[data-effect-field='blur']");
    expect(blurInput).toBeTruthy();
    blurInput!.value = "28";
    blurInput!.dispatchEvent(new Event("input", { bubbles: true }));
    blurInput!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(layer.effects?.[0]).toMatchObject({ type: "drop-shadow", blur: 28 });
    expect(doc.undoStack).toHaveLength(3);
    expect(doc.history[0]).toBe("Edited Drop Shadow");
    expect(renderEditorState).toHaveBeenCalled();

    dom.teardown();
  });

  it("applies, clears, and saves presets from the existing inspector workflow", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    const showToast = vi.fn();

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();
    controller.render(doc);

    const presetSelect = document.getElementById("effects-preset-select") as HTMLSelectElement;
    presetSelect.appendChild(new Option("Soft Shadow", "0"));
    presetSelect.value = "0";
    presetSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(layer.effects).toEqual([
      { type: "drop-shadow", color: "#000000", offsetX: 0, offsetY: 6, blur: 16, opacity: 0.3, enabled: true },
    ]);
    expect(doc.history[0]).toBe('Applied preset "Soft Shadow"');

    const saveBtn = document.getElementById("effects-save-preset-btn") as HTMLButtonElement;
    const nameInput = document.getElementById("save-preset-name-input") as HTMLInputElement;
    saveBtn.click();
    nameInput.value = "My Preset";
    (document.getElementById("save-preset-submit-btn") as HTMLButtonElement).click();

    expect(showToast).toHaveBeenCalledWith('Saved preset "My Preset"');
    expect(localStorage.getItem("vision-goblin-style-presets")).toContain("My Preset");

    controller.render(doc);
    const deleteBtn = document.querySelector<HTMLElement>("[data-effect-delete-index='0']");
    deleteBtn?.click();

    expect(layer.effects).toEqual([]);
    expect(doc.history[0]).toBe("Removed layer effect");

    presetSelect.value = "0";
    presetSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const clearBtn = document.getElementById("effects-clear-btn") as HTMLButtonElement;
    clearBtn.click();

    expect(layer.effects).toEqual([]);
    expect(doc.history[0]).toBe("Cleared layer effects");

    dom.teardown();
  });

  it("updates an existing custom preset instead of duplicating it", () => {
    const dom = setupInspectorDomFixture();
    const { doc, layer } = createTextDocumentFixture();
    layer.effects = [createEffect("outline")];
    const showToast = vi.fn();

    localStorage.setItem("vision-goblin-style-presets", JSON.stringify([
      { name: "My Preset", builtIn: false, effects: [createEffect("drop-shadow")] },
    ]));

    const controller = createInspectorController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getMaskEditTarget: () => null,
      setMaskEditTarget: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
      log: vi.fn(),
      openGradientEditorForText: vi.fn(),
    });

    controller.bind();
    controller.render(doc);

    (document.getElementById("effects-save-preset-btn") as HTMLButtonElement).click();
    const nameInput = document.getElementById("save-preset-name-input") as HTMLInputElement;
    nameInput.value = " my preset ";
    (document.getElementById("save-preset-submit-btn") as HTMLButtonElement).click();

    const saved = JSON.parse(localStorage.getItem("vision-goblin-style-presets") ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.effects).toEqual([createEffect("outline")]);
    expect(showToast).toHaveBeenCalledWith('Updated preset "my preset"');

    dom.teardown();
  });
});
