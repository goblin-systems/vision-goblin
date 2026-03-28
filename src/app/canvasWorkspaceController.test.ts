import { describe, expect, it } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { findGuideAtPosition, snapLayerPositionForDocument } from "./canvasWorkspaceController";

describe("canvasWorkspaceController helpers", () => {
  it("snaps a layer edge to the nearest guide", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    doc.guides.push({ id: "g1", orientation: "vertical", position: 80 });
    const layer = doc.layers[0]!;
    layer.canvas.width = 40;
    layer.canvas.height = 20;

    const result = snapLayerPositionForDocument({
      doc,
      layer,
      rawX: 43,
      rawY: 10,
      snapEnabled: true,
      showGrid: false,
      gridSize: 16,
    });

    expect(result.x).toBe(40);
    expect(result.lines).toEqual([{ orientation: "vertical", position: 80 }]);
  });

  it("finds a guide using zoom-scaled hit tolerance", () => {
    const doc = makeNewDocument("Doc", 200, 120, 100, "transparent");
    const guide = { id: "g1", orientation: "horizontal" as const, position: 24 };
    doc.guides.push(guide);

    expect(findGuideAtPosition(doc, 12, 25, { originX: 0, originY: 0, scale: 2 })).toEqual(guide);
    expect(findGuideAtPosition(doc, 12, 28, { originX: 0, originY: 0, scale: 2 })).toBeNull();
  });
});
