import { vi } from "vitest";

// Polyfill ImageData for jsdom (not provided natively)
if (typeof globalThis.ImageData === "undefined") {
  (globalThis as Record<string, unknown>).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, maybeHeight?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = maybeHeight ?? (dataOrWidth.length / (4 * widthOrHeight));
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

const contextStub = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  ellipse: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  roundRect: vi.fn(),
  strokeRect: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createImageData: vi.fn((w: number, h: number) => new ImageData(w, h)),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) })),
  measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
  putImageData: vi.fn(),
  setTransform: vi.fn(),
  setLineDash: vi.fn(),
  fillStyle: "#000000",
  strokeStyle: "#000000",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  lineCap: "round",
  lineJoin: "round",
  lineWidth: 1,
};

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => contextStub),
});

Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
  value: vi.fn(() => "data:image/png;base64,AAA"),
});

Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  value: vi.fn((callback: (blob: Blob) => void) => callback(new Blob(["test"], { type: "image/png" }))),
});

Object.defineProperty(URL, "createObjectURL", {
  value: vi.fn(() => "blob:test"),
});

Object.defineProperty(URL, "revokeObjectURL", {
  value: vi.fn(),
});
