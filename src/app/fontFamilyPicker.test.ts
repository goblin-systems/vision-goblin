import { describe, expect, it, vi } from "vitest";
import { createFontFamilyPicker } from "./fontFamilyPicker";

function createPickerFixture() {
  const container = document.createElement("div");
  const input = document.createElement("input");
  input.id = "text-font-family-input";
  input.value = "Georgia";

  const optionsList = document.createElement("div");
  optionsList.id = "text-font-family-options";

  container.append(input, optionsList);
  document.body.appendChild(container);

  const picker = createFontFamilyPicker({ input, optionsList }, ["Arial", "Georgia", "Verdana"]);

  return {
    input,
    optionsList,
    picker,
    teardown() {
      container.remove();
    },
  };
}

describe("fontFamilyPicker", () => {
  it("filters visible font options as the user types", () => {
    const fixture = createPickerFixture();

    fixture.input.focus();
    fixture.input.value = "ver";
    fixture.input.dispatchEvent(new Event("input", { bubbles: true }));

    const options = Array.from(fixture.optionsList.querySelectorAll<HTMLButtonElement>("[data-font-family-option]"));

    expect(fixture.optionsList.hidden).toBe(false);
    expect(options.map((option) => option.textContent)).toEqual(["Verdana"]);

    fixture.teardown();
  });

  it("applies a selected font and emits inspector-compatible events", () => {
    const fixture = createPickerFixture();
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    fixture.input.addEventListener("input", inputSpy);
    fixture.input.addEventListener("change", changeSpy);

    fixture.input.value = "";
    fixture.input.dispatchEvent(new Event("input", { bubbles: true }));
    inputSpy.mockClear();
    changeSpy.mockClear();
    const option = Array.from(fixture.optionsList.querySelectorAll<HTMLButtonElement>("[data-font-family-option]"))
      .find((candidate) => candidate.textContent === "Arial") ?? null;
    expect(option).not.toBeNull();
    option?.click();

    expect(fixture.input.value).toBe("Arial");
    expect(fixture.optionsList.hidden).toBe(true);
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);

    fixture.teardown();
  });

  it("keeps the options list limited to the curated fonts", () => {
    const fixture = createPickerFixture();

    fixture.picker.setValue("Custom Sans");
    fixture.input.focus();

    const options = Array.from(fixture.optionsList.querySelectorAll<HTMLButtonElement>("[data-font-family-option]"));

    expect(fixture.input.value).toBe("Custom Sans");
    expect(options.map((option) => option.textContent)).toEqual([]);

    fixture.teardown();
  });
});
