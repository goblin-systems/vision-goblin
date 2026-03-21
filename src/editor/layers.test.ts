import { describe, expect, it } from "vitest";
import { createBlankDocument } from "./documents";
import {
  addLayer,
  canDeleteLayer,
  deleteLayer,
  duplicateLayer,
  moveLayer,
  renameLayer,
  selectLayer,
  setBackgroundLayerColor,
  toggleLayerLock,
  toggleLayerVisibility,
} from "./layers";

describe("editor layers", () => {
  it("adds a new layer and selects it", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const layer = addLayer(doc);
    expect(doc.layers).toHaveLength(3);
    expect(doc.activeLayerId).toBe(layer.id);
    expect(layer.name).toBe("Layer 3");
  });

  it("renames a layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[1];
    expect(renameLayer(doc, target.id, "Foreground")).toBe(true);
    expect(target.name).toBe("Foreground");
  });

  it("duplicates a layer and selects the copy", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const copy = duplicateLayer(doc, doc.layers[1].id);
    expect(copy).not.toBeNull();
    expect(doc.layers).toHaveLength(3);
    expect(doc.activeLayerId).toBe(copy?.id);
  });

  it("deletes a normal layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const extra = addLayer(doc, "Extra");
    const result = deleteLayer(doc, extra.id);
    expect(result.ok).toBe(true);
    expect(doc.layers.some((layer) => layer.id === extra.id)).toBe(false);
  });

  it("does not delete the background layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const result = deleteLayer(doc, doc.layers[0].id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("protected");
  });

  it("reorders editable layers but not background", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const second = addLayer(doc, "Layer 3");
    expect(moveLayer(doc, second.id, -1)).toBe(true);
    expect(doc.layers[1].id).toBe(second.id);
    expect(moveLayer(doc, doc.layers[0].id, 1)).toBe(false);
  });

  it("toggles layer visibility", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[1];
    expect(toggleLayerVisibility(doc, target.id)).toBe(true);
    expect(target.visible).toBe(false);
  });

  it("toggles layer lock", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[1];
    expect(toggleLayerLock(doc, target.id)).toBe(true);
    expect(target.locked).toBe(true);
  });

  it("updates the background layer color", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    expect(setBackgroundLayerColor(doc, "#ff0000")).toBe(true);
    expect(doc.layers[0].fillColor).toBe("#ff0000");
  });

  it("selects an existing layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const target = doc.layers[0];
    expect(selectLayer(doc, target.id)).toBe(true);
    expect(doc.activeLayerId).toBe(target.id);
  });

  it("reports deletion eligibility correctly", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    expect(canDeleteLayer(doc, doc.layers[0])).toBe(false);
    expect(canDeleteLayer(doc, doc.layers[1])).toBe(true);
  });
});
