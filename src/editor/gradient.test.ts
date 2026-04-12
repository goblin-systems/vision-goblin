import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import {
  addGradientNode,
  addGradientNodeAtPosition,
  applyGradientToSelection,
  createDefaultGradientConfig,
  createGradientSampler,
  createDefaultGradientNodes,
  gradientConfigToTextFill,
  gradientNodesToStops,
  gradientStopsToNodes,
  moveGradientNode,
  removeGradientNode,
  sampleGradientColourHex,
  sampleGradientCurveY,
  textFillToGradientConfig,
  updateGradientNodeColour,
  type GradientConfig,
} from "./gradient";
import { getFillGradientNoOverlapMessage, getFillGradientSelectionRequiredMessage } from "./fillGradientValidation";
import { installPixelCanvasMock, readPixel, setPixel } from "../test/pixelCanvasMock";

describe("gradient domain", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installPixelCanvasMock();
  });

  it("manages intermediate nodes while preserving endpoints", () => {
    const defaults = createDefaultGradientNodes("#000000", "#FFFFFF");
    const withNode = addGradientNode(defaults);
    const inserted = withNode[1];

    expect(withNode).toHaveLength(3);
    expect(inserted.x).toBe(0.5);

    const moved = moveGradientNode(withNode, inserted.id, 0.8, 0.2);
    expect(moved[1].x).toBe(0.8);
    expect(moved[1].y).toBe(0.2);

    const recoloured = updateGradientNodeColour(moved, inserted.id, "#FF0000");
    expect(recoloured[1].color).toBe("#FF0000");

    const removed = removeGradientNode(recoloured, inserted.id);
    expect(removed).toHaveLength(2);
    expect(removed[0].x).toBe(0);
    expect(removed[1].x).toBe(1);
  });

  it("adds a node at an explicit curve position", () => {
    const defaults = createDefaultGradientNodes("#000000", "#FFFFFF");
    const withNode = addGradientNodeAtPosition(defaults, 0.25, 0.75, "#FF0000");

    expect(withNode).toHaveLength(3);
    expect(withNode[1]).toMatchObject({ x: 0.25, y: 0.75, color: "#FF0000" });
    expect(withNode[0].x).toBe(0);
    expect(withNode[2].x).toBe(1);
  });

  it("samples colours through a multi-node curve", () => {
    const custom = [
      { id: "start", x: 0, y: 0, color: "#000000" },
      { id: "mid", x: 0.5, y: 0.25, color: "#FF0000" },
      { id: "end", x: 1, y: 1, color: "#FFFFFF" },
    ];

    expect(sampleGradientColourHex(custom, 0.5)).toBe("#800000");
    expect(sampleGradientColourHex(custom, 1)).toBe("#FFFFFF");
  });

  it("reuses cached sampling semantics across curve and colour lookups", () => {
    const custom = [
      { id: "start", x: 0, y: 0, color: "#000000" },
      { id: "mid", x: 0.5, y: 0.25, color: "#FF0000" },
      { id: "end", x: 1, y: 1, color: "#FFFFFF" },
    ];

    const sampler = createGradientSampler(custom);
    const positions = [0, 0.125, 0.25, 0.5, 0.75, 1];

    expect(createGradientSampler(custom)).toBe(sampler);

    for (const position of positions) {
      expect(sampler.sampleCurveY(position)).toBe(sampleGradientCurveY(custom, position));
      expect(sampler.sampleHex(position)).toBe(sampleGradientColourHex(custom, position));
    }
  });

  it("returns an error when gradient colours are invalid", () => {
    const doc = makeNewDocument("Doc", 3, 1, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const config: GradientConfig = {
      gradientType: "linear",
      nodes: [
        { id: "start", x: 0, y: 0, color: "#000000" },
        { id: "end", x: 1, y: 1, color: "#GGGGGG" },
      ],
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config, "canvas");

    expect(result).toEqual({ ok: false, message: "One or more gradient colours are invalid", variant: "error" });
  });

  it("applies a left-to-right gradient across the whole layer when there is no selection", () => {
    const doc = makeNewDocument("Doc", 4, 1, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config);

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });
    expect(readPixel(layer.canvas, 0, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 3, 0).r).toBe(255);
  });

  it("clips gradient application to the effective selection", () => {
    const doc = makeNewDocument("Doc", 5, 1, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 5;
    selectionMask.height = 1;
    setPixel(selectionMask, 1, 0, "#FFFFFF");
    setPixel(selectionMask, 2, 0, "#FFFFFF");
    setPixel(selectionMask, 3, 0, "#FFFFFF");

    setPixel(layer.canvas, 0, 0, "#111111");
    setPixel(layer.canvas, 4, 0, "#222222");
    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 1, y: 0, width: 3, height: 1 };

    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config, "selection");

    expect(result).toEqual({ ok: true, message: "Applied gradient to selection" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 17, g: 17, b: 17, a: 255 });
    expect(readPixel(layer.canvas, 1, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 2, 0).r).toBeGreaterThan(100);
    expect(readPixel(layer.canvas, 3, 0).r).toBe(255);
    expect(readPixel(layer.canvas, 4, 0)).toEqual({ r: 34, g: 34, b: 34, a: 255 });
  });

  it("does not mutate selection-targeted gradients when there is no effective selection", () => {
    const doc = makeNewDocument("Doc", 4, 1, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    setPixel(layer.canvas, 0, 0, "#123456");

    const result = applyGradientToSelection(doc, layer, {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    }, "selection");

    expect(result).toEqual({ ok: false, message: getFillGradientSelectionRequiredMessage("gradient"), variant: "info" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it("returns the shared overlap message when the effective selection misses the active layer", () => {
    const doc = makeNewDocument("Doc", 6, 6, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    layer.x = 4;
    layer.y = 4;
    layer.canvas.width = 2;
    layer.canvas.height = 2;

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 6;
    selectionMask.height = 6;
    setPixel(selectionMask, 0, 0, "#FFFFFF");
    setPixel(selectionMask, 1, 1, "#FFFFFF");

    setPixel(layer.canvas, 0, 0, "#123456");
    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 0, y: 0, width: 2, height: 2 };

    const result = applyGradientToSelection(doc, layer, {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    }, "selection");

    expect(result).toEqual({ ok: false, message: getFillGradientNoOverlapMessage(), variant: "info" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it("ignores the active selection when canvas targeting is chosen", () => {
    const doc = makeNewDocument("Doc", 5, 1, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 5;
    selectionMask.height = 1;
    setPixel(selectionMask, 1, 0, "#FFFFFF");
    setPixel(selectionMask, 2, 0, "#FFFFFF");
    setPixel(selectionMask, 3, 0, "#FFFFFF");
    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 1, y: 0, width: 3, height: 1 };

    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config, "canvas");

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });
    expect(readPixel(layer.canvas, 0, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 1, 0).r).toBeGreaterThan(0);
    expect(readPixel(layer.canvas, 3, 0).r).toBeLessThan(255);
    expect(readPixel(layer.canvas, 4, 0).r).toBe(255);
  });

  it("applies a top-to-bottom gradient when the heading is rotated downward", () => {
    const doc = makeNewDocument("Doc", 1, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 90,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config, "canvas");

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });
    expect(readPixel(layer.canvas, 0, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 0, 1).r).toBeGreaterThan(0);
    expect(readPixel(layer.canvas, 0, 2).r).toBeLessThan(255);
    expect(readPixel(layer.canvas, 0, 3).r).toBe(255);
  });

  it("applies a diagonal gradient based on the heading", () => {
    const doc = makeNewDocument("Doc", 3, 3, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 45,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config, "canvas");

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });
    expect(readPixel(layer.canvas, 0, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 2, 2).r).toBe(255);
    expect(readPixel(layer.canvas, 2, 0).r).toBeGreaterThan(readPixel(layer.canvas, 0, 0).r);
    expect(readPixel(layer.canvas, 0, 2).r).toBeGreaterThan(readPixel(layer.canvas, 0, 0).r);
  });
});

