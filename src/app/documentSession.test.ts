import { describe, expect, it } from "vitest";
import { createDocumentSession } from "./documentSession";
import { makeNewDocument } from "../editor/actions/documentActions";

describe("documentSession", () => {
  it("registers and activates documents", () => {
    const session = createDocumentSession();
    const first = makeNewDocument("First", 100, 80, 100, "transparent");
    const second = makeNewDocument("Second", 120, 90, 100, "transparent");

    expect(session.setActiveDocument(first)).toBe(true);
    expect(session.setActiveDocument(first)).toBe(false);
    expect(session.setActiveDocument(second)).toBe(true);

    expect(session.documents).toHaveLength(2);
    expect(session.activeDocumentId).toBe(second.id);
    expect(session.getActiveDocument()?.id).toBe(second.id);
  });

  it("activates an existing document by id", () => {
    const session = createDocumentSession();
    const first = makeNewDocument("First", 100, 80, 100, "transparent");
    const second = makeNewDocument("Second", 120, 90, 100, "transparent");
    session.setActiveDocument(first);
    session.setActiveDocument(second);

    expect(session.activateDocument(first.id)).toBe(true);
    expect(session.activeDocumentId).toBe(first.id);
    expect(session.getDocument(second.id)?.id).toBe(second.id);
    expect(session.activateDocument("missing")).toBe(false);
    expect(session.getDocument("missing")).toBeNull();
  });

  it("falls back to first layer when active layer is missing", () => {
    const session = createDocumentSession();
    const doc = makeNewDocument("Doc", 100, 80, 100, "white");
    doc.activeLayerId = "missing";

    expect(session.getActiveLayer(doc)?.id).toBe(doc.layers[0]?.id);
  });

  it("removes the active document and selects a neighbor", () => {
    const session = createDocumentSession();
    const first = makeNewDocument("First", 100, 80, 100, "transparent");
    const second = makeNewDocument("Second", 120, 90, 100, "transparent");
    const third = makeNewDocument("Third", 140, 100, 100, "transparent");
    session.setActiveDocument(first);
    session.setActiveDocument(second);
    session.setActiveDocument(third);

    const removed = session.removeDocument(third.id);

    expect(removed?.document.id).toBe(third.id);
    expect(session.activeDocumentId).toBe(second.id);
    expect(session.documents.map((doc) => doc.id)).toEqual([first.id, second.id]);
  });
});
