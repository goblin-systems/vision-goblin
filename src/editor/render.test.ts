import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCanvas } from "./render";
import { makeNewDocument } from "./actions/documentActions";
import { createTextLayer } from "./documents";

describe("render text-layout chrome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("draws corner and side handles for text-layout transforms", () => {
    const doc = makeNewDocument("Doc", 320, 240, 100, "transparent");
    const editorCanvas = document.createElement("canvas");
    const textLayer = createTextLayer("Headline", 40, 30, { text: "Resize me", boxWidth: 140, boxHeight: 80 });
    doc.layers.push(textLayer);
    doc.activeLayerId = textLayer.id;

    vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 320,
      height: 240,
      right: 320,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const ctx = editorCanvas.getContext("2d")!;
    const rectMock = vi.mocked(ctx.rect);
    rectMock.mockClear();

    renderCanvas({
      editorCanvas,
      getEditorContext: () => ctx,
      doc,
      activeTool: "text",
      activeLayer: textLayer,
      transformIntent: "text-layout",
    });

    const handleRects = rectMock.mock.calls.filter(([x, y, width, height]) => width === 10 && height === 10 && Number.isFinite(x) && Number.isFinite(y));
    expect(handleRects).toHaveLength(8);
  });
});
