import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------- mock the design system ---------- */

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@goblin-systems/goblin-design-system", async () => {
  const actual = await vi.importActual<
    typeof import("@goblin-systems/goblin-design-system")
  >("@goblin-systems/goblin-design-system");
  return {
    ...actual,
    confirmModal: mocks.confirmModal,
    applyIcons: vi.fn(),
    openModal: vi.fn(
      (options: import("@goblin-systems/goblin-design-system").ModalOptions) => {
        const { backdrop, onAccept, onReject } = options;
        backdrop.removeAttribute("hidden");
        const acceptSelector = options.acceptBtnSelector ?? ".modal-btn-accept";
        const rejectSelector = options.rejectBtnSelector ?? ".modal-btn-reject";
        backdrop.querySelectorAll(acceptSelector).forEach((btn) => {
          btn.addEventListener("click", () => onAccept?.());
        });
        backdrop.querySelectorAll(rejectSelector).forEach((btn) => {
          btn.addEventListener("click", () => onReject?.());
        });
      },
    ),
    closeModal: vi.fn(
      (options: { backdrop: HTMLElement; onClose?: () => void }) => {
        options.backdrop.setAttribute("hidden", "");
        options.onClose?.();
      },
    ),
  };
});

/* ---------- imports ---------- */

import {
  aiPromptText,
  aiPromptTextWithInputScope,
  aiPromptSelect,
  aiPromptConfirm,
  aiPromptOutpaint,
  aiPromptOutpaintWithInputScope,
  aiPromptEnhancement,
  aiPromptRemoveBackground,
  aiPromptRemoveBackgroundWithInputScope,
  aiPromptThumbnail,
  aiPromptThumbnailWithInputScope,
} from "./aiPromptModal";

/* ---------- helpers ---------- */

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/* ---------- tests ---------- */

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("aiPromptText", () => {
  it("returns trimmed input on accept", async () => {
    const promise = aiPromptText("Title", "Enter something");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    expect(backdrop).not.toBeNull();
    expect(backdrop.hasAttribute("hidden")).toBe(false);
    expect(backdrop.querySelector("h3")!.textContent).toBe("Title");

    const input = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "  hello world  ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toBe("hello world");

    // modal removed from DOM after settle
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns null on reject", async () => {
    const promise = aiPromptText("Title", "Enter something");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();

    const result = await promise;
    expect(result).toBeNull();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns null when input is whitespace-only on accept", async () => {
    const promise = aiPromptText("Title", "Enter something");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const input = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "   ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    expect(await promise).toBeNull();
  });

  it("pre-fills default value", async () => {
    const promise = aiPromptText("Title", "Enter something", "default text");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const input = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    expect(input.value).toBe("default text");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    expect(await promise).toBe("default text");
  });
});

describe("aiPromptTextWithInputScope", () => {
  it("returns trimmed prompt and selected input scope", async () => {
    const promise = aiPromptTextWithInputScope("Title", "Enter something", "default text");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const inputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']");
    inputs[0].value = "  hello world  ";

    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    expect(select.options[0].textContent).toBe("selected layers");
    expect(select.options[1].textContent).toBe("visible content");
    select.value = "selected-layers";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    await expect(promise).resolves.toEqual({
      prompt: "hello world",
      inputScope: "selected-layers",
    });
  });

  it("defaults input scope to visible content", async () => {
    const promise = aiPromptTextWithInputScope("Title", "Enter something", "hello world");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("visible-content");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    await expect(promise).resolves.toEqual({
      prompt: "hello world",
      inputScope: "visible-content",
    });
  });
});

describe("aiPromptSelect", () => {
  const options = [
    { value: "mask", label: "Mask" },
    { value: "transparent", label: "Transparent" },
    { value: "replace", label: "Replace" },
  ];

  it("returns selected value on accept", async () => {
    const promise = aiPromptSelect("Pick output", "Choose one", options);
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    select.value = "transparent";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    expect(await promise).toBe("transparent");
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns null on reject", async () => {
    const promise = aiPromptSelect("Pick output", "Choose one", options);
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();

    expect(await promise).toBeNull();
  });

  it("first option is selected by default", async () => {
    const promise = aiPromptSelect("Pick output", "Choose one", options);
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("mask");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    expect(await promise).toBe("mask");
  });
});

describe("aiPromptConfirm", () => {
  it("delegates to confirmModal and returns its result", async () => {
    mocks.confirmModal.mockResolvedValue(true);

    const result = await aiPromptConfirm("Delete?", "This cannot be undone.");
    expect(result).toBe(true);
    expect(mocks.confirmModal).toHaveBeenCalledWith({
      title: "Delete?",
      message: "This cannot be undone.",
    });
  });

  it("returns false when confirmModal resolves false", async () => {
    mocks.confirmModal.mockResolvedValue(false);

    const result = await aiPromptConfirm("Delete?", "This cannot be undone.");
    expect(result).toBe(false);
  });
});