// ---------------------------------------------------------------------------
// Conversion function tests
// ---------------------------------------------------------------------------

describe("gradient conversion functions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installPixelCanvasMock();
  });

  it("gradientNodesToStops with identity curve preserves offsets and colors", () => {
    const nodes = createDefaultGradientNodes("#000000", "#FFFFFF");
    const stops = gradientNodesToStops(nodes);

    expect(stops).toHaveLength(2);
    expect(stops[0].offset).toBe(0);
    expect(stops[1].offset).toBe(1);
    expect(stops[0].color).toBe("#000000");
    expect(stops[1].color).toBe("#FFFFFF");
  });

  it("gradientNodesToStops bakes curve remapping into colors", () => {
    const nodes = [
      { id: "start", x: 0, y: 0, color: "#000000" },
      { id: "mid", x: 0.5, y: 0.25, color: "#FF0000" },
      { id: "end", x: 1, y: 1, color: "#FFFFFF" },
    ];
    const stops = gradientNodesToStops(nodes);

    expect(stops).toHaveLength(3);
    expect(stops[0].offset).toBe(0);
    expect(stops[1].offset).toBe(0.5);
    expect(stops[2].offset).toBe(1);

    // The mid node has y=0.25 (not 0.5), so sampled color at x=0.5 should be
    // remapped to position 0.25 on the color ramp (darker than pure midpoint)
    expect(stops[1].color).toBe(createGradientSampler(nodes).sampleHex(0.5));
    // First and last should still be endpoint colors
    expect(stops[0].color).toBe("#000000");
    expect(stops[2].color).toBe("#FFFFFF");
  });

  it("gradientStopsToNodes round-trip preserves offset and color", () => {
    const originalStops = [
      { offset: 0, color: "#FF0000" },
      { offset: 0.5, color: "#00FF00" },
      { offset: 1, color: "#0000FF" },
    ];
    const nodes = gradientStopsToNodes(originalStops);
    const roundTripped = gradientNodesToStops(nodes);

    expect(roundTripped).toHaveLength(3);
    expect(roundTripped[0].offset).toBe(0);
    expect(roundTripped[1].offset).toBe(0.5);
    expect(roundTripped[2].offset).toBe(1);
    // With identity curve (y=x), colors should pass through unchanged
    expect(roundTripped[0].color).toBe("#FF0000");
    expect(roundTripped[1].color).toBe("#00FF00");
    expect(roundTripped[2].color).toBe("#0000FF");
  });

  it("gradientConfigToTextFill produces LinearGradientFill with correct angle and stops", () => {
    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#FF0000", "#0000FF"),
      headingDegrees: 45,
      centerX: 0.5,
      centerY: 0.5,
    };
    const fill = gradientConfigToTextFill(config);

    expect(fill.type).toBe("linear-gradient");
    if (fill.type === "linear-gradient") {
      expect(fill.angle).toBe(45);
      expect(fill.stops).toHaveLength(2);
      expect(fill.stops[0].offset).toBe(0);
      expect(fill.stops[1].offset).toBe(1);
      expect(fill.stops[0].color).toBe("#FF0000");
      expect(fill.stops[1].color).toBe("#0000FF");
    }
  });

  it("gradientConfigToTextFill produces RadialGradientFill with correct stops", () => {
    const config: GradientConfig = {
      gradientType: "radial",
      nodes: createDefaultGradientNodes("#00FF00", "#FF00FF"),
      headingDegrees: 0,
      centerX: 0.2,
      centerY: 0.8,
    };
    const fill = gradientConfigToTextFill(config);

    expect(fill.type).toBe("radial-gradient");
    if (fill.type === "radial-gradient") {
      expect(fill.stops).toHaveLength(2);
      expect(fill.stops[0].offset).toBe(0);
      expect(fill.stops[1].offset).toBe(1);
      expect(fill.stops[0].color).toBe("#00FF00");
      expect(fill.stops[1].color).toBe("#FF00FF");
      expect(fill.centerX).toBe(0.2);
      expect(fill.centerY).toBe(0.8);
    }
  });

  it("textFillToGradientConfig preserves linear fill data through round-trip", () => {
    const config: GradientConfig = {
      gradientType: "linear",
      nodes: createDefaultGradientNodes("#AA0000", "#00AA00"),
      headingDegrees: 90,
      centerX: 0.5,
      centerY: 0.5,
    };

    const fill = gradientConfigToTextFill(config);
    const restored = textFillToGradientConfig(fill);

    expect(restored.gradientType).toBe("linear");
    expect(restored.headingDegrees).toBe(90);
    expect(restored.centerX).toBe(0.5);
    expect(restored.centerY).toBe(0.5);
    expect(restored.nodes).toHaveLength(2);
    expect(restored.nodes[0].color).toBe("#AA0000");
    expect(restored.nodes[1].color).toBe("#00AA00");
  });

  it("textFillToGradientConfig handles radial fill", () => {
    const fill = {
      type: "radial-gradient" as const,
      stops: [
        { offset: 0, color: "#FFFFFF" },
        { offset: 0.5, color: "#888888" },
        { offset: 1, color: "#000000" },
      ],
      centerX: 0.3,
      centerY: 0.65,
    };
    const config = textFillToGradientConfig(fill);

    expect(config.gradientType).toBe("radial");
    expect(config.headingDegrees).toBe(0);
    expect(config.centerX).toBe(0.3);
    expect(config.centerY).toBe(0.65);
    expect(config.nodes).toHaveLength(3);
    expect(config.nodes[0].x).toBe(0);
    expect(config.nodes[1].x).toBe(0.5);
    expect(config.nodes[2].x).toBe(1);
    // Identity curve: y should equal x
    expect(config.nodes[0].y).toBe(0);
    expect(config.nodes[1].y).toBe(0.5);
    expect(config.nodes[2].y).toBe(1);
  });

  it("createDefaultGradientConfig starts from a linear centered gradient", () => {
    const config = createDefaultGradientConfig();

    expect(config).toEqual(expect.objectContaining({
      gradientType: "linear",
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    }));
    expect(config.nodes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Radial gradient application tests
// ---------------------------------------------------------------------------

describe("radial gradient application", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installPixelCanvasMock();
  });

  it("applies a centered radial gradient with center ≈ first stop and corners ≈ last stop", () => {
    const doc = makeNewDocument("Doc", 5, 5, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const config: GradientConfig = {
      gradientType: "radial",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0.5,
      centerY: 0.5,
    };

    const result = applyGradientToSelection(doc, layer, config, "canvas");

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });

    // Center pixel (2,2) should be near the first stop color (black)
    const center = readPixel(layer.canvas, 2, 2);
    expect(center.r).toBe(0);
    expect(center.g).toBe(0);
    expect(center.b).toBe(0);

    // Corner pixels should be near the last stop color (white)
    const topLeft = readPixel(layer.canvas, 0, 0);
    const bottomRight = readPixel(layer.canvas, 4, 4);
    expect(topLeft.r).toBe(255);
    expect(bottomRight.r).toBe(255);
  });

  it("applies a radial gradient with off-center origin at top-left", () => {
    const doc = makeNewDocument("Doc", 5, 5, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const config: GradientConfig = {
      gradientType: "radial",
      nodes: createDefaultGradientNodes("#000000", "#FFFFFF"),
      headingDegrees: 0,
      centerX: 0,
      centerY: 0,
    };

    const result = applyGradientToSelection(doc, layer, config, "canvas");

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });

    // Top-left pixel (0,0) should be position 0 (the center), so first stop color
    const topLeft = readPixel(layer.canvas, 0, 0);
    expect(topLeft.r).toBe(0);
    expect(topLeft.g).toBe(0);
    expect(topLeft.b).toBe(0);

    // Bottom-right corner should be the farthest from center, so last stop color
    const bottomRight = readPixel(layer.canvas, 4, 4);
    expect(bottomRight.r).toBe(255);
    expect(bottomRight.g).toBe(255);
    expect(bottomRight.b).toBe(255);

    // Intermediate pixels should be between the two
    const mid = readPixel(layer.canvas, 2, 2);
    expect(mid.r).toBeGreaterThan(0);
    expect(mid.r).toBeLessThan(255);
  });
});
