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
}));

vi.mock("../editor/gradient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../editor/gradient")>();
  return {
    ...actual,
    applyGradientToSelection: gradientMocks.applyGradientToSelection,
  };
});

vi.mock("../editor/fill", () => ({
  resolveEffectiveSelectionMask: fillMocks.resolveEffectiveSelectionMask,
}));

import { makeNewDocument } from "../editor/actions/documentActions";
import { createGradientToolController, getGradientToolTargetError } from "./gradientToolController";

const DEFAULT_PALETTE = ["#112233", "#445566", "#778899", "#AABBCC"];

function installModalDom() {
  document.body.innerHTML = `
    <div id="gradient-tool-modal" class="modal-backdrop" hidden>
      <div class="modal-card">
        <button class="modal-btn-reject" type="button">Cancel</button>
        <button id="gradient-apply-btn" type="button">Apply</button>
        <button id="gradient-add-node-btn" type="button">Add</button>
        <button id="gradient-reset-btn" type="button">Reset</button>
        <select id="gradient-target-select">
          <option value="selection">Selection</option>
          <option value="canvas">Full canvas</option>
        </select>
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
        <canvas id="gradient-curve-canvas" width="400" height="200"></canvas>
        <canvas id="gradient-preview-canvas" width="400" height="40"></canvas>
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

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.any(Array), "canvas", 135);
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

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.any(Array), "canvas", 0);
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

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.any(Array), "selection", 0);
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

    expect(gradientMocks.applyGradientToSelection).toHaveBeenCalledWith(doc, layer, expect.any(Array), "canvas", 0);
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
});
