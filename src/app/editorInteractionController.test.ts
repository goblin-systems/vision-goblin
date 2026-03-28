import { describe, expect, it } from "vitest";
import { shouldDispatchEditorShortcut } from "./editorInteractionController";

describe("shouldDispatchEditorShortcut", () => {
  it("blocks plain shortcuts while typing in inputs", () => {
    const input = document.createElement("input");

    expect(shouldDispatchEditorShortcut(input, { ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  it("allows modified shortcuts from inputs", () => {
    const input = document.createElement("textarea");

    expect(shouldDispatchEditorShortcut(input, { ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
  });

  it("allows shortcuts from non-input targets", () => {
    const div = document.createElement("div");

    expect(shouldDispatchEditorShortcut(div, { ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
  });
});
