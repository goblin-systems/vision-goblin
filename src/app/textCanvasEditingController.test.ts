import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { createTextLayer } from "../editor/documents";
import type { DocumentState, Layer, LinearGradientFill, TextLayer } from "../editor/types";
import { createTextCanvasEditingController, isPointInsideActiveTextLayer } from "./textCanvasEditingController";

function setupFixture() {
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-editor-wrap";
  const editorCanvas = document.createElement("canvas");
  canvasWrap.appendChild(editorCanvas);
  document.body.appendChild(canvasWrap);

  const inspectorInput = document.createElement("textarea");
  inspectorInput.id = "text-value-input";
  document.body.appendChild(inspectorInput);

  const doc = makeNewDocument("Doc", 300, 200, 100, "transparent");
  const layer = createTextLayer("Title", 40, 30, { text: "Hello world", fontSize: 32, fillColor: "#ffffff" });
  doc.layers.push(layer);
  doc.activeLayerId = layer.id;

  const rect = {
    left: 0,
    top: 0,
    width: 600,
    height: 400,
    right: 600,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect;
  vi.spyOn(editorCanvas, "getBoundingClientRect").mockReturnValue(rect);

  let activeDoc: DocumentState | null = doc;
  let activeTool = "move";
  let transformDraft: any = null;
  const getActiveDocument = () => activeDoc;
  const getActiveLayer = (currentDoc: DocumentState): Layer | null => currentDoc.layers.find((item) => item.id === currentDoc.activeLayerId) ?? null;
  const renderEditorState = vi.fn();
  const showToast = vi.fn();
  const log = vi.fn();
  const commitTransformDraft = vi.fn(() => {
    transformDraft = null;
  });
  const cancelTransformDraft = vi.fn(() => {
    transformDraft = null;
  });

  const controller = createTextCanvasEditingController({
    editorCanvas,
    canvasWrap,
    getActiveDocument,
    getActiveLayer,
    getActiveTool: () => activeTool,
    getTransformDraft: () => transformDraft,
    commitTransformDraft,
    cancelTransformDraft,
    renderEditorState,
    showToast,
    log,
  });

  return {
    controller,
    doc,
    layer,
    editorCanvas,
    canvasWrap,
    setActiveTool: (tool: string) => {
      activeTool = tool;
    },
    setTransformDraft: (draft: unknown) => {
      transformDraft = draft;
    },
    getTransformDraft: () => transformDraft,
    commitTransformDraft,
    cancelTransformDraft,
    renderEditorState,
    showToast,
    teardown: () => {
      canvasWrap.remove();
      inspectorInput.remove();
    },
  };
}

function getOverlay() {
  return document.querySelector<HTMLTextAreaElement>("[data-canvas-text-editor='true']");
}

describe("textCanvasEditingController", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("commits one history entry for a text edit session", () => {
    const fixture = setupFixture();

    expect(fixture.controller.beginEditingActiveTextLayer()).toBe(true);
    const overlay = getOverlay();
    expect(overlay).not.toBeNull();

    overlay!.value = "Updated headline";
    overlay!.dispatchEvent(new Event("input", { bubbles: true }));
    overlay!.dispatchEvent(new Event("blur"));

    expect(fixture.layer.textData.text).toBe("Updated headline");
    expect(fixture.doc.history[0]).toBe("Edited text");
    expect(fixture.doc.undoStack).toHaveLength(1);
    expect(fixture.showToast).not.toHaveBeenCalledWith("Text edit cancelled", "info");
    expect(getOverlay()).toBeNull();

    fixture.teardown();
  });

  it("cancels edits on Escape without committing history", () => {
    const fixture = setupFixture();
    fixture.controller.beginEditingActiveTextLayer();
    const overlay = getOverlay();
    if (!overlay) {
      throw new Error("Expected overlay");
    }

    overlay.value = "Draft text";
    overlay.dispatchEvent(new Event("input", { bubbles: true }));
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(fixture.layer.textData.text).toBe("Hello world");
    expect(fixture.doc.history[0]).not.toBe("Edited text");
    expect(fixture.doc.undoStack).toHaveLength(0);
    expect(fixture.showToast).toHaveBeenCalledWith("Text edit cancelled", "info");
    expect(getOverlay()).toBeNull();

    fixture.teardown();
  });

  it("re-enters editing on double-clicking the active text layer", () => {
    const fixture = setupFixture();
    fixture.controller.bind();
    const textLayer = fixture.layer as TextLayer;
    const rect = fixture.editorCanvas.getBoundingClientRect();
    const clientX = rect.left + 150 + textLayer.x + 4;
    const clientY = rect.top + 100 + textLayer.y + 4;

    fixture.editorCanvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX, clientY }));

    expect(getOverlay()).not.toBeNull();
    expect(fixture.controller.getHiddenLayerId()).toBe(textLayer.id);

    fixture.teardown();
  });

  it("shows a text cursor when hovering editable text with the text tool active", () => {
    const fixture = setupFixture();
    fixture.controller.bind();
    fixture.setActiveTool("text");
    const textLayer = fixture.layer as TextLayer;
    const rect = fixture.editorCanvas.getBoundingClientRect();
    const clientX = rect.left + 150 + textLayer.x + 4;
    const clientY = rect.top + 100 + textLayer.y + 4;

    fixture.editorCanvas.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));

    expect(fixture.editorCanvas.style.cursor).toBe("text");

    fixture.editorCanvas.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 20 }));

    expect(fixture.editorCanvas.style.cursor).toBe("");

    fixture.teardown();
  });

  it("selects existing text on single-click without forcing editing", () => {
    const fixture = setupFixture();
    fixture.controller.bind();
    fixture.setActiveTool("text");
    fixture.doc.activeLayerId = "missing";
    const textLayer = fixture.layer as TextLayer;
    const rect = fixture.editorCanvas.getBoundingClientRect();
    const clientX = rect.left + 150 + textLayer.x + 4;
    const clientY = rect.top + 100 + textLayer.y + 4;

    fixture.editorCanvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX, clientY, button: 0 }));

    expect(fixture.doc.activeLayerId).toBe(textLayer.id);
    expect(getOverlay()).toBeNull();
    expect(fixture.controller.getHiddenLayerId()).toBeNull();

    fixture.teardown();
  });

  it("reports active text interaction while editing", () => {
    const fixture = setupFixture();

    expect(fixture.controller.isTextInteractionActive()).toBe(false);
    expect(fixture.controller.isTextLayoutInteractionActive()).toBe(false);
    fixture.controller.beginEditingActiveTextLayer();

    expect(fixture.controller.isEditing()).toBe(true);
    expect(fixture.controller.isTextInteractionActive()).toBe(true);
    expect(fixture.controller.isTextLayoutInteractionActive()).toBe(false);

    getOverlay()?.dispatchEvent(new Event("blur"));
    expect(fixture.controller.isTextInteractionActive()).toBe(false);
    expect(fixture.controller.isTextLayoutInteractionActive()).toBe(false);
    fixture.teardown();
  });

  it("reports active text interaction for an active text-layout draft", () => {
    const fixture = setupFixture();
    fixture.setActiveTool("text");
    fixture.setTransformDraft({
      layerId: fixture.layer.id,
      intent: "text-layout",
      sourceCanvas: fixture.layer.sourceCanvas ?? fixture.layer.canvas,
      centerX: fixture.layer.x + fixture.layer.canvas.width / 2,
      centerY: fixture.layer.y + fixture.layer.canvas.height / 2,
      pivotX: fixture.layer.x + fixture.layer.canvas.width / 2,
      pivotY: fixture.layer.y + fixture.layer.canvas.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      textBoxWidth: fixture.layer.textData.boxWidth,
      textBoxHeight: fixture.layer.textData.boxHeight,
      previewOverride: null,
      snapshot: "snapshot",
    });

    expect(fixture.controller.isEditing()).toBe(false);
    expect(fixture.controller.isTextLayoutInteractionActive()).toBe(true);
    expect(fixture.controller.isTextInteractionActive()).toBe(true);

    fixture.teardown();
  });

  it("does not intercept empty-canvas clicks or non-text tools", () => {
    const fixture = setupFixture();
    fixture.controller.bind();
    const rect = fixture.editorCanvas.getBoundingClientRect();

    fixture.setActiveTool("text");
    fixture.editorCanvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 20, button: 0 }));
    expect(getOverlay()).toBeNull();

    fixture.setActiveTool("move");
    const textLayer = fixture.layer as TextLayer;
    fixture.editorCanvas.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + 150 + textLayer.x + 4,
      clientY: rect.top + 100 + textLayer.y + 4,
    }));

    expect(fixture.editorCanvas.style.cursor).toBe("");

    fixture.teardown();
  });

  it("keeps transformed text editable on canvas", () => {
    const fixture = setupFixture();
    fixture.layer.textData.scaleX = 1.25;
    fixture.layer.textData.scaleY = 0.9;
    fixture.layer.textData.rotationDeg = 14;
    fixture.controller.beginEditingActiveTextLayer();
    const overlay = getOverlay();
    if (!overlay) {
      throw new Error("Expected overlay");
    }

    expect(overlay.style.transform).toContain("rotate(14deg)");
    expect(overlay.style.transform).toContain("scale(1.25, 0.9)");

    overlay.value = "Editable after transform";
    overlay.dispatchEvent(new Event("input", { bubbles: true }));
    overlay.dispatchEvent(new Event("blur"));

    expect(fixture.layer.textData.text).toBe("Editable after transform");
    expect(fixture.doc.history[0]).toBe("Edited text");

    fixture.teardown();
  });

  it("commits an active text-layout draft before opening text editing", () => {
    const fixture = setupFixture();
    fixture.layer.textData.boxHeight = 80;
    fixture.setTransformDraft({
      layerId: fixture.layer.id,
      intent: "text-layout",
      sourceCanvas: fixture.layer.sourceCanvas ?? fixture.layer.canvas,
      centerX: fixture.layer.x + fixture.layer.canvas.width / 2 + 20,
      centerY: fixture.layer.y + fixture.layer.canvas.height / 2 + 10,
      pivotX: fixture.layer.x + fixture.layer.canvas.width / 2 + 20,
      pivotY: fixture.layer.y + fixture.layer.canvas.height / 2 + 10,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      textBoxWidth: (fixture.layer.textData.boxWidth ?? 0) + 30,
      textBoxHeight: (fixture.layer.textData.boxHeight ?? 0) + 20,
      previewOverride: null,
      snapshot: "snapshot",
    });

    expect(fixture.controller.beginEditingActiveTextLayer()).toBe(true);

    expect(fixture.commitTransformDraft).toHaveBeenCalledOnce();
    expect(fixture.cancelTransformDraft).not.toHaveBeenCalled();
    expect(fixture.getTransformDraft()).toBeNull();
    expect(getOverlay()).not.toBeNull();

    getOverlay()?.dispatchEvent(new Event("blur"));
    fixture.teardown();
  });

  it("sizes the editing overlay to a fixed text frame height", () => {
    const fixture = setupFixture();
    fixture.layer.textData.boxWidth = 140;
    fixture.layer.textData.boxHeight = 60;

    expect(fixture.controller.beginEditingActiveTextLayer()).toBe(true);
    const overlay = getOverlay();
    if (!overlay) {
      throw new Error("Expected overlay");
    }

    expect(overlay.style.height).toBe("60px");
    expect(overlay.style.width).toBeTruthy();

    overlay.dispatchEvent(new Event("blur"));
    fixture.teardown();
  });

  it("detects double-click hits within the active text layer bounds", () => {
    const fixture = setupFixture();
    const rect = fixture.editorCanvas.getBoundingClientRect();

    expect(isPointInsideActiveTextLayer({
      doc: fixture.doc,
      layer: fixture.layer,
      clientX: rect.left + 150 + fixture.layer.x + 4,
      clientY: rect.top + 100 + fixture.layer.y + 4,
      canvasRect: rect,
    })).toBe(true);

    expect(isPointInsideActiveTextLayer({
      doc: fixture.doc,
      layer: fixture.layer,
      clientX: rect.left + 40,
      clientY: rect.top + 40,
      canvasRect: rect,
    })).toBe(false);

    fixture.teardown();
  });

  it("sets overlay color to first gradient stop for gradient fills", () => {
    const fixture = setupFixture();
    const gradientFill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };

    const gradientLayer = createTextLayer("Gradient", 40, 30, {
      text: "Gradient text",
      fontSize: 32,
      fill: gradientFill,
    });
    fixture.doc.layers.push(gradientLayer);
    fixture.doc.activeLayerId = gradientLayer.id;

    expect(fixture.controller.beginEditingActiveTextLayer()).toBe(true);
    const overlay = getOverlay();
    expect(overlay).not.toBeNull();
    // jsdom normalises hex colors to rgb() when assigned to style properties
    expect(overlay!.style.color).toBe("rgb(255, 0, 0)");

    overlay!.dispatchEvent(new Event("blur"));
    fixture.teardown();
  });
});
