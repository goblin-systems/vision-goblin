import { describe, expect, it } from "vitest";
import { isEditableEventTarget, recordRollingWindowEvent } from "./events";

describe("goblin event helpers", () => {
  it("keeps only timestamps inside the rolling window", () => {
    const result = recordRollingWindowEvent([0, 2_000, 11_500], 12_000, 10_000, 3);

    expect(result.timestamps).toEqual([2_000, 11_500, 12_000]);
    expect(result.matched).toBe(true);
  });

  it("detects editable event targets", () => {
    expect(isEditableEventTarget(document.createElement("input"))).toBe(true);
    expect(isEditableEventTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableEventTarget(document.createElement("select"))).toBe(true);
    expect(isEditableEventTarget(document.createElement("div"))).toBe(false);
  });
});
