import { describe, expect, it } from "vitest";
import { createBlankDocument } from "./documents";
import { enforceHistoryBudget, pushHistory } from "./history";

describe("history budgets", () => {
  it("keeps normal-sized document history at the existing cap", () => {
    const doc = createBlankDocument("Doc", 1600, 1200, 100);
    doc.undoStack = Array.from({ length: 45 }, (_, index) => `snapshot-${index}`);

    enforceHistoryBudget(doc);

    expect(doc.undoStack).toHaveLength(40);
    expect(doc.undoStack[0]).toBe("snapshot-5");
  });

  it("aggressively trims huge-document undo history to the newest entries", () => {
    const doc = createBlankDocument("Huge", 8000, 6000, 100);
    doc.undoStack = Array.from({ length: 10 }, (_, index) => "x".repeat(2_000_000 + index));

    enforceHistoryBudget(doc);

    expect(doc.undoStack.length).toBeLessThanOrEqual(4);
    expect(doc.undoStack[doc.undoStack.length - 1]?.length).toBeGreaterThan(doc.undoStack[0]?.length ?? 0);
  });

  it("enforces the snapshot budget when history entries are pushed", () => {
    const doc = createBlankDocument("Huge", 8000, 6000, 100);
    doc.undoStack = Array.from({ length: 8 }, () => "x".repeat(2_000_000));

    pushHistory(doc, "Painted");

    expect(doc.history[0]).toBe("Painted");
    expect(doc.undoStack.length).toBeLessThanOrEqual(4);
  });
});
