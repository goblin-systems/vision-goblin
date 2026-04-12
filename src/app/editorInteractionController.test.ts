import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
vi.mock("../editor/commands", () => ({
  dispatchKeyboardEvent: vi.fn(),
}));

import { shouldDispatchEditorShortcut, createEditorInteractionController, isBrushCursorTool, type EditorInteractionControllerDeps } from "./editorInteractionController";
import { dispatchKeyboardEvent } from "../editor/commands";

describe("isBrushCursorTool", () => {
  it("includes smudge alongside the paint cursor tools", () => {
    expect(isBrushCursorTool("brush")).toBe(true);
    expect(isBrushCursorTool("eraser")).toBe(true);
    expect(isBrushCursorTool("healing-brush")).toBe(true);
    expect(isBrushCursorTool("clone-stamp")).toBe(true);
    expect(isBrushCursorTool("smudge")).toBe(true);
    expect(isBrushCursorTool("move")).toBe(false);
  });
});

describe("shouldDispatchEditorShortcut", () => {
  it("blocks plain shortcuts while typing in inputs", () => {
    const input = document.createElement("input");

    expect(shouldDispatchEditorShortcut(input, { ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  it("blocks modified shortcuts from text inputs", () => {
    const input = document.createElement("textarea");

    expect(shouldDispatchEditorShortcut(input, { ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });

  it("blocks modified shortcuts from contenteditable elements", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";

    expect(shouldDispatchEditorShortcut(div, { ctrlKey: false, metaKey: true, altKey: false })).toBe(false);
  });

  it("allows shortcuts from non-input targets", () => {
    const div = document.createElement("div");

    expect(shouldDispatchEditorShortcut(div, { ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: keydown handler skips editor actions when input is focused
// ---------------------------------------------------------------------------

/**
 * Sets up the full DOM required by `bind()` and returns a mock deps object.
 * Teardown removes the injected elements.
 */
function setupControllerFixture() {
  // DOM elements required by bind() sub-functions
  const ids = [
    "magic-wand-tolerance-input",
    "magic-wand-tolerance-label",
    "magic-wand-contiguous-checkbox",
    "transform-scale-x-input",
    "transform-scale-y-input",
    "transform-rotate-input",
    "transform-skew-x-input",
    "transform-skew-y-input",
    "transform-apply-btn",
    "transform-cancel-btn",
    "shape-kind-select",
  ];

  const container = document.createElement("div");
  container.id = "__test-fixture__";

  for (const id of ids) {
    const tag = id.includes("checkbox") ? "input"
      : id.includes("select") ? "select"
        : id.includes("btn") ? "button"
          : id.includes("label") ? "span"
            : "input";
    const el = document.createElement(tag);
    el.id = id;
    if (tag === "input" && id.includes("checkbox")) {
      (el as HTMLInputElement).type = "checkbox";
    }
    container.appendChild(el);
  }

  // Colour swatch buttons (optional, but bind iterates them)
  const swatch = document.createElement("button");
  swatch.dataset.colourSwatch = "#FF0000";
  container.appendChild(swatch);

  // Paint controls stubs (bindPaintControlsView uses byId internally)
  for (const id of ["brush-size-range", "brush-opacity-range", "healing-sample-range", "healing-blend-range"]) {
    const el = document.createElement("input");
    el.id = id;
    container.appendChild(el);
  }

  document.body.appendChild(container);

  const canvasStage = document.createElement("div");
  canvasStage.id = "canvas-stage";
  document.body.appendChild(canvasStage);

  const deps: EditorInteractionControllerDeps = {
    canvasStage,
    getDocuments: vi.fn(() => []),
    getActiveDocument: vi.fn(() => null),
    getActiveTool: vi.fn(() => "marquee" as const),
    getPointerState: vi.fn(() => ({
      mode: "none" as const,
      lastDocX: 0, lastDocY: 0,
      startDocX: 0, startDocY: 0,
      startClientX: 0, startClientY: 0,
      startLayerX: 0, startLayerY: 0,
      startPanX: 0, startPanY: 0,
      startSelectionRect: null,
      startSelectionInverted: false,
      transformHandle: null,
      startLayerWidth: 0, startLayerHeight: 0,
      startScaleX: 1, startScaleY: 1,
      startCenterX: 0, startCenterY: 0,
      startPivotX: 0, startPivotY: 0,
      startRotateDeg: 0,
      startSkewXDeg: 0, startSkewYDeg: 0,
      startTextBoxWidth: 0,
      startTextBoxHeight: 0,
      cloneOffsetX: 0, cloneOffsetY: 0,
      creationLayerId: null,
    })),
    getTransformDraft: vi.fn(() => null),
    ensureTransformDraftForActiveLayer: vi.fn(() => null),
    updateTransformDraftInputs: vi.fn(),
    commitTransformDraft: vi.fn(),
    cancelTransformDraft: vi.fn(),
    setTransformMode: vi.fn(),
    updateMarqueeModeFromModifiers: vi.fn(),
    clearSelection: vi.fn(),
    deleteSelectedArea: vi.fn(),
    completeLassoSelection: vi.fn(),
    addPastedImageToActiveDocument: vi.fn(async () => {}),
    loadImageFromDrop: vi.fn(async () => {}),
    setMagicWandTolerance: vi.fn(),
    setMagicWandContiguous: vi.fn(),
    renderEditorState: vi.fn(),
    renderToolState: vi.fn(),
    renderBrushUI: vi.fn(),
    isAiMaskSessionActive: vi.fn(() => false),
    completeAiMaskSession: vi.fn(),
    cancelAiMaskSession: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
  };

  const controller = createEditorInteractionController(deps);
  controller.bind();

  const teardown = () => {
    container.remove();
    canvasStage.remove();
  };

  return { deps, controller, teardown };
}

/** Dispatches a keydown event on the given target and returns the event. */
function fireKeydown(target: EventTarget, key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code: opts.code ?? key,
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
  });
  target.dispatchEvent(event);
  return event;
}

describe("keydown handler — input field guard", () => {
  let deps: EditorInteractionControllerDeps;
  let teardown: () => void;

  beforeEach(() => {
    const fixture = setupControllerFixture();
    deps = fixture.deps;
    teardown = fixture.teardown;
    vi.mocked(dispatchKeyboardEvent).mockClear();
  });

  afterEach(() => {
    teardown();
  });

  // --- Delete / Backspace ---

  it("does NOT trigger deleteSelectedArea when Delete is pressed inside an input", () => {
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });

    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = fireKeydown(input, "Delete");
    input.remove();

    expect(deps.deleteSelectedArea).not.toHaveBeenCalled();
    // The handler should NOT have called preventDefault — the input needs it
    expect(event.defaultPrevented).toBe(false);
  });

  it("does NOT trigger deleteSelectedArea when Backspace is pressed inside a textarea", () => {
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireKeydown(textarea, "Backspace");
    textarea.remove();

    expect(deps.deleteSelectedArea).not.toHaveBeenCalled();
  });

  it("DOES trigger deleteSelectedArea when Delete is pressed on a non-input element", () => {
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });

    const div = document.createElement("div");
    document.body.appendChild(div);
    const event = fireKeydown(div, "Delete");
    div.remove();

    expect(deps.deleteSelectedArea).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("commits a pending transform before delete-selection from the keyboard", () => {
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const div = document.createElement("div");
    document.body.appendChild(div);
    fireKeydown(div, "Delete");
    div.remove();

    expect(deps.commitTransformDraft).toHaveBeenCalledOnce();
    expect(deps.deleteSelectedArea).toHaveBeenCalledOnce();
  });

  // --- Enter ---

  it("does NOT commit transform draft when Enter is pressed inside an input", () => {
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeydown(input, "Enter");
    input.remove();

    expect(deps.commitTransformDraft).not.toHaveBeenCalled();
  });

  it("DOES commit transform draft when Enter is pressed on a non-input element", () => {
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const div = document.createElement("div");
    document.body.appendChild(div);
    fireKeydown(div, "Enter");
    div.remove();

    expect(deps.commitTransformDraft).toHaveBeenCalledOnce();
  });

  it("completes the shadow guide session before other Enter handlers", () => {
    (deps.isAiMaskSessionActive as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const div = document.createElement("div");
    document.body.appendChild(div);
    const event = fireKeydown(div, "Enter");
    div.remove();

    expect(deps.completeAiMaskSession).toHaveBeenCalledOnce();
    expect(deps.commitTransformDraft).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  // --- Escape ---

  it("does NOT cancel transform draft when Escape is pressed inside an input", () => {
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeydown(input, "Escape");
    input.remove();

    expect(deps.cancelTransformDraft).not.toHaveBeenCalled();
  });

  it("does NOT clear selection when Escape is pressed inside a select element", () => {
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });

    const select = document.createElement("select");
    document.body.appendChild(select);
    fireKeydown(select, "Escape");
    select.remove();

    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("DOES cancel transform draft when Escape is pressed on a non-input element", () => {
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const div = document.createElement("div");
    document.body.appendChild(div);
    fireKeydown(div, "Escape");
    div.remove();

    expect(deps.cancelTransformDraft).toHaveBeenCalledOnce();
  });

  it("cancels the shadow guide session before clearing selections", () => {
    (deps.isAiMaskSessionActive as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });

    const div = document.createElement("div");
    document.body.appendChild(div);
    const event = fireKeydown(div, "Escape");
    div.remove();

    expect(deps.cancelAiMaskSession).toHaveBeenCalledOnce();
    expect(deps.clearSelection).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  // --- contentEditable ---

  it("does NOT trigger editor actions when typing in a contentEditable element", () => {
    (deps.getActiveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      selectionRect: { x: 0, y: 0, width: 10, height: 10 },
    });

    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireKeydown(div, "Delete");
    fireKeydown(div, "Backspace");
    fireKeydown(div, "Enter");
    fireKeydown(div, "Escape");
    div.remove();

    expect(deps.deleteSelectedArea).not.toHaveBeenCalled();
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  // --- Modified shortcuts stay native inside editable controls ---

  it("does NOT commit transform draft when Ctrl+Enter is pressed inside an input", () => {
    (deps.getTransformDraft as ReturnType<typeof vi.fn>).mockReturnValue({ scale: 1 });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeydown(input, "Enter", { ctrlKey: true });
    input.remove();

    expect(deps.commitTransformDraft).not.toHaveBeenCalled();
  });

  it("does NOT dispatch editor select-all behavior when Ctrl+A is pressed inside an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = fireKeydown(input, "a", { ctrlKey: true, code: "KeyA" });
    input.remove();

    expect(event.defaultPrevented).toBe(false);
    expect(dispatchKeyboardEvent).not.toHaveBeenCalled();
  });

  it("does NOT dispatch editor select-all behavior when Cmd+A is pressed inside a contenteditable element", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    const event = fireKeydown(div, "a", { metaKey: true, code: "KeyA" });
    div.remove();

    expect(event.defaultPrevented).toBe(false);
    expect(dispatchKeyboardEvent).not.toHaveBeenCalled();
  });

  it("still allows Ctrl+A editor shortcuts outside editable controls", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    fireKeydown(div, "a", { ctrlKey: true, code: "KeyA" });
    div.remove();

    expect(dispatchKeyboardEvent).toHaveBeenCalled();
  });

  // --- Modifier state tracking still works when input is focused ---

  it("still tracks modifier state when an input element is focused", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeydown(input, "Shift", { shiftKey: true, code: "ShiftLeft" });

    // The modifier tracking block runs before the input guard,
    // so updateMarqueeModeFromModifiers should still be called.
    expect(deps.updateMarqueeModeFromModifiers).toHaveBeenCalled();
    input.remove();
  });
});

describe("brush size state", () => {
  it("adjusts and clamps brush size while updating the brush UI", () => {
    const fixture = setupControllerFixture();

    fixture.controller.adjustBrushSize(10);
    fixture.controller.adjustBrushSize(1000);
    fixture.controller.adjustBrushSize(-2000);

    expect(fixture.controller.getBrushState().brushSize).toBe(1);
    expect(fixture.deps.renderBrushUI).toHaveBeenCalledTimes(3);

    fixture.teardown();
  });

  it("tracks healing sample and blend controls alongside brush state", () => {
    const fixture = setupControllerFixture();
    const sampleInput = document.getElementById("healing-sample-range") as HTMLInputElement;
    const blendInput = document.getElementById("healing-blend-range") as HTMLInputElement;

    sampleInput.value = "320";
    sampleInput.dispatchEvent(new Event("input", { bubbles: true }));
    blendInput.value = "35";
    blendInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(fixture.controller.getBrushState().healingSampleSpread).toBe(3.2);
    expect(fixture.controller.getBrushState().healingBlend).toBe(0.35);
    expect(fixture.deps.renderBrushUI).toHaveBeenCalledTimes(2);

    fixture.teardown();
  });
});
