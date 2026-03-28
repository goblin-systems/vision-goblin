import { describe, expect, it, vi } from "vitest";
import { createBlankDocument } from "./documents";
import { addLayer } from "./layers";
import { renderLayerList } from "./layerList";

function mockActions() {
  return {
    onSelect: vi.fn(),
    onToggleVisibility: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onToggleLock: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe("layer list UI", () => {
  it("fires delete callback for a deletable layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const extra = addLayer(doc, "Extra");
    const root = document.createElement("div");
    const actions = mockActions();

    renderLayerList(root, doc, actions);
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".layer-row"));
    const targetRow = rows.find((row) => row.dataset.layerId === extra.id);
    expect(targetRow).toBeTruthy();

    const deleteButton = Array.from(targetRow!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.dataset.actionLabel === "Delete layer");
    expect(deleteButton?.disabled).toBe(false);
    deleteButton?.click();

    expect(actions.onDelete).toHaveBeenCalledWith(extra.id);
  });

  it("disables delete for the background layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const root = document.createElement("div");

    renderLayerList(root, doc, mockActions());
    const backgroundRow = Array.from(root.querySelectorAll<HTMLElement>(".layer-row")).find((row) => row.dataset.layerId === doc.layers[0].id);
    const deleteButton = Array.from(backgroundRow!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.dataset.actionLabel === "Delete layer");
    expect(deleteButton?.disabled).toBe(true);
  });

  it("highlights multi-selected layers with is-selected class", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const extra1 = addLayer(doc, "A");
    const extra2 = addLayer(doc, "B");
    // Multi-select both extra layers
    doc.selectedLayerIds = [extra1.id, extra2.id];
    doc.activeLayerId = extra2.id;
    const root = document.createElement("div");
    renderLayerList(root, doc, mockActions());
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".layer-row"));
    const extra1Row = rows.find((r) => r.dataset.layerId === extra1.id);
    const extra2Row = rows.find((r) => r.dataset.layerId === extra2.id);
    expect(extra1Row?.classList.contains("is-selected")).toBe(true);
    expect(extra2Row?.classList.contains("is-active")).toBe(true);
  });
});
