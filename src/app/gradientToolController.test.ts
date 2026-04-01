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
}));

const gradientMocks = vi.hoisted(() => ({
  applyGradientToSelection: vi.fn(() => ({ ok: true, message: "Applied gradient to selection" })),
}));

vi.mock("../editor/gradient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../editor/gradient")>();
  return {
    ...actual,
    applyGradientToSelection: gradientMocks.applyGradientToSelection,
  };
});

import { makeNewDocument } from "../editor/actions/documentActions";
import { createGradientToolController, getGradientToolTargetError } from "./gradientToolController";

function installModalDom() {
  document.body.innerHTML = `
    <div id="gradient-tool-modal" class="modal-backdrop" hidden>
      <div class="modal-card">
        <button class="modal-btn-reject" type="button">Cancel</button>
        <button id="gradient-apply-btn" type="button">Apply</button>
        <button id="gradient-add-node-btn" type="button">Add</button>
        <button id="gradient-reset-btn" type="button">Reset</button>
        <canvas id="gradient-curve-canvas" width="400" height="200"></canvas>
        <canvas id="gradient-preview-canvas" width="400" height="40"></canvas>
        <div id="gradient-node-list"></div>
      </div>
    </div>
  `;
}

describe("gradientToolController", () => {
  beforeEach(() => {
    installModalDom();
    vi.clearAllMocks();
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
      getActiveColour: () => "#6C63FF",
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

  it("cancel leaves the document unchanged", () => {
    const doc = makeNewDocument("Doc", 100, 80, 100, "transparent");
    const layer = doc.layers[1];
    if (layer.type !== "raster") {
      throw new Error("Expected raster layer");
    }
    const controller = createGradientToolController({
      getActiveDocument: () => doc,
      getActiveLayer: () => layer,
      getActiveColour: () => "#6C63FF",
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    controller.openGradientToolModal();
    document.querySelector<HTMLElement>(".modal-btn-reject")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(gradientMocks.applyGradientToSelection).not.toHaveBeenCalled();
    expect(doc.undoStack).toHaveLength(0);
    expect(doc.history).toEqual(["Created blank canvas"]);
  });
});
