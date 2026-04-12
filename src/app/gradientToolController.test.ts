import { beforeEach, describe, expect, it, vi } from "vitest";

const modalMocks = vi.hoisted(() => ({
  openModal: vi.fn((options: { backdrop: HTMLElement; onReject?: () => void }) => {
    options.backdrop.removeAttribute("hidden");
    options.backdrop.querySelectorAll(".modal-btn-reject").forEach((button) => {
      button.addEventListener("click", () => options.onReject?.());
    });
  }),
  closeModal: vi.fn(({ backdrop }: { backdrop: HTMLElement }) => {
    backdrop.setAttribute("hidden", "");
  }),
  applyIcons: vi.fn(),
  bindRadial: vi.fn(),
}));

vi.mock("@goblin-systems/goblin-design-system", () => ({
  byId: <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element: ${id}`);
    }
    return element as T;
  },
  openModal: modalMocks.openModal,
  closeModal: modalMocks.closeModal,
  applyIcons: modalMocks.applyIcons,
  bindRadial: modalMocks.bindRadial,
}));

const gradientMocks = vi.hoisted(() => ({
  applyGradientToSelection: vi.fn(() => ({ ok: true, message: "Applied gradient to selection" })),
}));

const fillMocks = vi.hoisted(() => ({
  resolveEffectiveSelectionMask: vi.fn<() => HTMLCanvasElement | null>(() => null),
  getFillGradientTargetError: vi.fn((operation: string, layer: { type?: string; locked?: boolean } | null) => {
    if (operation !== "gradient") {
      return null;
    }
    if (!layer || layer.type !== "raster") {
      return "Select a raster layer to apply a gradient";
    }
    if (layer.locked) {
      return "Unlock the active layer before applying a gradient";
    }
    return null;
  }),
}));

vi.mock("../editor/gradient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../editor/gradient")>();
  return {
    ...actual,
    applyGradientToSelection: gradientMocks.applyGradientToSelection,
  };
});

vi.mock("../editor/fillGradientValidation", () => ({
  resolveEffectiveSelectionMask: fillMocks.resolveEffectiveSelectionMask,
  getFillGradientTargetError: fillMocks.getFillGradientTargetError,
}));

import { makeNewDocument } from "../editor/actions/documentActions";
import { createGradientToolController, getGradientToolTargetError } from "./gradientToolController";
import type { LinearGradientFill, RadialGradientFill } from "../editor/types";

const DEFAULT_PALETTE = ["#112233", "#445566", "#778899", "#AABBCC"];

function installModalDom() {
  document.body.innerHTML = `
    <div id="gradient-tool-modal" class="modal-backdrop" hidden>
      <div class="modal-card">
        <h3 id="gradient-tool-title">Gradient</h3>
        <button class="modal-btn-reject" type="button">Cancel</button>
        <button id="gradient-apply-btn" type="button">Apply</button>
        <button id="gradient-add-node-btn" type="button">Add</button>
        <button id="gradient-reset-btn" type="button">Reset</button>
        <select id="gradient-type-select">
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        <label id="gradient-target-row" class="field-block gradient-tool-target-field">
          <span>Apply to</span>
          <select id="gradient-target-select">
            <option value="selection">Selection</option>
            <option value="canvas">Full canvas</option>
          </select>
        </label>
        <div id="gradient-heading-row" class="gradient-tool-heading-field">
          <div id="gradient-heading-control" class="radial-control radial-control-xs" aria-label="Gradient heading" title="Gradient heading">
            <svg class="radial-control-visual" viewBox="0 0 100 100" aria-hidden="true">
              <path class="radial-control-track"></path>
              <path class="radial-control-fill"></path>
              <line class="radial-control-pointer" x1="50" y1="50" x2="50" y2="22"></line>
              <circle class="radial-control-thumb" cx="50" cy="12" r="5"></circle>
            </svg>
            <div class="radial-control-readout">
              <span class="radial-control-value"></span>
            </div>
          </div>
        </div>
        <div id="gradient-center-controls" class="gradient-tool-center-field" hidden>
          <label class="field-block">
            <span>Center X</span>
            <input id="gradient-center-x" type="number" min="0" max="1" step="0.05" value="0.5" />
          </label>
          <label class="field-block">
            <span>Center Y</span>
            <input id="gradient-center-y" type="number" min="0" max="1" step="0.05" value="0.5" />
          </label>
        </div>
        <canvas id="gradient-curve-canvas" width="400" height="200"></canvas>
        <canvas id="gradient-preview-canvas" width="400" height="40"></canvas>
        <div id="gradient-preset-list"></div>
        <div id="gradient-node-list"></div>
      </div>
    </div>
  `;

  const curveCanvas = document.getElementById("gradient-curve-canvas") as HTMLCanvasElement;
  Object.defineProperty(curveCanvas, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  });
  Object.defineProperty(curveCanvas, "setPointerCapture", {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(curveCanvas, "releasePointerCapture", {
    value: vi.fn(),
    configurable: true,
  });

  const previewCanvas = document.getElementById("gradient-preview-canvas") as HTMLCanvasElement;
  Object.defineProperty(previewCanvas, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  });
  Object.defineProperty(previewCanvas, "setPointerCapture", {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(previewCanvas, "releasePointerCapture", {
    value: vi.fn(),
    configurable: true,
  });
}

function createPointerEvent(type: string, options: { clientX: number; clientY: number; pointerId?: number }) {
  const event = new MouseEvent(type, { bubbles: true, clientX: options.clientX, clientY: options.clientY });
  Object.defineProperty(event, "pointerId", {
    value: options.pointerId ?? 1,
  });
  return event;
}

function getNodeColourInputs() {
  return Array.from(document.querySelectorAll<HTMLInputElement>("#gradient-node-list input[type='color']"));
}

function getPresetButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("#gradient-preset-list button"));
}

function createDefaultDeps(doc: ReturnType<typeof makeNewDocument>) {
  const layer = doc.layers[1];
  if (layer.type !== "raster") {
    throw new Error("Expected raster layer");
  }
  return {
    getActiveDocument: () => doc,
    getActiveLayer: () => layer,
    getGradientPaletteColours: () => DEFAULT_PALETTE,
    renderEditorState: vi.fn(),
    showToast: vi.fn(),
  };
}

describe("gradientToolController", () => {
  beforeEach(() => {
    installModalDom();
    vi.clearAllMocks();
    fillMocks.resolveEffectiveSelectionMask.mockReturnValue(null);
    modalMocks.bindRadial.mockImplementation(({ value = 0, onChange }: { value?: number; onChange?: (value: number) => void }) => {
      let currentValue = value;
      return {
        setValue: vi.fn((nextValue: number) => {
          currentValue = nextValue;
        }),
        getValue: vi.fn(() => currentValue),
        destroy: vi.fn(),
        __emitChange: (nextValue: number) => {
          currentValue = nextValue;
          onChange?.(nextValue);
        },
      };
    });
  });

  it("blocks invalid layer targets with clear messages", () => {
    expect(getGradientToolTargetError(null)).toBe("Select a raster layer to apply a gradient");
    expect(getGradientToolTargetError({ type: "text", locked: false } as never)).toBe("Select a raster layer to apply a gradient");
    expect(getGradientToolTargetError({ type: "raster", locked: true } as never)).toBe("Unlock the active layer before applying a gradient");
  });

  it("applies the gradient as one committed history step", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState,
      showToast,
    });

    controller.openGradientToolModal();
    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledOnce();
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toHaveLength(0);
    expect(doc.history[0]).toBe("Applied gradient");
    expect(renderEditorState).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith("Applied gradient to selection", "success");
  });

  it("passes radial heading changes through when applying the gradient", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const radialHandle = modalMocks.bindRadial.mock.results[0]?.value as {
      __emitChange: (value: number) => void;
    };
    radialHandle.__emitChange(135);
    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.objectContaining({ gradientType: "linear", nodes: expect.any(Array), headingDegrees: 135 }), "canvas");
  });

  it("locks the target to canvas when there is no effective selection", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const targetSelect = document.getElementById("gradient-target-select") as HTMLSelectElement;
    expect(targetSelect.disabled).toBe(true);
    expect(targetSelect.value).toBe("canvas");

    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.objectContaining({ gradientType: "linear", nodes: expect.any(Array), headingDegrees: 0 }), "canvas");
  });

  it("defaults to selection but still allows canvas when an effective selection exists", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    fillMocks.resolveEffectiveSelectionMask.mockReturnValue(document.createElement("canvas"));

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const targetSelect = document.getElementById("gradient-target-select") as HTMLSelectElement;
    expect(targetSelect.disabled).toBe(false);
    expect(targetSelect.value).toBe("selection");

    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.objectContaining({ gradientType: "linear", nodes: expect.any(Array), headingDegrees: 0 }), "selection");
  });

  it("allows switching from selection to canvas when an effective selection exists", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    fillMocks.resolveEffectiveSelectionMask.mockReturnValue(document.createElement("canvas"));

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const targetSelect = document.getElementById("gradient-target-select") as HTMLSelectElement;
    expect(targetSelect.disabled).toBe(false);
    expect(targetSelect.value).toBe("selection");

    targetSelect.value = "canvas";
    targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.objectContaining({ gradientType: "linear", nodes: expect.any(Array), headingDegrees: 0 }), "canvas");
  });

  it("cancel leaves the document unchanged", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();
    document.querySelector<HTMLElement>(".modal-btn-reject")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).not.toHaveBeenCalled();
    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toEqual(["Created blank canvas"]);
  });

  it("seeds and resets gradient nodes from the active palette", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const paletteColours = ["#123456", "#654321", "#ABCDEF", "#FEDCBA"];
    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => paletteColours,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    expect(getNodeColourInputs().map((input) => input.value.toUpperCase())).toEqual(["#123456", "#654321"]);

    document.getElementById("gradient-add-node-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getNodeColourInputs().map((input) => input.value.toUpperCase())).toEqual(["#123456", "#ABCDEF", "#654321"]);

    paletteColours.splice(0, paletteColours.length, "#0F0F0F", "#F0F0F0", "#00AA00");
    document.getElementById("gradient-reset-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getNodeColourInputs().map((input) => input.value.toUpperCase())).toEqual(["#0F0F0F", "#F0F0F0"]);
  });

  it("renders built-in preset buttons and applies a preset immediately", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const presetButtons = getPresetButtons();
    expect(presetButtons.length).toBeGreaterThan(1);

    presetButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(
      doc,
      layer,
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ color: "#FF6B6B" }),
          expect.objectContaining({ color: "#FFD166" }),
          expect.objectContaining({ color: "#6C63FF" }),
        ]),
        headingDegrees: 24,
      }),
      "canvas",
    );
  });

  it("adds a node on empty curve clicks with the next palette colour", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const curveCanvas = document.getElementById("gradient-curve-canvas") as HTMLCanvasElement;
    curveCanvas.dispatchEvent(createPointerEvent("pointerdown", { clientX: 200, clientY: 100 }));

    const colours = getNodeColourInputs().map((input) => input.value.toUpperCase());
    expect(colours).toEqual(["#112233", "#778899", "#445566"]);
    expect((curveCanvas as HTMLCanvasElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("selects existing nodes instead of creating duplicates on curve clicks", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const curveCanvas = document.getElementById("gradient-curve-canvas") as HTMLCanvasElement;
    curveCanvas.dispatchEvent(createPointerEvent("pointerdown", { clientX: 0, clientY: 200 }));

    expect(getNodeColourInputs()).toHaveLength(2);
  });

  it("preview linear handles update heading when dragged", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    const previewCanvas = document.getElementById("gradient-preview-canvas") as HTMLCanvasElement;
    previewCanvas.dispatchEvent(createPointerEvent("pointerdown", { clientX: 214, clientY: 20 }));
    previewCanvas.dispatchEvent(createPointerEvent("pointermove", { clientX: 200, clientY: 4 }));
    previewCanvas.dispatchEvent(createPointerEvent("pointerup", { clientX: 200, clientY: 4 }));
    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(
      doc,
      layer,
      expect.objectContaining({ headingDegrees: 270 }),
      "canvas",
    );
  });

  it("preview radial handle updates center and preserves it in text mode", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    const radialFill: RadialGradientFill = {
      type: "radial-gradient",
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
      centerX: 0.5,
      centerY: 0.5,
    };
    const onConfirm = vi.fn();
    controller.openGradientEditorForText(radialFill, onConfirm);

    const previewCanvas = document.getElementById("gradient-preview-canvas") as HTMLCanvasElement;
    previewCanvas.dispatchEvent(createPointerEvent("pointerdown", { clientX: 200, clientY: 20 }));
    previewCanvas.dispatchEvent(createPointerEvent("pointermove", { clientX: 80, clientY: 10 }));
    previewCanvas.dispatchEvent(createPointerEvent("pointerup", { clientX: 80, clientY: 10 }));
    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({
      config: expect.objectContaining({
        gradientType: "radial",
        centerX: 0.2,
        centerY: 0.25,
      }),
    });
  });

  it("renders clearer active node affordances and allows row selection", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();
    document.getElementById("gradient-add-node-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    let rows = Array.from(document.querySelectorAll<HTMLElement>("#gradient-node-list .gradient-node-row"));
    expect(rows.some((row) => row.classList.contains("is-active"))).toBe(true);
    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    rows = Array.from(document.querySelectorAll<HTMLElement>("#gradient-node-list .gradient-node-row"));
    expect(rows[1]?.classList.contains("is-active")).toBe(true);
    expect(rows[1]?.textContent).toContain("Selected");
  });

  // -------------------------------------------------------------------------
  // Text-configure mode tests
  // -------------------------------------------------------------------------

  it("text-configure mode calls onConfirm with GradientConfig on apply", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    const linearFill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const onConfirm = vi.fn();
    controller.openGradientEditorForText(linearFill, onConfirm);

    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onConfirm).toHaveBeenCalledOnce();
    const result = onConfirm.mock.calls[0][0];
    expect(result.config).toBeDefined();
    expect(result.config.gradientType).toBe("linear");
    expect(result.config.nodes).toBeInstanceOf(Array);
    expect(result.config.nodes.length).toBeGreaterThanOrEqual(2);
    // Should not call applyGradientToSelection in text mode
    expect(gradientMocks.applyGradientToSelection).not.toHaveBeenCalled();
  });

  it("text-configure mode hides the target selector", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    const linearFill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    };
    controller.openGradientEditorForText(linearFill, vi.fn());

    const targetRow = document.getElementById("gradient-target-row") as HTMLElement;
    expect(targetRow.hidden).toBe(true);
  });

  it("text-configure mode sets the title to 'Edit Gradient Fill'", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    const linearFill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    };
    controller.openGradientEditorForText(linearFill, vi.fn());

    const titleEl = document.getElementById("gradient-tool-title") as HTMLElement;
    expect(titleEl.textContent).toBe("Edit Gradient Fill");
  });

  it("text-configure mode seeds from existing linear fill", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    const linearFill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 45,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#00ff00" },
      ],
    };
    controller.openGradientEditorForText(linearFill, vi.fn());

    const typeSelect = document.getElementById("gradient-type-select") as HTMLSelectElement;
    expect(typeSelect.value).toBe("linear");

    // Heading row should be visible for linear
    const headingRow = document.getElementById("gradient-heading-row") as HTMLElement;
    expect(headingRow.hidden).toBe(false);

    // Center controls should be hidden for linear
    const centerControls = document.getElementById("gradient-center-controls") as HTMLElement;
    expect(centerControls.hidden).toBe(true);

    // bindRadial should have been called with the fill's angle
    expect(modalMocks.bindRadial).toHaveBeenCalledWith(expect.objectContaining({ value: 45 }));
  });

  it("text-configure mode seeds from existing radial fill", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    const radialFill: RadialGradientFill = {
      type: "radial-gradient",
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    controller.openGradientEditorForText(radialFill, vi.fn());

    const typeSelect = document.getElementById("gradient-type-select") as HTMLSelectElement;
    expect(typeSelect.value).toBe("radial");

    // Heading row should be hidden for radial
    const headingRow = document.getElementById("gradient-heading-row") as HTMLElement;
    expect(headingRow.hidden).toBe(true);

    // Center controls should be visible for radial
    const centerControls = document.getElementById("gradient-center-controls") as HTMLElement;
    expect(centerControls.hidden).toBe(false);

    const centerXInput = document.getElementById("gradient-center-x") as HTMLInputElement;
    const centerYInput = document.getElementById("gradient-center-y") as HTMLInputElement;
    expect(centerXInput.value).toBe("0.50");
    expect(centerYInput.value).toBe("0.50");
  });

  it("gradient type switch toggles heading and center controls", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    controller.openGradientToolModal();

    const headingRow = document.getElementById("gradient-heading-row") as HTMLElement;
    const centerControls = document.getElementById("gradient-center-controls") as HTMLElement;
    const typeSelect = document.getElementById("gradient-type-select") as HTMLSelectElement;

    // Initially linear: heading visible, center hidden
    expect(headingRow.hidden).toBe(false);
    expect(centerControls.hidden).toBe(true);

    // Switch to radial
    typeSelect.value = "radial";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(headingRow.hidden).toBe(true);
    expect(centerControls.hidden).toBe(false);

    // Switch back to linear
    typeSelect.value = "linear";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(headingRow.hidden).toBe(false);
    expect(centerControls.hidden).toBe(true);
  });

  it("radial type is passed through in GradientConfig on raster apply", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }

    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getGradientPaletteColours: () => DEFAULT_PALETTE,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();

    // Switch to radial
    const typeSelect = document.getElementById("gradient-type-select") as HTMLSelectElement;
    typeSelect.value = "radial";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    // Set center values
    const centerXInput = document.getElementById("gradient-center-x") as HTMLInputElement;
    const centerYInput = document.getElementById("gradient-center-y") as HTMLInputElement;
    centerXInput.value = "0.3";
    centerXInput.dispatchEvent(new Event("input", { bubbles: true }));
    centerYInput.value = "0.7";
    centerYInput.dispatchEvent(new Event("input", { bubbles: true }));

    document.getElementById("gradient-apply-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(
      doc,
      layer,
      expect.objectContaining({
        gradientType: "radial",
        centerX: 0.3,
        centerY: 0.7,
      }),
      "canvas",
    );
  });

  it("reset restores gradient type to linear and resets center values", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const deps = createDefaultDeps(doc);
    const controller = createGradientToolController(deps);

    controller.openGradientToolModal();

    // Switch to radial and change center
    const typeSelect = document.getElementById("gradient-type-select") as HTMLSelectElement;
    typeSelect.value = "radial";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const centerXInput = document.getElementById("gradient-center-x") as HTMLInputElement;
    centerXInput.value = "0.2";
    centerXInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Reset
    document.getElementById("gradient-reset-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(typeSelect.value).toBe("linear");
    expect(centerXInput.value).toBe("0.50");

    const headingRow = document.getElementById("gradient-heading-row") as HTMLElement;
    const centerControls = document.getElementById("gradient-center-controls") as HTMLElement;
    expect(headingRow.hidden).toBe(false);
    expect(centerControls.hidden).toBe(true);
  });
});
