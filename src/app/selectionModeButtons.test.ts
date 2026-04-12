import { describe, expect, it } from "vitest";
import {
  decorateSelectionModeButtons,
  renderSelectionModeButtonInner,
} from "./selectionModeButtons";

describe("selectionModeButtons", () => {
  it("renders icon-based add remove and intersect button content", () => {
    expect(renderSelectionModeButtonInner("replace")).toContain("data-lucide=\"replace\"");
    expect(renderSelectionModeButtonInner("add")).toContain("data-lucide=\"plus\"");
    expect(renderSelectionModeButtonInner("subtract")).toContain("data-lucide=\"minus\"");
    expect(renderSelectionModeButtonInner("intersect")).toContain("selection-mode-btn__overlap");
  });

  it("decorates left pane selection buttons with icons labels and shortcuts", () => {
    document.body.innerHTML = `
      <button class="selection-mode-btn" type="button" data-selection-mode="add">Add</button>
      <button class="selection-mode-btn" type="button" data-selection-mode="subtract">Subtract</button>
      <button class="selection-mode-btn" type="button" data-selection-mode="intersect">Intersect</button>
    `;

    decorateSelectionModeButtons(document);

    const addBtn = document.querySelector<HTMLButtonElement>('[data-selection-mode="add"]');
    const removeBtn = document.querySelector<HTMLButtonElement>('[data-selection-mode="subtract"]');
    const intersectBtn = document.querySelector<HTMLButtonElement>('[data-selection-mode="intersect"]');

    expect(addBtn?.textContent).toContain("Add");
    expect(addBtn?.textContent).toContain("Shift");
    expect(addBtn?.querySelector("i[data-lucide='plus']")).not.toBeNull();
    expect(removeBtn?.textContent).toContain("Remove");
    expect(removeBtn?.textContent).toContain("Ctrl");
    expect(removeBtn?.getAttribute("title")).toBe("Remove (Ctrl)");
    expect(removeBtn?.querySelector("i[data-lucide='minus']")).not.toBeNull();
    expect(intersectBtn?.textContent).toContain("Intersect");
    expect(intersectBtn?.textContent).toContain("Alt");
  });
});