describe("aiPromptOutpaint", () => {
  it("returns prompt + expansion on accept", async () => {
    const promise = aiPromptOutpaint("Outpaint", "Configure outpainting");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    expect(backdrop).not.toBeNull();

    const textInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    textInput.value = "expand the sky";

    const numberInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='number']");
    expect(numberInputs.length).toBe(4);
    numberInputs[0].value = "64";  // top
    numberInputs[1].value = "96";  // right
    numberInputs[2].value = "32";  // bottom
    numberInputs[3].value = "128"; // left

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({
      prompt: "expand the sky",
      expansion: { top: 64, right: 96, bottom: 32, left: 128 },
    });
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns null on reject", async () => {
    const promise = aiPromptOutpaint("Outpaint", "Configure outpainting");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();

    expect(await promise).toBeNull();
  });

  it("returns null when prompt is empty on accept", async () => {
    const promise = aiPromptOutpaint("Outpaint", "Configure outpainting");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const textInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    textInput.value = "   ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    expect(await promise).toBeNull();
  });

  it("clamps negative expansion values to 0", async () => {
    const promise = aiPromptOutpaint("Outpaint", "Configure outpainting");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const textInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    textInput.value = "expand";

    const numberInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='number']");
    numberInputs[0].value = "-10";
    numberInputs[1].value = "50";
    numberInputs[2].value = "-999";
    numberInputs[3].value = "100";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({
      prompt: "expand",
      expansion: { top: 0, right: 50, bottom: 0, left: 100 },
    });
  });

  it("uses default values (prompt and expansion)", async () => {
    const promise = aiPromptOutpaint("Outpaint", "Configure outpainting");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const textInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    expect(textInput.value).toBe("continue the scene naturally");

    const numberInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='number']");
    expect(numberInputs[0].value).toBe("128");
    expect(numberInputs[1].value).toBe("128");
    expect(numberInputs[2].value).toBe("128");
    expect(numberInputs[3].value).toBe("128");

    // accept with defaults
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({
      prompt: "continue the scene naturally",
      expansion: { top: 128, right: 128, bottom: 128, left: 128 },
    });
  });
});

describe("aiPromptOutpaintWithInputScope", () => {
  it("returns prompt, expansion, and input scope", async () => {
    const promise = aiPromptOutpaintWithInputScope("Outpaint", "Configure outpainting");
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const textInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    textInput.value = "expand the sky";

    const numberInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='number']");
    numberInputs[0].value = "64";
    numberInputs[1].value = "96";
    numberInputs[2].value = "32";
    numberInputs[3].value = "128";

    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    select.value = "selected-layers";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    await expect(promise).resolves.toEqual({
      prompt: "expand the sky",
      inputScope: "selected-layers",
      expansion: { top: 64, right: 96, bottom: 32, left: 128 },
    });
  });
});

