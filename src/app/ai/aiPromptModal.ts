import {
  applyIcons,
  confirmModal,
  openModal,
} from "@goblin-systems/goblin-design-system";
import type { AiInputScope } from "./types";

/* ---------- types ---------- */

export interface OutpaintExpansion {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface OutpaintResult {
  prompt: string;
  expansion: OutpaintExpansion;
}

export interface ScopedOutpaintResult extends OutpaintResult {
  inputScope: AiInputScope;
}

export interface TextPromptWithInputScopeResult {
  prompt: string;
  inputScope: AiInputScope;
}

export interface RemoveBackgroundResult {
  mode: "mask" | "transparent" | "replace";
  description?: string;
}

export interface ScopedRemoveBackgroundResult extends RemoveBackgroundResult {
  inputScope: AiInputScope;
}

export interface ThumbnailPromptResult {
  size: string;
  prompt: string;
  textOverlay?: string;
  textPosition?: string;
}

export interface ScopedThumbnailPromptResult extends ThumbnailPromptResult {
  inputScope: AiInputScope;
}

const AI_INPUT_SCOPE_OPTIONS: Array<{ value: AiInputScope; label: string }> = [
  { value: "selected-layers", label: "selected layers" },
  { value: "visible-content", label: "visible content" },
];
const DEFAULT_AI_INPUT_SCOPE: AiInputScope = "visible-content";

/* ---------- internal helpers ---------- */

function createBackdrop(id: string, cardHtml: string): HTMLDivElement {
  const backdrop = document.createElement("div");
  backdrop.id = id;
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("hidden", "");
  backdrop.innerHTML = cardHtml;
  document.body.appendChild(backdrop);
  applyIcons();
  return backdrop;
}

function removeBackdrop(backdrop: HTMLElement): void {
  backdrop.remove();
}

function createInputScopeField(id: string, defaultValue: AiInputScope = DEFAULT_AI_INPUT_SCOPE): string {
  const optionsHtml = AI_INPUT_SCOPE_OPTIONS
    .map((opt) => `<option value="${escapeAttr(opt.value)}"${opt.value === defaultValue ? " selected" : ""}>${escapeHtml(opt.label)}</option>`)
    .join("");

  return `<label class="field-block" for="${id}">
    <span>Input scope</span>
    <select id="${id}" class="input">${optionsHtml}</select>
  </label>`;
}

function readInputScope(backdrop: HTMLElement, inputScopeId: string): AiInputScope {
  return backdrop.querySelector<HTMLSelectElement>(`#${inputScopeId}`)?.value === "selected-layers"
    ? "selected-layers"
    : "visible-content";
}

let modalCounter = 0;

/* ---------- aiPromptText ---------- */

export function aiPromptText(
  title: string,
  message: string,
  defaultValue?: string,
): Promise<string | null> {
  const id = `ai-prompt-text-${++modalCounter}`;
  const inputId = `${id}-input`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">${escapeHtml(message)}</p>
      <div class="modal-body">
        <input id="${inputId}" type="text" class="input" value="${escapeAttr(defaultValue ?? "")}" />
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  return new Promise<string | null>((resolve) => {
    const settle = (value: string | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const input = backdrop.querySelector<HTMLInputElement>(`#${inputId}`);
        const trimmed = input?.value.trim() ?? "";
        settle(trimmed || null);
      },
      onReject: () => settle(null),
    });
  });
}

export function aiPromptTextWithInputScope(
  title: string,
  message: string,
  defaultValue?: string,
): Promise<TextPromptWithInputScopeResult | null> {
  const id = `ai-prompt-text-scope-${++modalCounter}`;
  const inputId = `${id}-input`;
  const inputScopeId = `${id}-scope`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">${escapeHtml(message)}</p>
      <div class="modal-body">
        <input id="${inputId}" type="text" class="input" value="${escapeAttr(defaultValue ?? "")}" />
        ${createInputScopeField(inputScopeId)}
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  return new Promise<TextPromptWithInputScopeResult | null>((resolve) => {
    const settle = (value: TextPromptWithInputScopeResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const input = backdrop.querySelector<HTMLInputElement>(`#${inputId}`);
        const prompt = input?.value.trim() ?? "";
        settle(prompt
          ? {
              prompt,
              inputScope: readInputScope(backdrop, inputScopeId),
            }
          : null);
      },
      onReject: () => settle(null),
    });
  });
}

/* ---------- aiPromptSelect ---------- */

