import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import {
  addGradientNode,
  addGradientNodeAtPosition,
  applyGradientToSelection,
  createGradientSampler,
  createDefaultGradientNodes,
  moveGradientNode,
  removeGradientNode,
  sampleGradientColourHex,
  sampleGradientCurveY,
  updateGradientNodeColour,
} from "./gradient";

function parseHexColour(colour: string) {
  const hex = colour.startsWith("#") ? colour.slice(1) : colour;
  const expanded = hex.length === 3 ? hex.split("").map((value) => `${value}${value}`).join("") : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: expanded.length >= 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
  };
}

function installPixelCanvasMock() {
  const originalCreateElement = document.createElement.bind(document);

  const attachPixelContext = (canvas: HTMLCanvasElement) => {
    let width = 0;
    let height = 0;
    let pixels = new Uint8ClampedArray();

    const ensureSize = () => {
      if (width === canvas.width && height === canvas.height) {
        return;
      }
      width = canvas.width;
      height = canvas.height;
      pixels = new Uint8ClampedArray(width * height * 4);
    };

    const paintPixel = (x: number, y: number, rgba: { r: number; g: number; b: number; a: number }) => {
      ensureSize();
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }
      const index = (y * width + x) * 4;
      pixels[index] = rgba.r;
      pixels[index + 1] = rgba.g;
      pixels[index + 2] = rgba.b;
      pixels[index + 3] = rgba.a;
    };

    const readPixel = (x: number, y: number) => {
      ensureSize();
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const index = (y * width + x) * 4;
      return {
        r: pixels[index],
        g: pixels[index + 1],
        b: pixels[index + 2],
        a: pixels[index + 3],
      };
    };

    const ctx = {
      fillStyle: "#000000",
      globalCompositeOperation: "source-over",
      clearRect: (x: number, y: number, w: number, h: number) => {
        ensureSize();
        for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) {
          for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
            paintPixel(px, py, { r: 0, g: 0, b: 0, a: 0 });
          }
        }
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        ensureSize();
        const rgba = parseHexColour(String(ctx.fillStyle));
        for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) {
          for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
            paintPixel(px, py, rgba);
          }
        }
      },
      getImageData: (x: number, y: number, w: number, h: number) => {
        ensureSize();
        const data = new Uint8ClampedArray(w * h * 4);
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const source = readPixel(x + px, y + py);
            const index = (py * w + px) * 4;
            data[index] = source.r;
            data[index + 1] = source.g;
            data[index + 2] = source.b;
            data[index + 3] = source.a;
          }
        }
        return new ImageData(data, w, h);
      },
      putImageData: (imageData: ImageData, dx: number, dy: number) => {
        ensureSize();
        for (let py = 0; py < imageData.height; py++) {
          for (let px = 0; px < imageData.width; px++) {
            const index = (py * imageData.width + px) * 4;
            paintPixel(dx + px, dy + py, {
              r: imageData.data[index],
              g: imageData.data[index + 1],
              b: imageData.data[index + 2],
              a: imageData.data[index + 3],
            });
          }
        }
      },
      drawImage: (sourceCanvas: HTMLCanvasElement, dx: number, dy: number) => {
        ensureSize();
        const sourceGetPixel = (sourceCanvas as HTMLCanvasElement & { __getPixel?: (x: number, y: number) => { r: number; g: number; b: number; a: number } }).__getPixel;
        if (!sourceGetPixel) {
          return;
        }
        for (let py = 0; py < sourceCanvas.height; py++) {
          for (let px = 0; px < sourceCanvas.width; px++) {
            const source = sourceGetPixel(px, py);
            if (source.a > 0) {
              paintPixel(dx + px, dy + py, source);
            }
          }
        }
      },
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
    } as unknown as CanvasRenderingContext2D & { fillStyle: string; globalCompositeOperation: string };

    Object.defineProperty(canvas, "getContext", {
      value: vi.fn((kind: string) => (kind === "2d" ? ctx : null)),
      configurable: true,
    });
    Object.defineProperty(canvas, "__getPixel", {
      value: (x: number, y: number) => readPixel(x, y),
      configurable: true,
    });
    Object.defineProperty(canvas, "__setPixel", {
      value: (x: number, y: number, rgba: { r: number; g: number; b: number; a: number }) => paintPixel(x, y, rgba),
      configurable: true,
    });
  };

  vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === "canvas") {
      attachPixelContext(element as HTMLCanvasElement);
    }
    return element;
  }) as typeof document.createElement);
}

function setPixel(canvas: HTMLCanvasElement, x: number, y: number, colour: string) {
  const rgba = parseHexColour(colour);
  (canvas as HTMLCanvasElement & { __setPixel: (px: number, py: number, value: { r: number; g: number; b: number; a: number }) => void }).__setPixel(x, y, rgba);
}

function readPixel(canvas: HTMLCanvasElement, x: number, y: number) {
  return (canvas as HTMLCanvasElement & { __getPixel: (px: number, py: number) => { r: number; g: number; b: number; a: number } }).__getPixel(x, y);
}

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

    const result = applyGradientToSelection(doc, layer, [
      { id: "start", x: 0, y: 0, color: "#000000" },
      { id: "end", x: 1, y: 1, color: "#GGGGGG" },
    ]);

    expect(result).toEqual({ ok: false, message: "One or more gradient colours are invalid", variant: "error" });
  });

  it("applies a left-to-right gradient across the whole layer when there is no selection", () => {
    const doc = makeNewDocument("Doc", 4, 1, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const result = applyGradientToSelection(doc, layer, createDefaultGradientNodes("#000000", "#FFFFFF"));

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

    const result = applyGradientToSelection(doc, layer, createDefaultGradientNodes("#000000", "#FFFFFF"), "selection");

    expect(result).toEqual({ ok: true, message: "Applied gradient to selection" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 17, g: 17, b: 17, a: 255 });
    expect(readPixel(layer.canvas, 1, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 2, 0).r).toBeGreaterThan(100);
    expect(readPixel(layer.canvas, 3, 0).r).toBe(255);
    expect(readPixel(layer.canvas, 4, 0)).toEqual({ r: 34, g: 34, b: 34, a: 255 });
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

    const result = applyGradientToSelection(doc, layer, createDefaultGradientNodes("#000000", "#FFFFFF"), "canvas");

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

    const result = applyGradientToSelection(doc, layer, createDefaultGradientNodes("#000000", "#FFFFFF"), "canvas", 90);

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

    const result = applyGradientToSelection(doc, layer, createDefaultGradientNodes("#000000", "#FFFFFF"), "canvas", 45);

    expect(result).toEqual({ ok: true, message: "Applied gradient to layer" });
    expect(readPixel(layer.canvas, 0, 0).r).toBe(0);
    expect(readPixel(layer.canvas, 2, 2).r).toBe(255);
    expect(readPixel(layer.canvas, 2, 0).r).toBeGreaterThan(readPixel(layer.canvas, 0, 0).r);
    expect(readPixel(layer.canvas, 0, 2).r).toBeGreaterThan(readPixel(layer.canvas, 0, 0).r);
  });
});