describe("aiPromptEnhancement", () => {
  it("returns intensity on accept with defaults", async () => {
    const promise = aiPromptEnhancement("AI Auto Enhance", "Enhance settings", {
      defaultIntensity: 65,
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    expect(backdrop).not.toBeNull();
    expect(backdrop.hasAttribute("hidden")).toBe(false);
    expect(backdrop.querySelector("h3")!.textContent).toBe("AI Auto Enhance");

    const range = backdrop.querySelector<HTMLInputElement>("input[type='range']")!;
    expect(range.value).toBe("65");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.intensity).toBe(0.65);
    expect(result!.prompt).toBeUndefined();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns null on reject", async () => {
    const promise = aiPromptEnhancement("AI Denoise", "Denoise settings", {
      defaultIntensity: 55,
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();

    expect(await promise).toBeNull();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns custom intensity value", async () => {
    const promise = aiPromptEnhancement("AI Denoise", "Denoise settings", {
      defaultIntensity: 55,
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const range = backdrop.querySelector<HTMLInputElement>("input[type='range']")!;
    range.value = "80";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.intensity).toBe(0.8);
    expect(result!.prompt).toBeUndefined();
  });

  it("hides prompt and reference fields by default", async () => {
    const promise = aiPromptEnhancement("AI Auto Enhance", "Enhance", {});
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const labels = backdrop.querySelectorAll<HTMLElement>("label.field-block");
    // First label is intensity (always visible), second is prompt (hidden), third is reference (hidden)
    expect(labels[1].hasAttribute("hidden")).toBe(true);
    expect(labels[2].hasAttribute("hidden")).toBe(true);

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();
    await promise;
  });

  it("shows prompt and reference fields when enabled", async () => {
    const promise = aiPromptEnhancement("AI Style Transfer", "Style settings", {
      showPrompt: true,
      showReferenceImages: true,
      defaultPrompt: "editorial matte film look",
      defaultIntensity: 65,
      promptLabel: "Style direction",
      promptPlaceholder: "editorial matte film look",
      referenceHelpText: "Optional. Add reference images when you want Vision Goblin to transfer their visual style onto the source image while preserving the source subject and composition.",
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const labels = backdrop.querySelectorAll<HTMLElement>("label.field-block");
    expect(labels[1].hasAttribute("hidden")).toBe(false);
    expect(labels[2].hasAttribute("hidden")).toBe(false);

    const promptInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    expect(promptInput.value).toBe("editorial matte film look");
    expect(labels[1].querySelector("span")?.textContent).toBe("Style direction");
    expect(promptInput.placeholder).toBe("editorial matte film look");
    expect(backdrop.textContent).toContain("transfer their visual style onto the source image while preserving the source subject and composition");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.intensity).toBe(0.65);
    expect(result!.prompt).toBe("editorial matte film look");
  });

  it("uses generic prompt copy defaults when custom enhancement copy is not provided", async () => {
    const promise = aiPromptEnhancement("AI Style Transfer", "Style settings", {
      showPrompt: true,
      showReferenceImages: true,
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const promptInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    expect(backdrop.querySelectorAll<HTMLElement>("label.field-block")[1].querySelector("span")?.textContent).toBe("Prompt");
    expect(promptInput.placeholder).toBe("Describe the enhancement you want");
    expect(backdrop.textContent).toContain("These images provide visual style guidance only");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();
    await promise;
  });

  it("returns trimmed prompt and undefined for empty prompt", async () => {
    const promise = aiPromptEnhancement("AI Style Transfer", "Style settings", {
      showPrompt: true,
      defaultPrompt: "",
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const promptInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    promptInput.value = "   ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result?.prompt).toBeUndefined();
  });

  it("uses default intensity of 65 when no default specified", async () => {
    const promise = aiPromptEnhancement("AI Restore", "Restore settings", {});
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const range = backdrop.querySelector<HTMLInputElement>("input[type='range']")!;
    expect(range.value).toBe("65");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result?.intensity).toBe(0.65);
  });

  it("updates the output display when slider changes", async () => {
    const promise = aiPromptEnhancement("AI Enhance", "Settings", {
      defaultIntensity: 50,
    });
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const range = backdrop.querySelector<HTMLInputElement>("input[type='range']")!;
    const output = backdrop.querySelector<HTMLOutputElement>("output")!;
    expect(output.textContent).toBe("50");

    range.value = "75";
    range.dispatchEvent(new Event("input"));
    expect(output.textContent).toBe("75");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();
    await promise;
  });
});

describe("aiPromptRemoveBackground", () => {
  it("returns mode and description when replace is selected with description", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    expect(backdrop).not.toBeNull();
    expect(backdrop.hasAttribute("hidden")).toBe(false);
    expect(backdrop.querySelector("h3")!.textContent).toBe("AI: Remove Background");

    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    select.value = "replace";
    select.dispatchEvent(new Event("change"));

    const descriptionInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    expect(descriptionInput.closest("[hidden]")).toBeNull();
    descriptionInput.value = "sunset beach";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({ mode: "replace", description: "sunset beach" });
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns mode only when mask is selected", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("mask");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({ mode: "mask" });
    expect(result).not.toHaveProperty("description");
  });

  it("returns mode only when transparent is selected", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    select.value = "transparent";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({ mode: "transparent" });
    expect(result).not.toHaveProperty("description");
  });

  it("returns null when cancelled", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();

    expect(await promise).toBeNull();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("description block is hidden by default and shown when replace is selected", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    const descriptionBlock = backdrop.querySelector<HTMLInputElement>("input[type='text']")!.parentElement!;

    // hidden by default (mask is selected)
    expect(descriptionBlock.hasAttribute("hidden")).toBe(true);

    // shown when replace selected
    select.value = "replace";
    select.dispatchEvent(new Event("change"));
    expect(descriptionBlock.hasAttribute("hidden")).toBe(false);

    // hidden again when switching back
    select.value = "transparent";
    select.dispatchEvent(new Event("change"));
    expect(descriptionBlock.hasAttribute("hidden")).toBe(true);

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();
    await promise;
  });

  it("returns description as undefined when replace is selected but description is empty", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const select = backdrop.querySelector<HTMLSelectElement>("select")!;
    select.value = "replace";
    select.dispatchEvent(new Event("change"));

    const descriptionInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    descriptionInput.value = "   ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({ mode: "replace" });
    expect(result!.description).toBeUndefined();
  });

  it("has correct placeholder on description input", async () => {
    const promise = aiPromptRemoveBackground();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const descriptionInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    expect(descriptionInput.placeholder).toBe("soft studio backdrop");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();
    await promise;
  });
});

describe("aiPromptRemoveBackgroundWithInputScope", () => {
  it("returns mode, description, and input scope", async () => {
    const promise = aiPromptRemoveBackgroundWithInputScope();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const selects = backdrop.querySelectorAll<HTMLSelectElement>("select");
    selects[0].value = "replace";
    selects[0].dispatchEvent(new Event("change"));
    selects[1].value = "selected-layers";

    const descriptionInput = backdrop.querySelector<HTMLInputElement>("input[type='text']")!;
    descriptionInput.value = "sunset beach";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    await expect(promise).resolves.toEqual({
      mode: "replace",
      description: "sunset beach",
      inputScope: "selected-layers",
    });
  });
});

describe("aiPromptThumbnail", () => {
  it("returns size and prompt on accept", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    expect(backdrop).not.toBeNull();
    expect(backdrop.hasAttribute("hidden")).toBe(false);
    expect(backdrop.querySelector("h3")!.textContent).toBe("AI: Generate Thumbnail");

    const selects = backdrop.querySelectorAll<HTMLSelectElement>("select");
    const sizeSelect = selects[0];
    sizeSelect.value = "1280x720";

    const promptInput = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']")[0];
    promptInput.value = "a vibrant colorful thumbnail";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({
      size: "1280x720",
      prompt: "a vibrant colorful thumbnail",
    });
    expect(result).not.toHaveProperty("textOverlay");
    expect(result).not.toHaveProperty("textPosition");
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns size, prompt, textOverlay, and textPosition when text overlay provided", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;

    const selects = backdrop.querySelectorAll<HTMLSelectElement>("select");
    const sizeSelect = selects[0];
    sizeSelect.value = "512x512";

    const textInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']");
    const promptInput = textInputs[0];
    promptInput.value = "clean thumbnail";

    const textOverlayInput = textInputs[1];
    textOverlayInput.value = "My Channel";
    textOverlayInput.dispatchEvent(new Event("input"));

    const positionSelect = selects[1];
    positionSelect.value = "top";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({
      size: "512x512",
      prompt: "clean thumbnail",
      textOverlay: "My Channel",
      textPosition: "top",
    });
  });

  it("returns null when cancelled", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();

    expect(await promise).toBeNull();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("returns null when prompt is empty on accept", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const promptInput = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']")[0];
    promptInput.value = "   ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    expect(await promise).toBeNull();
  });

  it("text position block is hidden by default and shown when text overlay has content", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const textInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']");
    const textOverlayInput = textInputs[1];

    const positionSelect = backdrop.querySelectorAll<HTMLSelectElement>("select")[1];
    const positionBlock = positionSelect.parentElement!;

    // hidden by default
    expect(positionBlock.hasAttribute("hidden")).toBe(true);

    // shown when text overlay has content
    textOverlayInput.value = "Hello";
    textOverlayInput.dispatchEvent(new Event("input"));
    expect(positionBlock.hasAttribute("hidden")).toBe(false);

    // hidden again when text overlay cleared
    textOverlayInput.value = "";
    textOverlayInput.dispatchEvent(new Event("input"));
    expect(positionBlock.hasAttribute("hidden")).toBe(true);

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-reject")!.click();
    await promise;
  });

  it("uses default values", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;

    const selects = backdrop.querySelectorAll<HTMLSelectElement>("select");
    expect(selects[0].value).toBe("512x512");

    const promptInput = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']")[0];
    expect(promptInput.value).toBe("psychedelic background, surprised face with open mouth");

    const textOverlayInput = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']")[1];
    expect(textOverlayInput.value).toBe("");
    expect(textOverlayInput.placeholder).toBe("Corpos hate this trick");

    expect(selects[1].value).toBe("bottom");

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).toEqual({
      size: "512x512",
      prompt: "psychedelic background, surprised face with open mouth",
    });
  });

  it("does not include textOverlay when overlay is whitespace-only", async () => {
    const promise = aiPromptThumbnail();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const textInputs = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']");
    textInputs[1].value = "   ";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("textOverlay");
    expect(result).not.toHaveProperty("textPosition");
  });
});

describe("aiPromptThumbnailWithInputScope", () => {
  it("returns thumbnail config and input scope", async () => {
    const promise = aiPromptThumbnailWithInputScope();
    await tick();

    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const selects = backdrop.querySelectorAll<HTMLSelectElement>("select");
    selects[0].value = "1280x720";
    selects[2].value = "selected-layers";

    const promptInput = backdrop.querySelectorAll<HTMLInputElement>("input[type='text']")[0];
    promptInput.value = "a vibrant colorful thumbnail";

    backdrop.querySelector<HTMLButtonElement>(".modal-btn-accept")!.click();

    await expect(promise).resolves.toEqual({
      size: "1280x720",
      prompt: "a vibrant colorful thumbnail",
      inputScope: "selected-layers",
    });
  });
});
