import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { addAdjustmentLayer } from "../editor/layers";
import { createEffect } from "../editor/layerStyles";
import type { ShapeLayer, SmartObjectLayer, TextLayer } from "../editor/types";
import {
  applyAdjustmentInspectorState,
  applyEffectInputChanges,
  applyShapeInspectorState,
  applySmartObjectInspectorState,
  applyTextInspectorState,
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
      rotationDeg: 0,
      alignment: "left",
      fillColor: "#000000",
      bold: false,
      italic: false,
      boxWidth: null,
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

describe("inspectorController helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      alignment: "center",
      fillColor: "#123456",
      bold: true,
      italic: true,
    });

    expect(layer.textData.text).toBe("Text");
    expect(layer.textData.fontFamily).toBe("Georgia");
    expect(layer.textData.fontSize).toBe(8);
    expect(layer.textData.lineHeight).toBe(0.8);
    expect(layer.textData.kerning).toBe(12);
    expect(layer.textData.boxWidth).toBeNull();
    expect(layer.textData.alignment).toBe("center");
    expect(layer.textData.fillColor).toBe("#123456");
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
});
