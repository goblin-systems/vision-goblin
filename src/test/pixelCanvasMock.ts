import { vi } from "vitest";

export interface PixelRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

type PixelCanvasElement = HTMLCanvasElement & {
  __getPixel?: (x: number, y: number) => PixelRgba;
  __setPixel?: (x: number, y: number, rgba: PixelRgba) => void;
};

function parseHexChannel(value: string) {
  const parsed = Number.parseInt(value, 16);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseRgbChannel(value: string) {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.min(255, Math.round(parsed))) : 0;
}

function parseAlphaChannel(value: string) {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) {
    return 255;
  }
  return Math.max(0, Math.min(255, Math.round(parsed * 255)));
}

function parseColour(colour: string | PixelRgba): PixelRgba {
  if (typeof colour !== "string") {
    return colour;
  }

  const normalized = colour.trim();
  if (normalized === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    const expanded = hex.length === 3 || hex.length === 4
      ? hex.split("").map((value) => `${value}${value}`).join("")
      : hex;
    if (expanded.length === 6 || expanded.length === 8) {
      return {
        r: parseHexChannel(expanded.slice(0, 2)),
        g: parseHexChannel(expanded.slice(2, 4)),
        b: parseHexChannel(expanded.slice(4, 6)),
        a: expanded.length === 8 ? parseHexChannel(expanded.slice(6, 8)) : 255,
      };
    }
  }

  const rgbaMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const [r = "0", g = "0", b = "0", a = "1"] = rgbaMatch[1].split(",");
    return {
      r: parseRgbChannel(r),
      g: parseRgbChannel(g),
      b: parseRgbChannel(b),
      a: normalized.toLowerCase().startsWith("rgba") ? parseAlphaChannel(a) : 255,
    };
  }

  return { r: 0, g: 0, b: 0, a: 255 };
}

function multiplyAlpha(pixel: PixelRgba, alpha: number): PixelRgba {
  const nextAlpha = Math.max(0, Math.min(1, alpha));
  return {
    ...pixel,
    a: Math.round(pixel.a * nextAlpha),
  };
}

function blendSourceOver(source: PixelRgba, destination: PixelRgba): PixelRgba {
  const sourceAlpha = source.a / 255;
  const destinationAlpha = destination.a / 255;
  const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: Math.round(((source.r * sourceAlpha) + (destination.r * destinationAlpha * (1 - sourceAlpha))) / outAlpha),
    g: Math.round(((source.g * sourceAlpha) + (destination.g * destinationAlpha * (1 - sourceAlpha))) / outAlpha),
    b: Math.round(((source.b * sourceAlpha) + (destination.b * destinationAlpha * (1 - sourceAlpha))) / outAlpha),
    a: Math.round(outAlpha * 255),
  };
}

type MockFontKind = "sans" | "serif" | "monospace" | "script" | "display";

function classifyFontFamily(fontFamily: string): MockFontKind {
  const normalized = fontFamily.toLowerCase();
  if (normalized.includes("script")) return "script";
  if (normalized.includes("impact") || normalized.includes("black")) return "display";
  if (normalized.includes("courier") || normalized.includes("console") || normalized.includes("monospace")) return "monospace";
  if (normalized.includes("baskerville") || normalized.includes("garamond") || normalized.includes("georgia") || normalized.includes("palatino") || normalized.includes("times") || normalized.includes("serif")) {
    return "serif";
  }
  return "sans";
}

