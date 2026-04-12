import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNewDocument } from "../../editor/actions/documentActions";
import { installPixelCanvasMock, readPixel, setPixel } from "../../test/pixelCanvasMock";
import {
  DEFAULT_ADD_REFLECTION_SESSION_CONFIG,
  DEFAULT_ADD_SHADOW_SESSION_CONFIG,
  DEFAULT_CLONE_OBJECT_SESSION_CONFIG,
  DEFAULT_AI_HEALING_SESSION_CONFIG,
  DEFAULT_DENOISE_SESSION_CONFIG,
  DEFAULT_INPAINT_SESSION_CONFIG,
  DEFAULT_MOVE_OBJECT_SESSION_CONFIG,
  DEFAULT_REMOVE_REFLECTION_SESSION_CONFIG,
  DEFAULT_REMOVE_SHADOW_SESSION_CONFIG,
  DEFAULT_REPLACE_TEXT_SESSION_CONFIG,
  createAiMaskSessionController,
} from "./aiMaskSession";

describe("aiMaskSession", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    mount.id = "ai-mask-session-mount";
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace",
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
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
    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas,
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    void controller.start(doc);
    const surfaceButton = document.querySelector<HTMLButtonElement>('button[data-ai-mask-channel="surface"]');
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
    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool,
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
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
      inputScope: "selected-layers",
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
    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    void controller.start(doc);

    expect(document.getElementById("ai-mask-session-mount")?.hidden).toBe(false);
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const intensity = panel.querySelector<HTMLInputElement>("[data-ai-mask-intensity]")!;
    const output = panel.querySelector<HTMLOutputElement>("[data-ai-mask-intensity-output]")!;
    const direction = panel.querySelector<HTMLSelectElement>("[data-ai-mask-direction]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;

    intensity.value = "83";
    intensity.dispatchEvent(new Event("input"));
    direction.value = "bottom-right";
    direction.dispatchEvent(new Event("change"));
    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));

    setPixel(controller.getState()!.casterMask, 8, 9, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 2, 3, { r: 255, g: 255, b: 255, a: 255 });

    expect(output.textContent).toBe("83");

    panel.querySelector<HTMLButtonElement>("[data-ai-mask-complete]")?.click();

    await expect(promise).resolves.toMatchObject({
      guideMode: "shadow-add",
      intensity: 83,
      lightDirection: "bottom-right",
      inputScope: "selected-layers",
    });
  });

  it("supports custom guide session copy and no-extra-controls future structure", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc, {
      ...DEFAULT_ADD_SHADOW_SESSION_CONFIG,
      guideMode: "move-object",
      title: "AI: Move Object",
      description: "Paint red for source and black for destination.",
      applyLabel: "Move Object",
      startToastMessage: "Paint source and destination guides.",
      readyToastMessage: "Move guides ready.",
      cancelToastMessage: "Move guide cancelled.",
      channels: {
        caster: {
          ...DEFAULT_ADD_SHADOW_SESSION_CONFIG.channels.caster,
          label: "Source (red)",
          validationMessage: "Paint the source object in red before applying.",
        },
        surface: {
          ...DEFAULT_ADD_SHADOW_SESSION_CONFIG.channels.surface,
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
    expect(document.querySelector('[data-ai-mask-intensity]')).toBeNull();

    setPixel(controller.getState()!.casterMask, 1, 1, { r: 255, g: 255, b: 255, a: 255 });
    setPixel(controller.getState()!.surfaceMask, 2, 2, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({ guideMode: "move-object" });
  });

  it("supports remove-shadow specific copy and controls in the shared floating panel", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_REMOVE_SHADOW_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const intensity = panel.querySelector<HTMLInputElement>("[data-ai-mask-intensity]")!;
    const output = panel.querySelector<HTMLOutputElement>("[data-ai-mask-intensity-output]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Remove Shadow");
    expect(document.body.textContent).toContain("Paint black over the existing shadow you want to reduce or remove");
    expect(document.body.textContent).toContain("Shadow area (black)");
    expect(document.body.textContent).toContain("Shadow reduction");
    expect(document.body.textContent).not.toContain("Optional context (red)");
    expect(document.body.textContent).not.toContain("Red is optional extra context");
    expect(panel.querySelector('button[data-ai-mask-channel="caster"]')).toBeNull();
    expect(panel.querySelectorAll('[data-ai-mask-channel]')).toHaveLength(1);
    expect(document.querySelector('[data-ai-mask-direction]')).toBeNull();
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    const promise = controller.start(doc, DEFAULT_REMOVE_SHADOW_SESSION_CONFIG);

    expect(controller.getPaintTarget()?.canvas).toBe(controller.getState()!.surfaceMask);

    setPixel(controller.getState()!.surfaceMask, 5, 5, { r: 255, g: 255, b: 255, a: 255 });
    const result = controller.complete();

    expect(result).not.toBeNull();
    await expect(promise).resolves.toEqual(result);
  });

  it("supports AI healing single-channel copy and requires a non-empty mask", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_AI_HEALING_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Healing");
    expect(document.body.textContent).toContain("Paint or select the area to heal with a single AI inpainting pass.");
    expect(document.body.textContent).toContain("Healing area");
    expect(document.querySelector('button[data-ai-mask-channel="caster"]')).toBeNull();
    expect(controller.complete()).toBeNull();
    expect(showToast).toHaveBeenCalledWith("Paint or select the area to heal before continuing.", "error");

    inputScope.value = "selected-layers";
    inputScope.dispatchEvent(new Event("change"));
    setPixel(controller.getState()!.surfaceMask, 4, 4, { r: 255, g: 255, b: 255, a: 255 });
    controller.complete();

    await expect(promise).resolves.toMatchObject({
      guideMode: "heal",
      inputScope: "selected-layers",
    });
  });

  it("supports AI denoise single-channel copy, selection tools, input scope, and blank-mask fallback copy", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_DENOISE_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;
    const intensity = panel.querySelector<HTMLInputElement>("[data-ai-mask-intensity]")!;

    expect(document.body.textContent).toContain("AI: Denoise");
    expect(document.body.textContent).toContain("Paint or select the area to denoise");
    expect(document.body.textContent).toContain("Denoise area");
    expect(document.body.textContent).toContain("Denoise strength");
    expect(document.querySelector('button[data-ai-mask-channel="caster"]')).toBeNull();
    expect(document.querySelectorAll("[data-ai-mask-tool]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-ai-mask-selection-mode]")).toHaveLength(4);
    expect(showToast).toHaveBeenCalledWith(
      "Paint or select the denoise area, or continue to process the full target.",
      "info",
    );

    inputScope.value = "visible-content";
    inputScope.dispatchEvent(new Event("change"));
    intensity.value = "72";
    intensity.dispatchEvent(new Event("input"));

    controller.complete();

    await expect(promise).resolves.toMatchObject({
      guideMode: "denoise",
      inputScope: "visible-content",
      intensity: 72,
    });
  });

  it("shows input scope for replace raster text and defaults it to selected layers", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    void controller.start(doc, DEFAULT_REPLACE_TEXT_SESSION_CONFIG);

    const inputScope = document.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]");
    expect(inputScope).not.toBeNull();
    expect(inputScope?.value).toBe("selected-layers");
  });

  it("supports add-reflection specific copy and source plus target guide semantics", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const showToast = vi.fn();

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_ADD_REFLECTION_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Add Reflection");
    expect(document.body.textContent).toContain("Paint red over the bright source object or light cause of the reflection or glare");
    expect(document.body.textContent).toContain("Source / glare cause (red)");
    expect(document.body.textContent).toContain("Reflection target (black)");
    expect(document.querySelector('[data-ai-mask-direction]')).toBeNull();
    expect(document.querySelector('[data-ai-mask-intensity]')).toBeNull();
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_REMOVE_REFLECTION_SESSION_CONFIG);

    expect(document.body.textContent).toContain("AI: Remove Reflection");
    expect(document.body.textContent).toContain("Paint black over the reflection or glare region to remove or reduce");
    expect(document.body.textContent).toContain("Reflection / glare area (black)");
    expect(document.body.textContent).not.toContain("Optional context (red)");
    expect(document.body.textContent).not.toContain("Red is optional extra context");
    expect(document.querySelector('button[data-ai-mask-channel="caster"]')).toBeNull();
    expect(document.querySelectorAll('[data-ai-mask-channel]')).toHaveLength(1);
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_MOVE_OBJECT_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Move Object");
    expect(document.body.textContent).toContain("Paint red over the original object to move");
    expect(document.body.textContent).toContain("Object to move (red)");
    expect(document.body.textContent).toContain("Destination (black)");
    expect(document.body.textContent).toContain("one destination area only in v1");
    expect(document.querySelector('[data-ai-mask-direction]')).toBeNull();
    expect(document.querySelector('[data-ai-mask-intensity]')).toBeNull();
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

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "move",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast,
    });

    const promise = controller.start(doc, DEFAULT_CLONE_OBJECT_SESSION_CONFIG);
    const panel = document.querySelector<HTMLElement>("[data-ai-mask-session]")!;
    const inputScope = panel.querySelector<HTMLSelectElement>("[data-ai-mask-input-scope]")!;

    expect(document.body.textContent).toContain("AI: Clone Object");
    expect(document.body.textContent).toContain("Paint red over the original object to duplicate");
    expect(document.body.textContent).toContain("Object to clone (red)");
    expect(document.body.textContent).toContain("Clone destinations (black)");
    expect(document.body.textContent).toContain("one or more destination areas for new copies in v1");
    expect(document.querySelector('[data-ai-mask-direction]')).toBeNull();
    expect(document.querySelector('[data-ai-mask-intensity]')).toBeNull();
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

  it("enables selection-capable tools for guided move/clone/shadow/reflection sessions", () => {
    expect(DEFAULT_ADD_SHADOW_SESSION_CONFIG.allowedTools).toEqual(DEFAULT_INPAINT_SESSION_CONFIG.allowedTools);
    expect(DEFAULT_REMOVE_SHADOW_SESSION_CONFIG.allowedTools).toEqual(DEFAULT_INPAINT_SESSION_CONFIG.allowedTools);
    expect(DEFAULT_ADD_REFLECTION_SESSION_CONFIG.allowedTools).toEqual(DEFAULT_INPAINT_SESSION_CONFIG.allowedTools);
    expect(DEFAULT_REMOVE_REFLECTION_SESSION_CONFIG.allowedTools).toEqual(DEFAULT_INPAINT_SESSION_CONFIG.allowedTools);
    expect(DEFAULT_MOVE_OBJECT_SESSION_CONFIG.allowedTools).toEqual(DEFAULT_INPAINT_SESSION_CONFIG.allowedTools);
    expect(DEFAULT_CLONE_OBJECT_SESSION_CONFIG.allowedTools).toEqual(DEFAULT_INPAINT_SESSION_CONFIG.allowedTools);
  });

  it("returns the active channel canvas or null when inactive", async () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");

    const controller = createAiMaskSessionController({
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush",
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
    });

    expect(controller.getActiveChannelCanvas()).toBeNull();

    void controller.start(doc);

    expect(controller.getActiveChannelCanvas()).toBe(controller.getState()!.casterMask);

    const surfaceButton = document.querySelector<HTMLButtonElement>('button[data-ai-mask-channel="surface"]');
    surfaceButton?.click();

    expect(controller.getActiveChannelCanvas()).toBe(controller.getState()!.surfaceMask);
  });
});