export function aiPromptSelect(
  title: string,
  message: string,
  options: Array<{ value: string; label: string }>,
): Promise<string | null> {
  const id = `ai-prompt-select-${++modalCounter}`;
  const selectId = `${id}-select`;

  const optionsHtml = options
    .map((opt) => `<option value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`)
    .join("");

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">${escapeHtml(message)}</p>
      <div class="modal-body">
        <select id="${selectId}" class="input">${optionsHtml}</select>
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  return new Promise<string | null>((resolve) => {
    const settle = (value: string | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const select = backdrop.querySelector<HTMLSelectElement>(`#${selectId}`);
        settle(select?.value ?? null);
      },
      onReject: () => settle(null),
    });
  });
}

/* ---------- aiPromptRemoveBackground ---------- */

export function aiPromptRemoveBackground(): Promise<RemoveBackgroundResult | null> {
  const id = `ai-prompt-rmbg-${++modalCounter}`;
  const selectId = `${id}-select`;
  const descriptionId = `${id}-description`;
  const descriptionBlockId = `${id}-description-block`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>AI: Remove Background</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">Choose background removal output mode</p>
      <div class="modal-body">
        <label for="${selectId}">Output mode</label>
        <select id="${selectId}" class="input">
          <option value="mask">Mask</option>
          <option value="transparent">Transparent</option>
          <option value="replace">Replace</option>
        </select>
        <div id="${descriptionBlockId}" hidden>
          <label for="${descriptionId}">Replacement description</label>
          <input id="${descriptionId}" type="text" class="input" placeholder="soft studio backdrop" value="" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  const selectEl = backdrop.querySelector<HTMLSelectElement>(`#${selectId}`)!;
  const descriptionBlock = backdrop.querySelector<HTMLElement>(`#${descriptionBlockId}`)!;

  selectEl.addEventListener("change", () => {
    if (selectEl.value === "replace") {
      descriptionBlock.removeAttribute("hidden");
    } else {
      descriptionBlock.setAttribute("hidden", "");
    }
  });

  return new Promise<RemoveBackgroundResult | null>((resolve) => {
    const settle = (value: RemoveBackgroundResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const mode = selectEl.value as RemoveBackgroundResult["mode"];
        if (mode === "replace") {
          const descInput = backdrop.querySelector<HTMLInputElement>(`#${descriptionId}`);
          const description = descInput?.value.trim() || undefined;
          settle({ mode, description });
        } else {
          settle({ mode });
        }
      },
      onReject: () => settle(null),
    });
  });
}

export function aiPromptRemoveBackgroundWithInputScope(): Promise<ScopedRemoveBackgroundResult | null> {
  const id = `ai-prompt-rmbg-scope-${++modalCounter}`;
  const selectId = `${id}-select`;
  const descriptionId = `${id}-description`;
  const descriptionBlockId = `${id}-description-block`;
  const inputScopeId = `${id}-scope`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>AI: Remove Background</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">Choose background removal output mode</p>
      <div class="modal-body">
        <label for="${selectId}">Output mode</label>
        <select id="${selectId}" class="input">
          <option value="mask">Mask</option>
          <option value="transparent">Transparent</option>
          <option value="replace">Replace</option>
        </select>
        <div id="${descriptionBlockId}" hidden>
          <label for="${descriptionId}">Replacement description</label>
          <input id="${descriptionId}" type="text" class="input" placeholder="soft studio backdrop" value="" />
        </div>
        ${createInputScopeField(inputScopeId)}
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  const selectEl = backdrop.querySelector<HTMLSelectElement>(`#${selectId}`)!;
  const descriptionBlock = backdrop.querySelector<HTMLElement>(`#${descriptionBlockId}`)!;

  selectEl.addEventListener("change", () => {
    if (selectEl.value === "replace") {
      descriptionBlock.removeAttribute("hidden");
    } else {
      descriptionBlock.setAttribute("hidden", "");
    }
  });

  return new Promise<ScopedRemoveBackgroundResult | null>((resolve) => {
    const settle = (value: ScopedRemoveBackgroundResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const mode = selectEl.value as RemoveBackgroundResult["mode"];
        const inputScope = readInputScope(backdrop, inputScopeId);
        if (mode === "replace") {
          const descInput = backdrop.querySelector<HTMLInputElement>(`#${descriptionId}`);
          const description = descInput?.value.trim() || undefined;
          settle({ mode, description, inputScope });
        } else {
          settle({ mode, inputScope });
        }
      },
      onReject: () => settle(null),
    });
  });
}

/* ---------- aiPromptThumbnail ---------- */