function parseFontSpec(font: string) {
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px\s+(.+)$/i);
  const size = sizeMatch ? Number.parseFloat(sizeMatch[1]) : 10;
  const family = sizeMatch ? sizeMatch[2].trim().replace(/^['"]|['"]$/g, "") : "sans-serif";
  return {
    size: Number.isFinite(size) ? size : 10,
    family,
    kind: classifyFontFamily(family),
    italic: /\bitalic\b/i.test(font),
    bold: /\b(?:700|bold)\b/i.test(font),
  };
}

function hashFontFamily(fontFamily: string): number {
  let hash = 0;
  for (let index = 0; index < fontFamily.length; index += 1) {
    hash = ((hash * 31) + fontFamily.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function installCanvasContext(canvas: HTMLCanvasElement) {
  let width = 0;
  let height = 0;
  let pixels = new Uint8ClampedArray();

  const ensureSize = () => {
    if (width === canvas.width && height === canvas.height) {
      return;
    }
    const nextWidth = canvas.width;
    const nextHeight = canvas.height;
    const nextPixels = new Uint8ClampedArray(nextWidth * nextHeight * 4);
    const copyWidth = Math.min(width, nextWidth);
    const copyHeight = Math.min(height, nextHeight);
    for (let y = 0; y < copyHeight; y += 1) {
      for (let x = 0; x < copyWidth; x += 1) {
        const fromIndex = (y * width + x) * 4;
        const toIndex = (y * nextWidth + x) * 4;
        nextPixels[toIndex] = pixels[fromIndex];
        nextPixels[toIndex + 1] = pixels[fromIndex + 1];
        nextPixels[toIndex + 2] = pixels[fromIndex + 2];
        nextPixels[toIndex + 3] = pixels[fromIndex + 3];
      }
    }
    width = nextWidth;
    height = nextHeight;
    pixels = nextPixels;
  };

  const readPixelValue = (x: number, y: number): PixelRgba => {
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

  const writeRawPixel = (x: number, y: number, rgba: PixelRgba) => {
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

  const applyPixel = (x: number, y: number, rgba: PixelRgba, compositeOperation: GlobalCompositeOperation) => {
    const source = multiplyAlpha(rgba, ctx.globalAlpha);
    const destination = readPixelValue(x, y);
    switch (compositeOperation) {
      case "destination-in": {
        const factor = source.a / 255;
        writeRawPixel(x, y, {
          r: Math.round(destination.r * factor),
          g: Math.round(destination.g * factor),
          b: Math.round(destination.b * factor),
          a: Math.round(destination.a * factor),
        });
        return;
      }
      case "destination-out": {
        const factor = 1 - source.a / 255;
        writeRawPixel(x, y, {
          r: Math.round(destination.r * factor),
          g: Math.round(destination.g * factor),
          b: Math.round(destination.b * factor),
          a: Math.round(destination.a * factor),
        });
        return;
      }
      default:
        writeRawPixel(x, y, blendSourceOver(source, destination));
    }
  };

  const glyphWidthForChar = (char: string, font: ReturnType<typeof parseFontSpec>) => {
    if (char === " ") return Math.max(2, Math.round(font.size * 0.34));
    const baseByKind: Record<MockFontKind, number> = {
      sans: 0.5,
      serif: 0.56,
      monospace: 0.72,
      script: 0.46,
      display: 0.82,
    };
    const widthFactor = baseByKind[font.kind]
      + (font.bold ? 0.03 : 0)
      + (font.italic ? 0.02 : 0)
      + ((hashFontFamily(font.family) % 5) * 0.008);
    return Math.max(2, Math.round(font.size * widthFactor));
  };

  const measureTextWidth = (text: string, font: ReturnType<typeof parseFontSpec>) => {
    return Array.from(text).reduce((sum, char) => sum + glyphWidthForChar(char, font), 0);
  };

  const drawGlyph = (char: string, x: number, y: number) => {
    if (char === " ") {
      return;
    }
    const font = parseFontSpec(String(ctx.font));
    const hash = hashFontFamily(font.family);
    const charHash = char.charCodeAt(0);
    const rgba = parseColour(String(ctx.fillStyle));
    const glyphWidth = glyphWidthForChar(char, font);
    const glyphHeight = Math.max(2, Math.round(font.size * 0.8));
    const top = Math.round(y);
    const left = Math.round(x);
    const variantInset = hash % 3;

    if (font.kind === "script") {
      for (let row = 0; row < glyphHeight; row += 1) {
        const rowOffset = Math.floor(((glyphHeight - row) / Math.max(1, glyphHeight)) * Math.max(1, glyphWidth * 0.2));
        paintRect(left + rowOffset, top + row, Math.max(1, glyphWidth - rowOffset), 1, rgba);
      }
    } else {
      const baseInset = font.kind === "display" ? 0 : Math.min(Math.floor(glyphWidth / 5), variantInset + (font.kind === "serif" ? 1 : 0));
      paintRect(left + baseInset, top, Math.max(1, glyphWidth - (baseInset * 2)), glyphHeight, rgba);
      if (font.kind === "serif" || font.kind === "display") {
        const barHeight = Math.max(1, Math.round(font.size * (font.kind === "display" ? 0.18 : 0.1)));
        paintRect(left, top, glyphWidth, barHeight, rgba);
        paintRect(left, top + glyphHeight - barHeight, glyphWidth, barHeight, rgba);
      }
      if (font.kind === "monospace") {
        paintRect(left + Math.floor(glyphWidth * 0.45), top, 1, glyphHeight, rgba);
      }
      if (font.kind === "sans" && (hash % 2) === 0) {
        paintRect(left, top + Math.floor(glyphHeight * 0.45), glyphWidth, 1, rgba);
      }
      if ((charHash % 2) === 0) {
        paintRect(left + Math.floor(glyphWidth * 0.2), top + Math.floor(glyphHeight * 0.3), Math.max(1, Math.floor(glyphWidth * 0.55)), 1, rgba);
      } else {
        paintRect(left + Math.floor(glyphWidth * 0.25), top + Math.floor(glyphHeight * 0.2), 1, Math.max(1, Math.floor(glyphHeight * 0.55)), rgba);
      }
    }

    if (font.bold) {
      paintRect(left + 1, top, Math.max(1, glyphWidth - 1), glyphHeight, rgba);
    }
    if (font.italic) {
      for (let row = 0; row < glyphHeight; row += 2) {
        paintRect(left + Math.floor((glyphHeight - row) * 0.08), top + row, Math.max(1, glyphWidth - 1), 1, rgba);
      }
    }
  };

  const drawCanvas = (sourceCanvas: HTMLCanvasElement, dx: number, dy: number, dw = sourceCanvas.width, dh = sourceCanvas.height) => {
    ensureSize();
    const sourceGetPixel = (sourceCanvas as PixelCanvasElement).__getPixel;
    if (!sourceGetPixel || dw <= 0 || dh <= 0) {
      return;
    }
    for (let targetY = 0; targetY < dh; targetY += 1) {
      for (let targetX = 0; targetX < dw; targetX += 1) {
        const sourceX = Math.floor((targetX / dw) * sourceCanvas.width);
        const sourceY = Math.floor((targetY / dh) * sourceCanvas.height);
        const sourcePixel = sourceGetPixel(sourceX, sourceY);
        applyPixel(dx + targetX, dy + targetY, sourcePixel, ctx.globalCompositeOperation);
      }
    }
  };

  const paintRect = (x: number, y: number, w: number, h: number, rgba: PixelRgba) => {
    ensureSize();
    const startX = Math.max(0, Math.floor(x));
    const startY = Math.max(0, Math.floor(y));
    const endX = Math.min(width, Math.ceil(x + w));
    const endY = Math.min(height, Math.ceil(y + h));
    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        applyPixel(px, py, rgba, ctx.globalCompositeOperation);
      }
    }
  };

  const ctx = {
    canvas,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    textBaseline: "alphabetic",
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    globalAlpha: 1,
    lineCap: "round" as CanvasLineCap,
    lineJoin: "round" as CanvasLineJoin,
    lineWidth: 1,
    imageSmoothingEnabled: true,
    clearRect: (x: number, y: number, w: number, h: number) => {
      ensureSize();
      const startX = Math.max(0, Math.floor(x));
      const startY = Math.max(0, Math.floor(y));
      const endX = Math.min(width, Math.ceil(x + w));
      const endY = Math.min(height, Math.ceil(y + h));
      for (let py = startY; py < endY; py += 1) {
        for (let px = startX; px < endX; px += 1) {
          writeRawPixel(px, py, { r: 0, g: 0, b: 0, a: 0 });
        }
      }
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      paintRect(x, y, w, h, parseColour(String(ctx.fillStyle)));
    },
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    rect: () => undefined,
    roundRect: () => undefined,
    arc: () => undefined,
    ellipse: () => undefined,
    fill: () => {
      paintRect(0, 0, canvas.width, canvas.height, parseColour(String(ctx.fillStyle)));
    },
    stroke: () => {
      paintRect(0, 0, canvas.width, canvas.height, parseColour(String(ctx.strokeStyle)));
    },
    fillText: (text: string, x: number, y: number) => {
      const font = parseFontSpec(String(ctx.font));
      let cursor = x;
      for (const char of text) {
        drawGlyph(char, cursor, y);
        cursor += glyphWidthForChar(char, font);
      }
    },
    strokeText: (text: string, x: number, y: number) => {
      // Stroke draws outlines using strokeStyle; for the mock we treat it
      // similarly to fillText but using strokeStyle colour.
      const savedFill = ctx.fillStyle;
      ctx.fillStyle = ctx.strokeStyle;
      const font = parseFontSpec(String(ctx.font));
      let cursor = x;
      for (const char of text) {
        drawGlyph(char, cursor, y);
        cursor += glyphWidthForChar(char, font);
      }
      ctx.fillStyle = savedFill;
    },
    measureText: (text: string) => ({
      width: measureTextWidth(text, parseFontSpec(String(ctx.font))),
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    setTransform: () => undefined,
    resetTransform: () => undefined,
    createImageData: (w: number, h: number) => new ImageData(w, h),
    getImageData: (x: number, y: number, w: number, h: number) => {
      ensureSize();
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py += 1) {
        for (let px = 0; px < w; px += 1) {
          const source = readPixelValue(x + px, y + py);
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
      for (let py = 0; py < imageData.height; py += 1) {
        for (let px = 0; px < imageData.width; px += 1) {
          const index = (py * imageData.width + px) * 4;
          writeRawPixel(dx + px, dy + py, {
            r: imageData.data[index],
            g: imageData.data[index + 1],
            b: imageData.data[index + 2],
            a: imageData.data[index + 3],
          });
        }
      }
    },
    drawImage: (source: CanvasImageSource, ...args: number[]) => {
      if (!(source instanceof HTMLCanvasElement)) {
        return;
      }
      if (args.length >= 8) {
        const [, , , , dx, dy, dw, dh] = args;
        drawCanvas(source, dx, dy, dw, dh);
        return;
      }
      if (args.length >= 4) {
        const [dx, dy, dw, dh] = args;
        drawCanvas(source, dx, dy, dw, dh);
        return;
      }
      const [dx = 0, dy = 0] = args;
      drawCanvas(source, dx, dy);
    },
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    setLineDash: () => undefined,
    strokeRect: () => undefined,
  } as unknown as CanvasRenderingContext2D & {
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    globalCompositeOperation: GlobalCompositeOperation;
    globalAlpha: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    lineWidth: number;
  };

  Object.defineProperty(canvas, "getContext", {
    value: vi.fn((kind: string) => (kind === "2d" ? ctx : null)),
    configurable: true,
  });

  Object.defineProperty(canvas, "__getPixel", {
    value: (x: number, y: number) => readPixelValue(x, y),
    configurable: true,
  });

  Object.defineProperty(canvas, "__setPixel", {
    value: (x: number, y: number, rgba: PixelRgba) => writeRawPixel(x, y, rgba),
    configurable: true,
  });
}

export function installPixelCanvasMock() {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === "canvas") {
      installCanvasContext(element as HTMLCanvasElement);
    }
    return element;
  }) as typeof document.createElement);
}

export function setPixel(canvas: HTMLCanvasElement, x: number, y: number, colour: string | PixelRgba) {
  const setCanvasPixel = (canvas as PixelCanvasElement).__setPixel;
  if (!setCanvasPixel) {
    throw new Error("Pixel canvas mock is not installed on this canvas");
  }
  setCanvasPixel(x, y, parseColour(colour));
}

export function readPixel(canvas: HTMLCanvasElement, x: number, y: number): PixelRgba {
  const getCanvasPixel = (canvas as PixelCanvasElement).__getPixel;
  if (!getCanvasPixel) {
    throw new Error("Pixel canvas mock is not installed on this canvas");
  }
  return getCanvasPixel(x, y);
}
