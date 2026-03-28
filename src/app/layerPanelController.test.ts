import { describe, expect, it } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { isLayerDeletionBlocked, shouldCancelTransformAfterVisibilityToggle } from "./layerPanelController";

describe("layerPanelController helpers", () => {
  it("blocks deleting the background or last layer", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "white");
    const layer = doc.layers[0]!;

    expect(isLayerDeletionBlocked(doc, layer.id)).toMatchObject({ blocked: true, reason: "protected" });
  });

  it("cancels transform only when the active transformed layer becomes hidden", () => {
    expect(shouldCancelTransformAfterVisibilityToggle(false, "layer-1", "layer-1")).toBe(true);
    expect(shouldCancelTransformAfterVisibilityToggle(true, "layer-1", "layer-1")).toBe(false);
    expect(shouldCancelTransformAfterVisibilityToggle(false, "layer-1", "layer-2")).toBe(false);
  });
});