// ---------------------------------------------------------------------------
// tool picker and selection mode UI
// ---------------------------------------------------------------------------

describe("aiMaskSession — tool picker and selection mode", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    mount.id = "ai-mask-session-mount";
    mount.hidden = true;
    document.body.appendChild(mount);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installPixelCanvasMock();
  });

  function makeDeps(overrides?: Partial<Parameters<typeof createAiMaskSessionController>[0]>) {
    return {
      mountRoot: document.getElementById("ai-mask-session-mount")!,
      getActiveTool: () => "brush" as const,
      setActiveTool: vi.fn(),
      setSelectionMode: vi.fn(),
      getSelectionMode: () => "replace" as const,
      renderCanvas: vi.fn(),
      renderEditorState: vi.fn(),
      showToast: vi.fn(),
      ...overrides,
    };
  }

  it("renders tool picker when allowedTools > 2", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const controller = createAiMaskSessionController(makeDeps());

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    const toolsContainer = document.querySelector("[data-ai-mask-tools]");
    expect(toolsContainer).not.toBeNull();
    const toolButtons = toolsContainer!.querySelectorAll("[data-ai-mask-tool]");
    expect(toolButtons).toHaveLength(6);
  });

  it("does NOT render tool picker when allowedTools <= 2", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const controller = createAiMaskSessionController(makeDeps());

    void controller.start(doc, {
      ...DEFAULT_ADD_SHADOW_SESSION_CONFIG,
      allowedTools: ["brush", "eraser"],
    });

    const toolsContainer = document.querySelector("[data-ai-mask-tools]");
    expect(toolsContainer).toBeNull();
  });

  it("clicking a tool button calls setActiveTool", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const setActiveTool = vi.fn();
    const controller = createAiMaskSessionController(makeDeps({ setActiveTool }));

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    const marqueeBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-tool="marquee"]');
    expect(marqueeBtn).not.toBeNull();
    marqueeBtn!.click();

    expect(setActiveTool).toHaveBeenCalledWith("marquee");
  });

  it("renders selection mode buttons when selection tools are included", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const controller = createAiMaskSessionController(makeDeps());

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    const modesContainer = document.querySelector("[data-ai-mask-modes]");
    expect(modesContainer).not.toBeNull();
    const modeButtons = modesContainer!.querySelectorAll("[data-ai-mask-selection-mode]");
    expect(modeButtons).toHaveLength(4);
  });

  it("uses leaner plus minus icons with custom intersect while keeping replace on lucide", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const controller = createAiMaskSessionController(makeDeps());

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    const replaceBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="replace"]');
    const addBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="add"]');
    const removeBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="subtract"]');
    const intersectBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="intersect"]');
    expect(replaceBtn?.querySelector("svg.selection-mode-btn__icon-svg")).toBeNull();
    expect(replaceBtn?.querySelector("svg")).not.toBeNull();
    expect(addBtn?.getAttribute("title")).toBe("Add");
    expect(removeBtn?.getAttribute("title")).toBe("Remove");
    expect(intersectBtn).not.toBeNull();
    expect(intersectBtn?.getAttribute("title")).toBe("Intersect");
    expect(intersectBtn?.getAttribute("aria-label")).toBe("Intersect");
    expect(addBtn?.querySelector(".selection-mode-btn__icon svg")).not.toBeNull();
    expect(removeBtn?.querySelector(".selection-mode-btn__icon svg")).not.toBeNull();
    expect(intersectBtn?.querySelector("svg.selection-mode-btn__icon-svg")).not.toBeNull();
    expect(addBtn?.querySelector("svg.selection-mode-btn__icon-svg")).toBeNull();
    expect(removeBtn?.querySelector("svg.selection-mode-btn__icon-svg")).toBeNull();
    expect(intersectBtn?.querySelector("i")).toBeNull();
  });

  it("does NOT render selection mode buttons without selection tools", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const controller = createAiMaskSessionController(makeDeps());

    void controller.start(doc, {
      ...DEFAULT_ADD_SHADOW_SESSION_CONFIG,
      allowedTools: ["brush", "eraser"],
    });

    const modesContainer = document.querySelector("[data-ai-mask-modes]");
    expect(modesContainer).toBeNull();
  });

  it("renders tool picker and selection modes for guided shadow config", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const controller = createAiMaskSessionController(makeDeps());

    void controller.start(doc, DEFAULT_ADD_SHADOW_SESSION_CONFIG);

    expect(document.querySelectorAll("[data-ai-mask-tool]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-ai-mask-selection-mode]")).toHaveLength(4);
  });

  it("clicking selection mode button calls setSelectionMode", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    const setSelectionMode = vi.fn();
    const controller = createAiMaskSessionController(makeDeps({ setSelectionMode }));

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    const addBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="add"]');
    expect(addBtn).not.toBeNull();
    addBtn!.click();

    expect(setSelectionMode).toHaveBeenCalledWith("add");
  });

  it("clicking selection mode button updates active styling immediately", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    let currentMode = "replace";
    const controller = createAiMaskSessionController(makeDeps({
      getSelectionMode: () => currentMode as import("../../editor/selection").SelectionMode,
      setSelectionMode: vi.fn(),
    }));

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    const replaceBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="replace"]');
    const addBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="add"]');
    expect(replaceBtn!.classList.contains("is-active")).toBe(true);
    expect(addBtn!.classList.contains("is-active")).toBe(false);

    addBtn!.click();

    expect(replaceBtn!.classList.contains("is-active")).toBe(false);
    expect(addBtn!.classList.contains("is-active")).toBe(true);

    currentMode = "add";
    controller.syncToolState();
    expect(addBtn!.classList.contains("is-active")).toBe(true);
  });

  it("syncToolState updates tool button active state", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    let currentTool = "brush";
    const controller = createAiMaskSessionController(makeDeps({
      getActiveTool: () => currentTool as import("../../settings").ToolName,
    }));

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    // Initially brush should be active
    const brushBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-tool="brush"]');
    const lassoBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-tool="lasso"]');
    expect(brushBtn!.classList.contains("is-active")).toBe(true);
    expect(lassoBtn!.classList.contains("is-active")).toBe(false);

    // Externally change tool and sync
    currentTool = "lasso";
    controller.syncToolState();

    expect(brushBtn!.classList.contains("is-active")).toBe(false);
    expect(lassoBtn!.classList.contains("is-active")).toBe(true);
  });

  it("syncToolState updates selection mode button active state", () => {
    const doc = makeNewDocument("Doc", 24, 24, 100, "transparent");
    let currentMode = "replace";
    const controller = createAiMaskSessionController(makeDeps({
      getSelectionMode: () => currentMode as import("../../editor/selection").SelectionMode,
    }));

    void controller.start(doc, DEFAULT_INPAINT_SESSION_CONFIG);

    // Initially replace should be active
    const replaceBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="replace"]');
    const addBtn = document.querySelector<HTMLButtonElement>('[data-ai-mask-selection-mode="add"]');
    expect(replaceBtn!.classList.contains("is-active")).toBe(true);
    expect(addBtn!.classList.contains("is-active")).toBe(false);

    // Externally change mode and sync
    currentMode = "add";
    controller.syncToolState();

    expect(replaceBtn!.classList.contains("is-active")).toBe(false);
    expect(addBtn!.classList.contains("is-active")).toBe(true);
  });
});
