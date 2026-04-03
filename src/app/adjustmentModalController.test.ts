import { beforeEach, describe, expect, it, vi } from "vitest";

const modalMocks = vi.hoisted(() => ({
  openModal: vi.fn((options: { backdrop: HTMLElement; onReject?: () => void }) => {
    options.backdrop.removeAttribute("hidden");
    options.backdrop.querySelectorAll<HTMLButtonElement>(".modal-btn-reject").forEach((button) => {
      button.onclick = () => options.onReject?.();
    });
  }),
  closeModal: vi.fn(({ backdrop }: { backdrop: HTMLElement }) => {
    backdrop.setAttribute("hidden", "");
  }),
}));

const adjustmentMocks = vi.hoisted(() => ({
  applyMotionBlur: vi.fn(() => new ImageData(1, 1)),
  applyBrightnessContrast: vi.fn(() => new ImageData(1, 1)),
}));

vi.mock("@goblin-systems/goblin-design-system", async () => {
  const actual = await vi.importActual<typeof import("@goblin-systems/goblin-design-system")>("@goblin-systems/goblin-design-system");
  return {
    ...actual,
    openModal: modalMocks.openModal,
    closeModal: modalMocks.closeModal,
  };
});

vi.mock("../editor/adjustments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../editor/adjustments")>();
  return {
    ...actual,
    applyMotionBlur: adjustmentMocks.applyMotionBlur,
    applyBrightnessContrast: adjustmentMocks.applyBrightnessContrast,
  };
});

import { makeNewDocument } from "../editor/actions/documentActions";
import {
  commitDestructiveAdjustment,
  createAdjustmentModalController,
  getAdjustmentSessionError,
  restoreDestructiveAdjustmentPreview,
} from "./adjustmentModalController";

function installSliderModalDom() {
  document.body.innerHTML = `
    <div id="motion-blur-modal" hidden>
      <button class="modal-btn-reject" type="button">Cancel</button>
      <input id="mb-angle-range" type="range" value="0" />
      <output id="mb-angle-value">0</output>
      <input id="mb-distance-range" type="range" value="1" />
      <output id="mb-distance-value">1</output>
      <button id="mb-apply-btn" type="button">Apply</button>
    </div>
    <div id="brightness-contrast-modal" hidden>
      <button class="modal-btn-reject" type="button">Cancel</button>
      <input id="bc-brightness-range" type="range" value="0" />
      <output id="bc-brightness-value">0</output>
      <input id="bc-contrast-range" type="range" value="0" />
      <output id="bc-contrast-value">0</output>
      <button id="bc-apply-btn" type="button">Apply</button>
    </div>
  `;
}

function createControllerHarness() {
  const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
  const renderCanvas = vi.fn();
  const renderEditorState = vi.fn();
  const showToast = vi.fn();
  const controller = createAdjustmentModalController({
    getActiveDocument: () => doc,
    getActiveLayer: (activeDoc) => activeDoc.layers.find((item) => item.id === activeDoc.activeLayerId) ?? null,
    renderCanvas,
    renderEditorState,
    showToast,
  });

  return {
    controller,
    doc,
    renderCanvas,
    renderEditorState,
    showToast,
  };
}