export function aiPromptThumbnail(): Promise<ThumbnailPromptResult | null> {
  const id = `ai-prompt-thumbnail-${++modalCounter}`;
  const sizeId = `${id}-size`;
  const promptId = `${id}-prompt`;
  const textOverlayId = `${id}-text-overlay`;
  const textPositionId = `${id}-text-position`;
  const textPositionBlockId = `${id}-text-position-block`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>AI: Generate Thumbnail</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">Configure thumbnail generation</p>
      <div class="modal-body">
        <label for="${sizeId}">Size</label>
        <select id="${sizeId}" class="input">
          <option value="128x128">128\u00d7128 (Icon)</option>
          <option value="256x256">256\u00d7256 (Small)</option>
          <option value="512x512" selected>512\u00d7512 (Medium)</option>
          <option value="1280x720">1280\u00d7720 (YouTube)</option>
        </select>
        <label for="${promptId}">Description</label>
        <input id="${promptId}" type="text" class="input" value="psychedelic background, surprised face with open mouth" />
        <label for="${textOverlayId}">Text overlay</label>
        <input id="${textOverlayId}" type="text" class="input" placeholder="Corpos hate this trick" value="" />
        <div id="${textPositionBlockId}" hidden>
          <label for="${textPositionId}">Text position</label>
          <select id="${textPositionId}" class="input">
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom" selected>Bottom</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  const textOverlayEl = backdrop.querySelector<HTMLInputElement>(`#${textOverlayId}`)!;
  const textPositionBlock = backdrop.querySelector<HTMLElement>(`#${textPositionBlockId}`)!;

  textOverlayEl.addEventListener("input", () => {
    if (textOverlayEl.value.trim()) {
      textPositionBlock.removeAttribute("hidden");
    } else {
      textPositionBlock.setAttribute("hidden", "");
    }
  });

  return new Promise<ThumbnailPromptResult | null>((resolve) => {
    const settle = (value: ThumbnailPromptResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const sizeSelect = backdrop.querySelector<HTMLSelectElement>(`#${sizeId}`);
        const promptInput = backdrop.querySelector<HTMLInputElement>(`#${promptId}`);
        const prompt = promptInput?.value.trim() ?? "";
        if (!prompt) {
          settle(null);
          return;
        }
        const size = sizeSelect?.value ?? "512x512";
        const overlayText = textOverlayEl.value.trim();
        const result: ThumbnailPromptResult = { size, prompt };
        if (overlayText) {
          const positionSelect = backdrop.querySelector<HTMLSelectElement>(`#${textPositionId}`);
          result.textOverlay = overlayText;
          result.textPosition = positionSelect?.value ?? "bottom";
        }
        settle(result);
      },
      onReject: () => settle(null),
    });
  });
}

export function aiPromptThumbnailWithInputScope(): Promise<ScopedThumbnailPromptResult | null> {
  const id = `ai-prompt-thumbnail-scope-${++modalCounter}`;
  const sizeId = `${id}-size`;
  const promptId = `${id}-prompt`;
  const textOverlayId = `${id}-text-overlay`;
  const textPositionId = `${id}-text-position`;
  const textPositionBlockId = `${id}-text-position-block`;
  const inputScopeId = `${id}-scope`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>AI: Generate Thumbnail</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">Configure thumbnail generation</p>
      <div class="modal-body">
        <label for="${sizeId}">Size</label>
        <select id="${sizeId}" class="input">
          <option value="128x128">128\u00d7128 (Icon)</option>
          <option value="256x256">256\u00d7256 (Small)</option>
          <option value="512x512" selected>512\u00d7512 (Medium)</option>
          <option value="1280x720">1280\u00d7720 (YouTube)</option>
        </select>
        <label for="${promptId}">Description</label>
        <input id="${promptId}" type="text" class="input" value="psychedelic background, surprised face with open mouth" />
        <label for="${textOverlayId}">Text overlay</label>
        <input id="${textOverlayId}" type="text" class="input" placeholder="Corpos hate this trick" value="" />
        <div id="${textPositionBlockId}" hidden>
          <label for="${textPositionId}">Text position</label>
          <select id="${textPositionId}" class="input">
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom" selected>Bottom</option>
          </select>
        </div>
        ${createInputScopeField(inputScopeId)}
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  const textOverlayEl = backdrop.querySelector<HTMLInputElement>(`#${textOverlayId}`)!;
  const textPositionBlock = backdrop.querySelector<HTMLElement>(`#${textPositionBlockId}`)!;

  textOverlayEl.addEventListener("input", () => {
    if (textOverlayEl.value.trim()) {
      textPositionBlock.removeAttribute("hidden");
    } else {
      textPositionBlock.setAttribute("hidden", "");
    }
  });

  return new Promise<ScopedThumbnailPromptResult | null>((resolve) => {
    const settle = (value: ScopedThumbnailPromptResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const sizeSelect = backdrop.querySelector<HTMLSelectElement>(`#${sizeId}`);
        const promptInput = backdrop.querySelector<HTMLInputElement>(`#${promptId}`);
        const prompt = promptInput?.value.trim() ?? "";
        if (!prompt) {
          settle(null);
          return;
        }
        const size = sizeSelect?.value ?? "512x512";
        const overlayText = textOverlayEl.value.trim();
        const result: ScopedThumbnailPromptResult = {
          size,
          prompt,
          inputScope: readInputScope(backdrop, inputScopeId),
        };
        if (overlayText) {
          const positionSelect = backdrop.querySelector<HTMLSelectElement>(`#${textPositionId}`);
          result.textOverlay = overlayText;
          result.textPosition = positionSelect?.value ?? "bottom";
        }
        settle(result);
      },
      onReject: () => settle(null),
    });
  });
}

