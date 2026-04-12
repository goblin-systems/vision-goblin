import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../../editor/actions/documentActions";
import { installPixelCanvasMock, readPixel, setPixel } from "../../test/pixelCanvasMock";
import {
  DEFAULT_ADD_REFLECTION_GUIDE_SESSION_CONFIG,
  DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG,
  DEFAULT_CLONE_OBJECT_GUIDE_SESSION_CONFIG,
  DEFAULT_MOVE_OBJECT_GUIDE_SESSION_CONFIG,
  DEFAULT_REMOVE_REFLECTION_GUIDE_SESSION_CONFIG,
  DEFAULT_REMOVE_SHADOW_GUIDE_SESSION_CONFIG,
  createShadowGuideSessionController,
} from "./shadowGuideSession";

describe("shadowGuideSession", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    mount.id = "shadow-session-mount";
    mount.hidden = true;
    document.body.appendChild(mount);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installPixelCanvasMock();
  });

  it("starts with empty guides and defaults painting to caster", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    doc.selectionMask = document.createElement("canvas");
    doc.selectionMask.width = 24;
    doc.selectionMask.height = 24;
    setPixel(doc.selectionMask, 4, 5, { r: 255, g: 255, b: 255, a: 255 });

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    void controller.start(doc);

    expect(controller.isActive()).toBe(true);
    expect(readPixel(controller.getState()!.surfaceMask, 4, 5).a).toBe(0);
    expect(controller.getPaintTarget()?.canvas).toBe(controller.getState()!.casterMask);
    expect(controller.getPaintTarget()?.exclusiveCanvas).toBe(controller.getState()!.surfaceMask);
  });

  it("ignores rect selections when starting the guide session", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    doc.selectionMask = null;
    doc.selectionRect = { x: 3, y: 4, width: 5, height: 6 };

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    void controller.start(doc);

    expect(controller.isActive()).toBe(true);
    expect(readPixel(controller.getState()!.surfaceMask, 5, 6).a).toBe(0);
  });

  it("switches guide channels from the unified floating panel", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    doc.selectionMask = document.createElement("canvas");
    doc.selectionMask.width = 24;
    doc.selectionMask.height = 24;

    const renderCanvas = vi.fn();
    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      renderCanvas,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    void controller.start(doc);
    const surfaceButton = document.querySelector<HTMLButtonElement>('button[data-shadow-guide-channel="surface"]');
    surfaceButton?.click();

    expect(controller.getPaintTarget()?.canvas).toBe(controller.getState()!.surfaceMask);
    expect(renderCanvas).toHaveBeenCalledTimes(2);
  });

  it("restores the previous tool and resolves null when cancelled", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    doc.selectionMask = document.createElement("canvas");
    doc.selectionMask.width = 24;
    doc.selectionMask.height = 24;

    const setActiveTool = vi.fn();
    const renderEditorState = vi.fn();
    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool,
      renderCanvas: vi.fn(),
      renderEditorState,
      showToast: vi.fn(),
    });

    const promise = controller.start(doc);
    controller.cancel();

    await expect(promise).resolves.toBeNull();
    expect(setActiveTool).toHaveBeenNthCalledWith(1, "brush");
    expect(setActiveTool).toHaveBeenNthCalledWith(2, "move");
    expect(renderEditorState).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it("returns both masks when completed", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc);
    setPixel(controller.getState()!.casterMask, 8, 9, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 2, 3, { r: 255, g: 255, b: 255, a: 255 });
    const result = controller.complete();

    expect(result).not.toBeNull();
    await expect(promise).resolves.toEqual(result);
    expect(result).toMatchObject({
      guideMode: "shadow-add",
      intensity: 50,
      lightDirection: "auto",
      inputScope: "visible-content",
    });
    expect(readPixel(result!.casterMask, 8, 9).a).toBe(255);
    expect(readPixel(result!.surfaceMask, 2, 3).a).toBe(255);
  });

  it("requires both caster and surface guides before completion", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    doc.selectionMask = document.createElement("canvas");
    doc.selectionMask.width = 24;
    doc.selectionMask.height = 24;

    const showToast = vi.fn();
    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    void controller.start(doc);

    expect(controller.complete()).toBeNull();
    expect(showToast).toHaveBeenCalledWith("Paint the shadow caster in red before applying.", "error");
  });

  it("shows updated copy explaining both guides are painted manually", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    void controller.start(doc);

    expect(document.getElementById("shadow-session-mount")?.hidden).toBe(false);
    expect(document.body.querySelector(".modal-card")).not.toBeNull();
    expect(document.body.querySelector(".modal-backdrop")).toBeNull();
    expect(document.body.textContent).toContain("Set the light, then paint both guides manually: red for the shadow caster and black for the landing surface.");
    expect(document.body.textContent).toContain("Both guides start empty. Use Brush to add and Eraser to subtract.");
    expect(showToast).toHaveBeenCalledWith(
      "Paint both guides manually: red for the caster, black for the landing surface.",
      "info",
    );
  });

  it("returns updated settings chosen in the same panel", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc);
    const panel = document.querySelector<HTMLElement>("[data-shadow-guide-session]")!;
    const intensity = panel.querySelector<HTMLInputElement>("[data-shadow-guide-intensity]")!;
    const output = panel.querySelector<HTMLOutputElement>("[data-shadow-guide-intensity-output]")!;
    const direction = panel.querySelector<HTMLSelectElement>("[data-shadow-guide-direction]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-shadow-guide-input-scope]")!;

    intensity.value = "83";
    intensity.dispatchEvent(new Event("input"));
    direction.value = "bottom-right";
    direction.dispatchEvent(new Event("change"));
    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));

    setPixel(controller.getState()!.casterMask, 8, 9, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 2, 3, { r: 255, g: 255, b: 255, a: 255 });

    expect(output.textContent).toBe("83");

    panel.querySelector<HTMLButtonElement>("[data-shadow-guide-complete]")?.click();

    await expect(promise).resolves.toMatchObject({
      guideMode: "shadow-add",
      intensity: 83,
      lightDirection: "bottom-right",
      inputScope: "selected-layers",
    });
  });

  it("supports custom guide session copy and no-extra-controls future structure", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc, {
      ...DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG,
      guideMode: "move-object",
      title: "AI: Move Object",
      description: "Paint red for source and black for destination.",
      applyLabel: "Move Object",
      startToastMessage: "Paint source and destination guides.",
      readyToastMessage: "Move guides ready.",
      cancelToastMessage: "Move guide cancelled.",
      channels: {
        caster: {
          ...DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG.channels.caster,
          label: "Source (red)",
          validationMessage: "Paint the source object in red before applying.",
        },
        surface: {
          ...DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG.channels.surface,
          label: "Destination (black)",
          validationMessage: "Paint the destination area in black before applying.",
        },
      },
      extraControls: undefined,
    });

    expect(document.body.textContent).toContain("AI: Move Object");
    expect(document.body.textContent).toContain("Paint red for source and black for destination.");
    expect(document.body.textContent).toContain("Source (red)");
    expect(document.body.textContent).toContain("Destination (black)");
    expect(document.querySelector('[data-shadow-guide-intensity]')).toBeNull();

    setPixel(controller.getState()!.casterMask, 1, 1, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 2, 2, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({ guideMode: "move-object" });
  });

  it("supports remove-shadow specific copy and controls in the shared floating panel", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_REMOVE_SHADOW_GUIDE_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-shadow-guide-session]")!;
    const intensity = panel.querySelector<HTMLInputElement>("[data-shadow-guide-intensity]")!;
    const output = panel.querySelector<HTMLOutputElement>("[data-shadow-guide-intensity-output]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-shadow-guide-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Remove Shadow");
    expect(document.body.textContent).toContain("Paint black over the existing shadow you want to reduce or remove");
    expect(document.body.textContent).toContain("Shadow area (black)");
    expect(document.body.textContent).toContain("Shadow reduction");
    expect(document.body.textContent).not.toContain("Optional context (red)");
    expect(document.body.textContent).not.toContain("Red is optional extra context");
    expect(panel.querySelector('button[data-shadow-guide-channel="caster"]')).toBeNull();
    expect(panel.querySelectorAll('[data-shadow-guide-channel]')).toHaveLength(1);
    expect(document.querySelector('[data-shadow-guide-direction]')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Paint black over the shadow to reduce or remove.",
      "info",
    );

    intensity.value = "88";
    intensity.dispatchEvent(new Event("input"));
    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));

    expect(output.textContent).toBe("88");

    setPixel(controller.getState()!.surfaceMask, 7, 7, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({
      guideMode: "shadow-remove",
      intensity: 88,
      inputScope: "selected-layers",
    });
  });

  it("allows remove-shadow completion with only the black guide painted", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc, DEFAULT_REMOVE_SHADOW_GUIDE_SESSION_CONFIG);

    expect(controller.getPaintTarget()?.canvas).toBe(controller.getState()!.surfaceMask);

    setPixel(controller.getState()!.surfaceMask, 5, 5, { r: 255, g: 255, b: 255, a: 255 });
    const result = controller.complete();

    expect(result).not.toBeNull();
    await expect(promise).resolves.toEqual(result);
  });

  it("supports add-reflection specific copy and source plus target guide semantics", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_ADD_REFLECTION_GUIDE_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-shadow-guide-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-shadow-guide-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Add Reflection");
    expect(document.body.textContent).toContain("Paint red over the bright source object or light cause of the reflection or glare");
    expect(document.body.textContent).toContain("Source / glare cause (red)");
    expect(document.body.textContent).toContain("Reflection target (black)");
    expect(document.querySelector('[data-shadow-guide-direction]')).toBeNull();
    expect(document.querySelector('[data-shadow-guide-intensity]')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Paint red over the bright source or glare cause, and black over the target reflection region.",
      "info",
    );

    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));

    setPixel(controller.getState()!.casterMask, 3, 3, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 10, 10, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({
      guideMode: "reflection-add",
      inputScope: "selected-layers",
    });
  });

  it("supports remove-reflection specific copy and allows black-only completion", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_REMOVE_REFLECTION_GUIDE_SESSION_CONFIG);

    expect(document.body.textContent).toContain("AI: Remove Reflection");
    expect(document.body.textContent).toContain("Paint black over the reflection or glare region to remove or reduce");
    expect(document.body.textContent).toContain("Reflection / glare area (black)");
    expect(document.body.textContent).not.toContain("Optional context (red)");
    expect(document.body.textContent).not.toContain("Red is optional extra context");
    expect(document.querySelector('button[data-shadow-guide-channel="caster"]')).toBeNull();
    expect(document.querySelectorAll('[data-shadow-guide-channel]')).toHaveLength(1);
    expect(controller.getPaintTarget()?.canvas).toBe(controller.getState()!.surfaceMask);
    expect(showToast).toHaveBeenCalledWith(
      "Paint black over the reflection or glare to reduce or remove.",
      "info",
    );

    setPixel(controller.getState()!.surfaceMask, 6, 6, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({ guideMode: "reflection-remove" });
  });

  it("supports move-object specific copy and single-destination guidance in the shared floating panel", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_MOVE_OBJECT_GUIDE_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-shadow-guide-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-shadow-guide-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Move Object");
    expect(document.body.textContent).toContain("Paint red over the original object to move");
    expect(document.body.textContent).toContain("Object to move (red)");
    expect(document.body.textContent).toContain("Destination (black)");
    expect(document.body.textContent).toContain("one destination area only in v1");
    expect(document.querySelector('[data-shadow-guide-direction]')).toBeNull();
    expect(document.querySelector('[data-shadow-guide-intensity]')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Paint red over the object to move, and black over one destination area.",
      "info",
    );

    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));

    setPixel(controller.getState()!.casterMask, 3, 3, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 10, 10, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({
      guideMode: "move-object",
      inputScope: "selected-layers",
    });
  });

  it("supports clone-object specific copy and multi-destination guidance in the shared floating panel", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createShadowGuideSessionController({
      mountRoot: document.getElementById("shadow-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_CLONE_OBJECT_GUIDE_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-shadow-guide-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-shadow-guide-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Clone Object");
    expect(document.body.textContent).toContain("Paint red over the original object to duplicate");
    expect(document.body.textContent).toContain("Object to clone (red)");
    expect(document.body.textContent).toContain("Clone destinations (black)");
    expect(document.body.textContent).toContain("one or more destination areas for new copies in v1");
    expect(document.querySelector('[data-shadow-guide-direction]')).toBeNull();
    expect(document.querySelector('[data-shadow-guide-intensity]')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Paint red over the object to clone, and black over one or more destination areas.",
      "info",
    );

    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));

    setPixel(controller.getState()!.casterMask, 2, 2, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 8, 8, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({
      guideMode: "clone-object",
      inputScope: "selected-layers",
    });
  });
});