describe("adjustmentModalController helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports session guard errors for missing or locked targets", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId) ?? null;

    expect(getAdjustmentSessionError(null, null)).toBe("No document open");
    expect(getAdjustmentSessionError(doc, null)).toBe("No active layer");
    expect(getAdjustmentSessionError(doc, layer)).toBeNull();

    if (layer) {
      layer.locked = true;
    }

    expect(getAdjustmentSessionError(doc, layer)).toBe("Layer is locked");
  });

  it("restores the source canvas on cancel", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const renderCanvas = vi.fn();
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;
    const context = layer.canvas.getContext("2d");

    restoreDestructiveAdjustmentPreview({ doc, layer, sourceCanvas }, renderCanvas);

    expect(context?.clearRect).toHaveBeenCalled();
    expect(context?.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0);
    expect(renderCanvas).toHaveBeenCalledTimes(1);
  });

  it("commits previewed adjustments into history and dirty state", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;
    doc.redoStack = ["redo"];

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Levels",
      successMessage: "Levels applied",
      renderEditorState,
      showToast,
    });

    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toEqual([]);
    expect(doc.dirty).toBe(true);
    expect(doc.history[0]).toBe("Levels");
    expect(context?.putImageData).toHaveBeenCalled();
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Levels applied", "success");
  });

  // ---------------------------------------------------------------------------
  // No-selection path — full putImageData, no compositing drawImage
  //
  // Because all canvas getContext calls return the same shared contextStub
  // (see src/test/setup.ts), drawImage calls from makeNewDocument internals
  // (background layer initialisation → syncLayerSource → cloneCanvas) and
  // from the post-commit syncLayerSource call are also counted on the shared
  // stub.  For the no-selection path the total is exactly 2 drawImage calls:
  //   1. makeNewDocument background layer initialisation (clearLayer →
  //      syncLayerSource → cloneCanvas)
  //   2. post-commit syncLayerSource on the active layer
  // No compositing drawImage calls are made — those only appear in the
  // selection-scoped path where the count jumps to 5.
  // ---------------------------------------------------------------------------

  it("no selection: uses putImageData and does not call compositing drawImage", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      // selectionMask omitted — resolves to undefined → no-selection path
      target: { doc, layer, sourceCanvas },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Brightness/Contrast",
      successMessage: "Brightness/Contrast applied",
      renderEditorState,
      showToast,
    });

    // Full-replace path must call putImageData exactly once.
    expect(context?.putImageData).toHaveBeenCalledTimes(1);
    // Only 2 drawImage calls total (background init + post-commit syncLayerSource),
    // NOT the 5 that would indicate selection compositing took place.
    expect(context?.drawImage).toHaveBeenCalledTimes(2);
  });

  it("no selection (explicit null): uses putImageData and does not call compositing drawImage", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas, selectionMask: null },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Gaussian Blur",
      successMessage: "Gaussian Blur applied",
      renderEditorState,
      showToast,
    });

    expect(context?.putImageData).toHaveBeenCalledTimes(1);
    expect(context?.drawImage).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Active-selection path — selection-scoped composite, no putImageData on layer
  //
  // With an active selectionMask the composite routine runs:
  //   1. tmpCtx.putImageData(result, 0, 0)           — adjusted pixels on tmp
  //   2. tmpCtx.drawImage(selectionMask, -x, -y)     — clip via destination-in
  //   3. layerCtx.drawImage(sourceCanvas, 0, 0)      — restore original pixels
  //   4. layerCtx.drawImage(tmp, 0, 0)               — paint masked result
  // Plus the 2 infrastructure drawImage calls present in every path
  // (background init + post-commit syncLayerSource) = 5 drawImage total.
  // putImageData is called exactly once (on the tmp canvas, shared stub).
  // ---------------------------------------------------------------------------

  it("active selection: routes through composite path and produces correct call counts", () => {
    const doc = makeNewDocument("Doc", 10, 10, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 10;
    sourceCanvas.height = 10;
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 10;
    selectionMask.height = 10;
    doc.redoStack = ["redo"];

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    // All canvas getContext calls return the shared contextStub from setup.ts.
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas, selectionMask },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Hue/Saturation",
      successMessage: "Hue/Saturation applied",
      renderEditorState,
      showToast,
    });

    // putImageData is called exactly once: tmpCtx.putImageData (adjusted result
    // onto the tmp canvas).  It is never called on the layer canvas directly —
    // that would bypass the selection mask.
    expect(context?.putImageData).toHaveBeenCalledTimes(1);

    // drawImage is called 5 times in total:
    //   2 infrastructure calls (background init + syncLayerSource) +
    //   3 composite calls (mask clip, sourceCanvas restore, tmp overlay)
    expect(context?.drawImage).toHaveBeenCalledTimes(5);

    // The selection mask composite call with offset must be present.
    expect(context?.drawImage).toHaveBeenCalledWith(selectionMask, -layer.x, -layer.y);
    // The source-canvas restore call must be present.
    expect(context?.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0);

    // History, undo, dirty, toast all still fire.
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.redoStack).toEqual([]);
    expect(doc.dirty).toBe(true);
    expect(doc.history[0]).toBe("Hue/Saturation");
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Hue/Saturation applied", "success");
  });

  it("active selection: drawImage uses layer offset when clipping through the selection mask", () => {
    const doc = makeNewDocument("Doc", 100, 100, 100, "transparent");
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId)!;
    // Place the layer at a non-zero position to verify the offset is forwarded.
    layer.x = 10;
    layer.y = 20;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 100;
    sourceCanvas.height = 100;
    const selectionMask = document.createElement("canvas");
    selectionMask.width = 100;
    selectionMask.height = 100;

    const renderEditorState = vi.fn();
    const showToast = vi.fn();
    const context = layer.canvas.getContext("2d");

    commitDestructiveAdjustment({
      target: { doc, layer, sourceCanvas, selectionMask },
      applyPreview: (source) => new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      historyLabel: "Curves",
      successMessage: "Curves applied",
      renderEditorState,
      showToast,
    });

    // The selection mask must be drawn at (-layer.x, -layer.y) so the global
    // mask coordinates align with the layer-local canvas coordinate system.
    expect(context?.drawImage).toHaveBeenCalledWith(selectionMask, -10, -20);
  });
});

