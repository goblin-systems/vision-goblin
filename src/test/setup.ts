import { vi } from "vitest";

const contextStub = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  strokeRect: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) })),
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
