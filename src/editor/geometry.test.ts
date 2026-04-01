import { describe, expect, it } from "vitest";
import { buildCropRect, getCanvasBounds, getResizeOffset } from "./geometry";
import type { DocumentState, ResizeAnchor } from "./types";

function makeDoc(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    name: "Test",
    width: 800,
    height: 600,
    zoom: 100,
    panX: 0,
    panY: 0,
    dirty: false,
    layers: [],
    activeLayerId: "layer-1",
    selectedLayerIds: [],
    history: [],
    historyIndex: 0,
    sourcePath: null,
    projectPath: null,
    background: "white",
    undoStack: [],
    redoStack: [],
    cropRect: null,
    selectionRect: null,
    selectionShape: "rect",
    selectionInverted: false,
    selectionPath: null,
    selectionMask: null,
    guides: [],
    ...overrides,
  };
}

describe("editor geometry", () => {
  it("computes centered canvas bounds", () => {
    const bounds = getCanvasBounds(makeDoc(), { width: 1000, height: 800 });
    expect(bounds.originX).toBe(100);
    expect(bounds.originY).toBe(100);
    expect(bounds.width).toBe(800);
    expect(bounds.height).toBe(600);
  });

  it("applies zoom and pan to canvas bounds", () => {
    const bounds = getCanvasBounds(makeDoc({ zoom: 150, panX: 10, panY: -20 }), { width: 1400, height: 1000 });
    expect(bounds.width).toBe(1200);
    expect(bounds.height).toBe(900);
    expect(bounds.originX).toBe(110);
    expect(bounds.originY).toBe(30);
  });

  it("builds crop rectangles from any drag direction", () => {
    const crop = buildCropRect(500, 400, 100, 50, makeDoc());
    expect(crop).toEqual({ x: 100, y: 50, width: 400, height: 350 });
  });

  it("clamps crop rectangles to document bounds", () => {
    const crop = buildCropRect(-20, -30, 900, 1000, makeDoc());
    expect(crop).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it.each<readonly [ResizeAnchor, { x: number; y: number }]>([
    ["top-left", { x: 0, y: 0 }],
    ["center", { x: 100, y: 50 }],
    ["bottom-right", { x: 200, y: 100 }],
    ["top-center", { x: 100, y: 0 }],
    ["center-left", { x: 0, y: 50 }],
  ])("computes resize offset for %s", (anchor, expected) => {
    expect(getResizeOffset(anchor, 800, 600, 1000, 700)).toEqual(expected);
  });
});