/* ---------- aiPromptConfirm ---------- */

export function aiPromptConfirm(
  title: string,
  message: string,
): Promise<boolean> {
  return confirmModal({ title, message });
}

/* ---------- aiPromptOutpaint ---------- */

export function aiPromptOutpaint(
  title: string,
  message: string,
): Promise<OutpaintResult | null> {
  const id = `ai-prompt-outpaint-${++modalCounter}`;
  const promptId = `${id}-prompt`;
  const topId = `${id}-top`;
  const rightId = `${id}-right`;
  const bottomId = `${id}-bottom`;
  const leftId = `${id}-left`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">${escapeHtml(message)}</p>
      <div class="modal-body">
        <label for="${promptId}">Prompt</label>
        <input id="${promptId}" type="text" class="input" value="continue the scene naturally" />
        <div class="outpaint-expansion-grid">
          <label for="${topId}">Top (px)</label>
          <input id="${topId}" type="number" class="input" value="128" min="0" />
          <label for="${rightId}">Right (px)</label>
          <input id="${rightId}" type="number" class="input" value="128" min="0" />
          <label for="${bottomId}">Bottom (px)</label>
          <input id="${bottomId}" type="number" class="input" value="128" min="0" />
          <label for="${leftId}">Left (px)</label>
          <input id="${leftId}" type="number" class="input" value="128" min="0" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  return new Promise<OutpaintResult | null>((resolve) => {
    const settle = (value: OutpaintResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const promptInput = backdrop.querySelector<HTMLInputElement>(`#${promptId}`);
        const prompt = promptInput?.value.trim() ?? "";
        if (!prompt) {
          settle(null);
          return;
        }
        const readNum = (elId: string): number =>
          Math.max(0, Number(backdrop.querySelector<HTMLInputElement>(`#${elId}`)?.value) || 0);

        settle({
          prompt,
          expansion: {
            top: readNum(topId),
            right: readNum(rightId),
            bottom: readNum(bottomId),
            left: readNum(leftId),
          },
        });
      },
      onReject: () => settle(null),
    });
  });
}

export function aiPromptOutpaintWithInputScope(
  title: string,
  message: string,
): Promise<ScopedOutpaintResult | null> {
  const id = `ai-prompt-outpaint-scope-${++modalCounter}`;
  const promptId = `${id}-prompt`;
  const topId = `${id}-top`;
  const rightId = `${id}-right`;
  const bottomId = `${id}-bottom`;
  const leftId = `${id}-left`;
  const inputScopeId = `${id}-scope`;

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">${escapeHtml(message)}</p>
      <div class="modal-body">
        <label for="${promptId}">Prompt</label>
        <input id="${promptId}" type="text" class="input" value="continue the scene naturally" />
        <div class="outpaint-expansion-grid">
          <label for="${topId}">Top (px)</label>
          <input id="${topId}" type="number" class="input" value="128" min="0" />
          <label for="${rightId}">Right (px)</label>
          <input id="${rightId}" type="number" class="input" value="128" min="0" />
          <label for="${bottomId}">Bottom (px)</label>
          <input id="${bottomId}" type="number" class="input" value="128" min="0" />
          <label for="${leftId}">Left (px)</label>
          <input id="${leftId}" type="number" class="input" value="128" min="0" />
        </div>
        ${createInputScopeField(inputScopeId)}
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Confirm</button>
      </div>
    </div>`,
  );

  return new Promise<ScopedOutpaintResult | null>((resolve) => {
    const settle = (value: ScopedOutpaintResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const promptInput = backdrop.querySelector<HTMLInputElement>(`#${promptId}`);
        const prompt = promptInput?.value.trim() ?? "";
        if (!prompt) {
          settle(null);
          return;
        }
        const readNum = (elId: string): number =>
          Math.max(0, Number(backdrop.querySelector<HTMLInputElement>(`#${elId}`)?.value) || 0);

        settle({
          prompt,
          inputScope: readInputScope(backdrop, inputScopeId),
          expansion: {
            top: readNum(topId),
            right: readNum(rightId),
            bottom: readNum(bottomId),
            left: readNum(leftId),
          },
        });
      },
      onReject: () => settle(null),
    });
  });
}

