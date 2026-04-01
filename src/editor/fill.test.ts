import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "./actions/documentActions";
import { applyFillToSelection } from "./fill";

function parseHexColour(colour: string) {
  const hex = colour.startsWith("#") ? colour.slice(1) : colour;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: 255,
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
            const targetX = dx + px;
            const targetY = dy + py;
            if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
              continue;
            }
            if (ctx.globalCompositeOperation === "destination-in") {
              if (source.a === 0) {
                paintPixel(targetX, targetY, { r: 0, g: 0, b: 0, a: 0 });
              }
              continue;
            }
            if (ctx.globalCompositeOperation === "destination-out") {
              if (source.a > 0) {
                paintPixel(targetX, targetY, { r: 0, g: 0, b: 0, a: 0 });
              }
              continue;
            }
            if (source.a > 0) {
              paintPixel(targetX, targetY, source);
            }
          }
        }
      },
    } as unknown as CanvasRenderingContext2D & {
      fillStyle: string;
      globalCompositeOperation: string;
    };

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

describe("applyFillToSelection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installPixelCanvasMock();
  });

  it("fills only pixels covered by the effective selection mask", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    setPixel(selectionMask, 1, 1, "#FFFFFF");
    setPixel(selectionMask, 2, 2, "#FFFFFF");

    setPixel(layer.canvas, 1, 1, "#111111");
    setPixel(layer.canvas, 2, 2, "#222222");
    setPixel(layer.canvas, 0, 0, "#333333");

    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 1, y: 1, width: 2, height: 2 };

    const result = applyFillToSelection(doc, layer, "#FF00AA");

    expect(result.ok).toBe(true);
    expect(readPixel(layer.canvas, 1, 1)).toEqual({ r: 255, g: 0, b: 170, a: 255 });
    expect(readPixel(layer.canvas, 2, 2)).toEqual({ r: 255, g: 0, b: 170, a: 255 });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 51, g: 51, b: 51, a: 255 });
  });

  it("uses the inverted effective selection when selection inversion is active", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    setPixel(layer.canvas, 0, 0, "#111111");
    setPixel(layer.canvas, 1, 1, "#222222");
    setPixel(layer.canvas, 3, 3, "#333333");

    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;
    setPixel(selectionMask, 1, 1, "#FFFFFF");
    setPixel(selectionMask, 2, 2, "#FFFFFF");

    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 1, y: 1, width: 2, height: 2 };
    doc.selectionInverted = true;

    const result = applyFillToSelection(doc, layer, "#00FF00");

    expect(result.ok).toBe(true);
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(readPixel(layer.canvas, 1, 1)).toEqual({ r: 34, g: 34, b: 34, a: 255 });
    expect(readPixel(layer.canvas, 3, 3)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  it("does not mutate when there is no effective selection", () => {
    const doc = makeNewDocument("Doc", 4, 4, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    setPixel(layer.canvas, 0, 0, "#123456");
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 4;
    selectionMask.height = 4;

    doc.selectionMask = selectionMask;
    doc.selectionRect = { x: 0, y: 0, width: 4, height: 4 };

    const result = applyFillToSelection(doc, layer, "#ABCDEF");

    expect(result).toEqual({ ok: false, message: "Create a selection before using Fill", variant: "info" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it("returns an overlap message when the effective selection misses the active layer", () => {
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

    const result = applyFillToSelection(doc, layer, "#ABCDEF");

    expect(result).toEqual({ ok: false, message: "Selection does not overlap the active layer", variant: "info" });
    expect(readPixel(layer.canvas, 0, 0)).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });
});
