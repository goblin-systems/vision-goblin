import { describe, expect, it } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { buildAutosaveTargets, getRecoveryPromptCopy, trimRecentItems } from "./documentWorkflowHelpers";

describe("documentWorkflowHelpers", () => {
  it("deduplicates recent paths and keeps the newest entries first", () => {
    expect(trimRecentItems(["b", "a", "c"], "a", 3)).toEqual(["a", "b", "c"]);
    expect(trimRecentItems(["1", "2", "3"], "4", 3)).toEqual(["4", "1", "2"]);
  });

  it("builds autosave targets from live documents", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "white");
    doc.dirty = true;

    const [target] = buildAutosaveTargets([doc]);
    const serialized = target.serialize();

    expect(target).toMatchObject({
      id: doc.id,
      name: "Doc",
      width: 100,
      height: 80,
      dirty: true,
      layerCount: doc.layers.length,
    });
    expect(serialized.name).toBe("Doc");
    expect(serialized.width).toBe(100);
    expect(serialized.height).toBe(80);
  });

  it("builds recovery prompt copy for singular and plural cases", () => {
    expect(getRecoveryPromptCopy(1).message).toContain("1 unsaved document was found");
    expect(getRecoveryPromptCopy(2).message).toContain("2 unsaved documents were found");
  });
});