/* ---------- aiPromptEnhancement ---------- */

export interface EnhancementPromptResult {
  intensity: number;
  prompt?: string;
  referenceFiles?: FileList | null;
}

export interface EnhancementPromptModalOptions {
  showPrompt?: boolean;
  showReferenceImages?: boolean;
  defaultIntensity?: number;
  defaultPrompt?: string;
  promptLabel?: string;
  promptPlaceholder?: string;
  referenceHelpText?: string;
}

export function aiPromptEnhancement(
  title: string,
  message: string,
  options: EnhancementPromptModalOptions,
): Promise<EnhancementPromptResult | null> {
  const id = `ai-prompt-enhancement-${++modalCounter}`;
  const intensityId = `${id}-intensity`;
  const outputId = `${id}-output`;
  const promptId = `${id}-prompt`;
  const referenceId = `${id}-reference`;

  const defaultIntensity = options.defaultIntensity ?? 65;
  const promptHidden = options.showPrompt ? "" : " hidden";
  const referenceHidden = options.showReferenceImages ? "" : " hidden";
  const promptLabel = options.promptLabel ?? "Prompt";
  const promptPlaceholder = options.promptPlaceholder ?? "Describe the enhancement you want";
  const referenceHelpText = options.referenceHelpText ?? "Optional. These images provide visual style guidance only; your source image content stays the basis of the edit.";

  const backdrop = createBackdrop(
    id,
    `<div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn modal-close-btn modal-btn-reject" aria-label="Close">
          <i data-lucide="x"></i>
        </button>
      </div>
      <p class="modal-body-text">${escapeHtml(message)}</p>
      <div class="modal-body">
        <label class="field-block">
          <span>Intensity</span>
          <div class="range-with-value">
            <input id="${intensityId}" type="range" min="0" max="100" step="1" value="${defaultIntensity}" />
            <output id="${outputId}">${defaultIntensity}</output>
          </div>
        </label>
        <label class="field-block"${promptHidden}>
          <span>${escapeHtml(promptLabel)}</span>
          <input id="${promptId}" type="text" class="input" value="${escapeAttr(options.defaultPrompt ?? "")}" placeholder="${escapeAttr(promptPlaceholder)}" />
        </label>
        <label class="field-block"${referenceHidden}>
          <span>Reference images</span>
          <input id="${referenceId}" type="file" accept="image/png,image/jpeg,image/webp" multiple />
          <small class="field-help">${escapeHtml(referenceHelpText)}</small>
        </label>
      </div>
      <div class="modal-footer">
        <button class="secondary-btn modal-btn-reject">Cancel</button>
        <button class="modal-btn-accept">Apply</button>
      </div>
    </div>`,
  );

  const rangeInput = backdrop.querySelector<HTMLInputElement>(`#${intensityId}`);
  const outputEl = backdrop.querySelector<HTMLOutputElement>(`#${outputId}`);
  if (rangeInput && outputEl) {
    rangeInput.addEventListener("input", () => {
      outputEl.textContent = rangeInput.value;
    });
  }

  return new Promise<EnhancementPromptResult | null>((resolve) => {
    const settle = (value: EnhancementPromptResult | null) => {
      removeBackdrop(backdrop);
      resolve(value);
    };

    openModal({
      backdrop,
      onAccept: () => {
        const intensity = Number(rangeInput?.value ?? defaultIntensity) / 100;
        const promptInput = backdrop.querySelector<HTMLInputElement>(`#${promptId}`);
        const referenceInput = backdrop.querySelector<HTMLInputElement>(`#${referenceId}`);
        const trimmedPrompt = promptInput?.value.trim() || undefined;
        const referenceFiles = referenceInput?.files ?? null;
        settle({ intensity, prompt: trimmedPrompt, referenceFiles });
      },
      onReject: () => settle(null),
    });
  });
}

/* ---------- escaping ---------- */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
