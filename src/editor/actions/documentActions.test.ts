import { describe, expect, it } from "vitest";
import { addBlobAsLayer, duplicateDocument, makeNewDocument } from "./documentActions";
import { createBlankDocument } from "../documents";

describe("document actions", () => {
  it("creates new dirty documents with requested dimensions", () => {
    const doc = makeNewDocument("New Doc", 320, 240, 100);
    expect(doc.name).toBe("New Doc");
    expect(doc.width).toBe(320);
    expect(doc.height).toBe(240);
    expect(doc.dirty).toBe(true);
  });

  it("duplicates a document with a new id", () => {
    const doc = createBlankDocument("Base", 200, 100, 100);
    const copy = duplicateDocument(doc);
    expect(copy.id).not.toBe(doc.id);
    expect(copy.name).toContain("Copy");
  });

  it("adds pasted blobs as new layers", async () => {
    const doc = createBlankDocument("Base", 300, 200, 100);
    const imageBlob = new Blob(["fake"], { type: "image/png" });

    const originalImage = globalThis.Image;
    class MockImage {
      naturalWidth = 40;
      naturalHeight = 20;
      decoding = "async";
      src = "";
      async decode() {}
    }
    // @ts-expect-error test override
    globalThis.Image = MockImage;

    try {
      const layer = await addBlobAsLayer(doc, "paste.png", imageBlob);
      expect(doc.layers).toHaveLength(3);
      expect(doc.activeLayerId).toBe(layer.id);
      expect(layer.name).toBe("paste");
    } finally {
      globalThis.Image = originalImage;
    }
  });
});