describe("adjustment modal preview scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    installSliderModalDom();
  });

  it("coalesces rapid motion blur slider inputs to the latest debounced preview", () => {
    const { controller, renderCanvas } = createControllerHarness();
    let queuedFrame: FrameRequestCallback | null = null;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      queuedFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      queuedFrame = null;
    });

    controller.openMotionBlurModal();

    const angleRange = document.getElementById("mb-angle-range") as HTMLInputElement;
    angleRange.value = "5";
    angleRange.dispatchEvent(new Event("input"));
    angleRange.value = "15";
    angleRange.dispatchEvent(new Event("input"));
    angleRange.value = "25";
    angleRange.dispatchEvent(new Event("input"));

    expect(adjustmentMocks.applyMotionBlur).not.toHaveBeenCalled();
    expect(queuedFrame).toBeNull();

    vi.advanceTimersByTime(49);
    expect(adjustmentMocks.applyMotionBlur).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(queuedFrame).not.toBeNull();
    if (!queuedFrame) {
      throw new Error("Expected motion blur preview frame to be queued");
    }
    const motionBlurFrame = queuedFrame as FrameRequestCallback;
    motionBlurFrame(16);

    expect(adjustmentMocks.applyMotionBlur).toHaveBeenCalledTimes(1);
    const latestMotionBlurPreviewCall = adjustmentMocks.applyMotionBlur.mock.calls[
      adjustmentMocks.applyMotionBlur.mock.calls.length - 1
    ] as unknown as [unknown, { angle: number; distance: number }] | undefined;
    expect(latestMotionBlurPreviewCall?.[0]).toMatchObject({ data: expect.any(Uint8ClampedArray) });
    expect(latestMotionBlurPreviewCall?.[1]).toEqual({ angle: 25, distance: 1 });
    expect(renderCanvas).toHaveBeenCalledTimes(1);
  });

  it("cancel clears a pending debounced motion blur preview and restores state", () => {
    const { controller, renderCanvas } = createControllerHarness();
    let queuedFrame: FrameRequestCallback | null = null;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      queuedFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      queuedFrame = null;
    });

    controller.openMotionBlurModal();

    const angleRange = document.getElementById("mb-angle-range") as HTMLInputElement;
    angleRange.value = "30";
    angleRange.dispatchEvent(new Event("input"));

    const cancelButton = document.querySelector("#motion-blur-modal .modal-btn-reject") as HTMLButtonElement;
    cancelButton.click();

    vi.runAllTimers();
    if (queuedFrame) {
      const pendingFrame = queuedFrame as FrameRequestCallback;
      pendingFrame(16);
    }

    expect(adjustmentMocks.applyMotionBlur).not.toHaveBeenCalled();
    expect(renderCanvas).toHaveBeenCalledTimes(1);
  });

  it("apply commits the latest motion blur params without waiting for the delayed preview", () => {
    const { controller, doc, renderEditorState, showToast } = createControllerHarness();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    controller.openMotionBlurModal();

    const angleRange = document.getElementById("mb-angle-range") as HTMLInputElement;
    const distanceRange = document.getElementById("mb-distance-range") as HTMLInputElement;
    angleRange.value = "40";
    angleRange.dispatchEvent(new Event("input"));
    distanceRange.value = "12";
    distanceRange.dispatchEvent(new Event("input"));

    const applyButton = document.getElementById("mb-apply-btn") as HTMLButtonElement;
    applyButton.click();

    expect(adjustmentMocks.applyMotionBlur).toHaveBeenCalledTimes(1);
    const latestMotionBlurApplyCall = adjustmentMocks.applyMotionBlur.mock.calls[
      adjustmentMocks.applyMotionBlur.mock.calls.length - 1
    ] as unknown as [unknown, { angle: number; distance: number }] | undefined;
    expect(latestMotionBlurApplyCall?.[0]).toMatchObject({ data: expect.any(Uint8ClampedArray) });
    expect(latestMotionBlurApplyCall?.[1]).toEqual({ angle: 40, distance: 12 });
    expect(doc.history[0]).toBe("Motion Blur");
    expect(doc.undoStack).toHaveLength(1);
    expect(doc.dirty).toBe(true);
    expect(renderEditorState).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Motion Blur applied", "success");
  });

  it("keeps other slider adjustments on the existing next-frame preview path", () => {
    const { controller, renderCanvas } = createControllerHarness();
    let queuedFrame: FrameRequestCallback | null = null;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      queuedFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      queuedFrame = null;
    });

    controller.openBrightnessContrastModal();

    const brightnessRange = document.getElementById("bc-brightness-range") as HTMLInputElement;
    brightnessRange.value = "18";
    brightnessRange.dispatchEvent(new Event("input"));

    expect(queuedFrame).not.toBeNull();
    expect(adjustmentMocks.applyBrightnessContrast).not.toHaveBeenCalled();

    if (!queuedFrame) {
      throw new Error("Expected brightness/contrast preview frame to be queued");
    }
    const brightnessFrame = queuedFrame as FrameRequestCallback;
    brightnessFrame(16);

    expect(adjustmentMocks.applyBrightnessContrast).toHaveBeenCalledTimes(1);
    const latestBrightnessCall = adjustmentMocks.applyBrightnessContrast.mock.calls[
      adjustmentMocks.applyBrightnessContrast.mock.calls.length - 1
    ] as unknown as [unknown, { brightness: number; contrast: number }] | undefined;
    expect(latestBrightnessCall?.[0]).toMatchObject({ data: expect.any(Uint8ClampedArray) });
    expect(latestBrightnessCall?.[1]).toEqual({ brightness: 18, contrast: 0 });
    expect(renderCanvas).toHaveBeenCalledTimes(1);
  });
});
