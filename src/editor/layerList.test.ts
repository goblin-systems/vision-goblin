import { describe, expect, it, vi } from "vitest";
import { createBlankDocument } from "./documents";
import { addLayer } from "./layers";
import { renderLayerList } from "./layerList";

describe("layer list UI", () => {
  it("fires delete callback for a deletable layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const extra = addLayer(doc, "Extra");
    const root = document.createElement("div");
    const onDelete = vi.fn();

    renderLayerList(root, doc, {
      onSelect: vi.fn(),
      onToggleVisibility: vi.fn(),
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
      onToggleLock: vi.fn(),
      onRename: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete,
    });
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".layer-row"));
    const targetRow = rows.find((row) => row.dataset.layerId === extra.id);
    expect(targetRow).toBeTruthy();

    const deleteButton = Array.from(targetRow!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.dataset.actionLabel === "Delete layer");
    expect(deleteButton?.disabled).toBe(false);
    deleteButton?.click();

    expect(onDelete).toHaveBeenCalledWith(extra.id);
  });

  it("disables delete for the background layer", () => {
    const doc = createBlankDocument("Test", 200, 100, 100);
    const root = document.createElement("div");

    renderLayerList(root, doc, {
      onSelect: vi.fn(),
      onToggleVisibility: vi.fn(),
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
      onToggleLock: vi.fn(),
      onRename: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
    });
    const backgroundRow = Array.from(root.querySelectorAll<HTMLElement>(".layer-row")).find((row) => row.dataset.layerId === doc.layers[0].id);
    const deleteButton = Array.from(backgroundRow!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.dataset.actionLabel === "Delete layer");
    expect(deleteButton?.disabled).toBe(true);
  });
});
