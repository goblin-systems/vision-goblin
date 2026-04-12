import { applyIcons } from "@goblin-systems/goblin-design-system";
import { createMaskCanvas, isMaskEmpty } from "../../editor/selection";
import type { DocumentState } from "../../editor/types";
import type { ToolName } from "../../settings";
import type { AiGuideMode, AiInputScope } from "./types";

export type ShadowGuideChannel = "caster" | "surface";
export type ShadowLightDirection = "auto" | "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left" | "top-left";

export interface ShadowGuideSessionResult {
  guideMode: AiGuideMode;
  intensity: number;
  lightDirection: ShadowLightDirection;
  inputScope: AiInputScope;
  casterMask: HTMLCanvasElement;
  surfaceMask: HTMLCanvasElement;
}

export interface MaskPaintTarget {
  canvas: HTMLCanvasElement;
  exclusiveCanvas?: HTMLCanvasElement;
  historyMode: "document" | "ephemeral";
  paintLabel: string;
  logLabel: string;
}

export interface CanvasMaskOverlay {
  canvas: HTMLCanvasElement;
  color: string;
  outlineColor: string;
  active: boolean;
}

export interface ShadowGuideChannelDefinition {
  key: ShadowGuideChannel;
  label: string;
  color: string;
  outlineColor: string;
  validationMessage: string;
  required?: boolean;
  visibleInUi?: boolean;
}

export interface ShadowGuideExtraControlRenderArgs {
  defaults: ShadowGuideSessionDefaults;
}

export interface ShadowGuideExtraControlBindArgs {
  panel: HTMLElement;
  getSession: () => ShadowGuideSessionState | null;
}

export interface ShadowGuideExtraControls {
  render?: (args: ShadowGuideExtraControlRenderArgs) => string;
  bind?: (args: ShadowGuideExtraControlBindArgs) => void;
}

export interface ShadowGuideSessionDefaults {
  guideMode: AiGuideMode;
  intensity: number;
  lightDirection: ShadowLightDirection;
  inputScope: AiInputScope;
}

export interface ShadowGuideSessionConfig {
  guideMode: AiGuideMode;
  title: string;
  description: string;
  applyLabel: string;
  startToastMessage: string;
  readyToastMessage: string;
  cancelToastMessage: string;
  guideHint: string;
  channels: Record<ShadowGuideChannel, ShadowGuideChannelDefinition>;
  initialChannel?: ShadowGuideChannel;
  visibleChannels?: ShadowGuideChannel[];
  defaults?: Partial<ShadowGuideSessionDefaults>;
  extraControls?: ShadowGuideExtraControls;
}

interface ShadowGuideSessionState extends ShadowGuideSessionResult {
  activeChannel: ShadowGuideChannel;
  previousTool: ToolName | null;
  resolve: ((value: ShadowGuideSessionResult | null) => void) | null;
  panel: HTMLElement;
  channelButtons: Partial<Record<ShadowGuideChannel, HTMLButtonElement>>;
  intensityOutput: HTMLOutputElement | null;
  directionSelect: HTMLSelectElement | null;
  inputScopeSelect: HTMLSelectElement | null;
  config: ShadowGuideSessionConfig;
}

export interface ShadowGuideSessionControllerDeps {
  mountRoot: HTMLElement;
  getActiveTool: () => ToolName;
  setActiveTool: (tool: ToolName) => void;
  renderCanvas: () => void;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

export interface ShadowGuideSessionController {
  start(doc: DocumentState, config?: ShadowGuideSessionConfig): Promise<ShadowGuideSessionResult | null>;
  isActive(): boolean;
  getState(): ShadowGuideSessionResult | null;
  getPaintTarget(): MaskPaintTarget | null;
  getMaskOverlays(): CanvasMaskOverlay[];
  cancel(): void;
  complete(): ShadowGuideSessionResult | null;
}

const SHADOW_LIGHT_DIRECTIONS: Array<{ value: ShadowLightDirection; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "top", label: "Top" },
  { value: "top-right", label: "Top-Right" },
  { value: "right", label: "Right" },
  { value: "bottom-right", label: "Bottom-Right" },
  { value: "bottom", label: "Bottom" },
  { value: "bottom-left", label: "Bottom-Left" },
  { value: "left", label: "Left" },
  { value: "top-left", label: "Top-Left" },
];

const AI_INPUT_SCOPE_OPTIONS: Array<{ value: AiInputScope; label: string }> = [
  { value: "selected-layers", label: "selected layers" },
  { value: "visible-content", label: "visible content" },
];

const DEFAULT_GUIDE_CHANNELS: Record<ShadowGuideChannel, ShadowGuideChannelDefinition> = {
  caster: {
    key: "caster",
    label: "Caster (red)",
    color: "rgba(255, 72, 72, 0.38)",
    outlineColor: "rgba(255, 170, 170, 0.95)",
    validationMessage: "Paint the shadow caster in red before applying.",
    required: true,
  },
  surface: {
    key: "surface",
    label: "Surface (black)",
    color: "rgba(20, 20, 20, 0.4)",
    outlineColor: "rgba(255, 255, 255, 0.92)",
    validationMessage: "Paint the shadow landing area before applying.",
    required: true,
  },
};

const DEFAULT_GUIDE_SESSION_DEFAULTS: ShadowGuideSessionDefaults = {
  guideMode: "shadow-add",
  intensity: 50,
  lightDirection: "auto",
  inputScope: "visible-content",
};

export const DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG: ShadowGuideSessionConfig = {
  guideMode: "shadow-add",
  title: "AI: Add Shadow",
  description: "Set the light, then paint both guides manually: red for the shadow caster and black for the landing surface.",
  applyLabel: "Apply Shadow",
  startToastMessage: "Paint both guides manually: red for the caster, black for the landing surface.",
  readyToastMessage: "Shadow guides ready.",
  cancelToastMessage: "Shadow guide cancelled.",
  guideHint: "Both guides start empty. Use Brush to add and Eraser to subtract.",
  channels: DEFAULT_GUIDE_CHANNELS,
  defaults: DEFAULT_GUIDE_SESSION_DEFAULTS,
  extraControls: {
    render: ({ defaults }) => {
      const directionOptionsHtml = SHADOW_LIGHT_DIRECTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.lightDirection ? " selected" : ""}>${opt.label}</option>`)
        .join("");
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block">
          <span>Intensity</span>
          <div class="range-with-value">
            <input type="range" min="0" max="100" step="1" value="${defaults.intensity}" data-shadow-guide-intensity />
            <output data-shadow-guide-intensity-output>${defaults.intensity}</output>
          </div>
        </label>
        <label class="field-block" for="shadow-guide-direction">
          <span>Light direction</span>
          <select id="shadow-guide-direction" class="input" data-shadow-guide-direction>${directionOptionsHtml}</select>
        </label>
        <label class="field-block" for="shadow-guide-input-scope">
          <span>Input scope</span>
          <select id="shadow-guide-input-scope" class="input" data-shadow-guide-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const intensityInput = panel.querySelector<HTMLInputElement>('input[data-shadow-guide-intensity]');
      const intensityOutput = panel.querySelector<HTMLOutputElement>('output[data-shadow-guide-intensity-output]');
      const directionSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-direction]');
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]');

      intensityInput?.addEventListener("input", () => {
        const session = getSession();
        if (!session || !intensityOutput) {
          return;
        }
        session.intensity = Number(intensityInput.value || DEFAULT_GUIDE_SESSION_DEFAULTS.intensity);
        intensityOutput.textContent = String(session.intensity);
      });
      directionSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.lightDirection = (directionSelect.value || DEFAULT_GUIDE_SESSION_DEFAULTS.lightDirection) as ShadowLightDirection;
      });
      inputScopeSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.inputScope = inputScopeSelect.value === "selected-layers"
          ? "selected-layers"
          : "visible-content";
      });
    },
  },
};

export const DEFAULT_REMOVE_SHADOW_GUIDE_SESSION_CONFIG: ShadowGuideSessionConfig = {
  guideMode: "shadow-remove",
  title: "AI: Remove Shadow",
  description: "Paint black over the existing shadow you want to reduce or remove.",
  applyLabel: "Remove Shadow",
  startToastMessage: "Paint black over the shadow to reduce or remove.",
  readyToastMessage: "Shadow removal guides ready.",
  cancelToastMessage: "Remove shadow cancelled.",
  guideHint: "Black marks the existing shadow area to lighten or remove. Use Brush to add and Eraser to subtract.",
  initialChannel: "surface",
  visibleChannels: ["surface"],
  channels: {
    caster: {
      ...DEFAULT_GUIDE_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_GUIDE_CHANNELS.surface,
      label: "Shadow area (black)",
      validationMessage: "Paint the existing shadow area in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_GUIDE_SESSION_DEFAULTS,
    guideMode: "shadow-remove",
    intensity: 75,
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block">
          <span>Shadow reduction</span>
          <div class="range-with-value">
            <input type="range" min="0" max="100" step="1" value="${defaults.intensity}" data-shadow-guide-intensity />
            <output data-shadow-guide-intensity-output>${defaults.intensity}</output>
          </div>
        </label>
        <label class="field-block" for="shadow-guide-input-scope">
          <span>Input scope</span>
          <select id="shadow-guide-input-scope" class="input" data-shadow-guide-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const intensityInput = panel.querySelector<HTMLInputElement>('input[data-shadow-guide-intensity]');
      const intensityOutput = panel.querySelector<HTMLOutputElement>('output[data-shadow-guide-intensity-output]');
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]');

      intensityInput?.addEventListener("input", () => {
        const session = getSession();
        if (!session || !intensityOutput) {
          return;
        }
        session.intensity = Number(intensityInput.value || 75);
        intensityOutput.textContent = String(session.intensity);
      });
      inputScopeSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.inputScope = inputScopeSelect.value === "selected-layers"
          ? "selected-layers"
          : "visible-content";
      });
    },
  },
};

export const DEFAULT_ADD_REFLECTION_GUIDE_SESSION_CONFIG: ShadowGuideSessionConfig = {
  guideMode: "reflection-add",
  title: "AI: Add Reflection",
  description: "Paint red over the bright source object or light cause of the reflection or glare, then paint black over the target region where the reflection or glare should appear.",
  applyLabel: "Add Reflection",
  startToastMessage: "Paint red over the bright source or glare cause, and black over the target reflection region.",
  readyToastMessage: "Reflection guides ready.",
  cancelToastMessage: "Add reflection cancelled.",
  guideHint: "Red marks the source object or bright cause of reflection or glare. Black marks the target region where the reflection or glare should appear. Use Brush to add and Eraser to subtract.",
  channels: {
    caster: {
      ...DEFAULT_GUIDE_CHANNELS.caster,
      label: "Source / glare cause (red)",
      validationMessage: "Paint the source object or bright glare cause in red before applying.",
    },
    surface: {
      ...DEFAULT_GUIDE_CHANNELS.surface,
      label: "Reflection target (black)",
      validationMessage: "Paint the target reflection or glare region in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_GUIDE_SESSION_DEFAULTS,
    guideMode: "reflection-add",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="shadow-guide-input-scope">
          <span>Input scope</span>
          <select id="shadow-guide-input-scope" class="input" data-shadow-guide-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]');

      inputScopeSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.inputScope = inputScopeSelect.value === "selected-layers"
          ? "selected-layers"
          : "visible-content";
      });
    },
  },
};

export const DEFAULT_REMOVE_REFLECTION_GUIDE_SESSION_CONFIG: ShadowGuideSessionConfig = {
  guideMode: "reflection-remove",
  title: "AI: Remove Reflection",
  description: "Paint black over the reflection or glare region to remove or reduce.",
  applyLabel: "Remove Reflection",
  startToastMessage: "Paint black over the reflection or glare to reduce or remove.",
  readyToastMessage: "Reflection removal guides ready.",
  cancelToastMessage: "Remove reflection cancelled.",
  guideHint: "Black marks the reflection or glare region to clean up. Use Brush to add and Eraser to subtract.",
  initialChannel: "surface",
  visibleChannels: ["surface"],
  channels: {
    caster: {
      ...DEFAULT_GUIDE_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_GUIDE_CHANNELS.surface,
      label: "Reflection / glare area (black)",
      validationMessage: "Paint the reflection or glare region in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_GUIDE_SESSION_DEFAULTS,
    guideMode: "reflection-remove",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="shadow-guide-input-scope">
          <span>Input scope</span>
          <select id="shadow-guide-input-scope" class="input" data-shadow-guide-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]');

      inputScopeSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.inputScope = inputScopeSelect.value === "selected-layers"
          ? "selected-layers"
          : "visible-content";
      });
    },
  },
};

export const DEFAULT_MOVE_OBJECT_GUIDE_SESSION_CONFIG: ShadowGuideSessionConfig = {
  guideMode: "move-object",
  title: "AI: Move Object",
  description: "Paint red over the original object to move, then paint black over the single destination area where it should appear.",
  applyLabel: "Move Object",
  startToastMessage: "Paint red over the object to move, and black over one destination area.",
  readyToastMessage: "Move object guides ready.",
  cancelToastMessage: "Move object cancelled.",
  guideHint: "Red marks the original object to move. Black marks one destination area only in v1. Use Brush to add and Eraser to subtract.",
  channels: {
    caster: {
      ...DEFAULT_GUIDE_CHANNELS.caster,
      label: "Object to move (red)",
      validationMessage: "Paint the object to move in red before applying.",
    },
    surface: {
      ...DEFAULT_GUIDE_CHANNELS.surface,
      label: "Destination (black)",
      validationMessage: "Paint one destination area in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_GUIDE_SESSION_DEFAULTS,
    guideMode: "move-object",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="shadow-guide-input-scope">
          <span>Input scope</span>
          <select id="shadow-guide-input-scope" class="input" data-shadow-guide-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]');

      inputScopeSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.inputScope = inputScopeSelect.value === "selected-layers"
          ? "selected-layers"
          : "visible-content";
      });
    },
  },
};

export const DEFAULT_CLONE_OBJECT_GUIDE_SESSION_CONFIG: ShadowGuideSessionConfig = {
  guideMode: "clone-object",
  title: "AI: Clone Object",
  description: "Paint red over the original object to duplicate, then paint black over one or more destination areas where new copies should appear.",
  applyLabel: "Clone Object",
  startToastMessage: "Paint red over the object to clone, and black over one or more destination areas.",
  readyToastMessage: "Clone object guides ready.",
  cancelToastMessage: "Clone object cancelled.",
  guideHint: "Red marks the original object to duplicate. Black marks one or more destination areas for new copies in v1. Use Brush to add and Eraser to subtract.",
  channels: {
    caster: {
      ...DEFAULT_GUIDE_CHANNELS.caster,
      label: "Object to clone (red)",
      validationMessage: "Paint the object to clone in red before applying.",
    },
    surface: {
      ...DEFAULT_GUIDE_CHANNELS.surface,
      label: "Clone destinations (black)",
      validationMessage: "Paint one or more destination areas in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_GUIDE_SESSION_DEFAULTS,
    guideMode: "clone-object",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="shadow-guide-input-scope">
          <span>Input scope</span>
          <select id="shadow-guide-input-scope" class="input" data-shadow-guide-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]');

      inputScopeSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.inputScope = inputScopeSelect.value === "selected-layers"
          ? "selected-layers"
          : "visible-content";
      });
    },
  },
};

function resolveConfig(config?: ShadowGuideSessionConfig): ShadowGuideSessionConfig {
  if (!config) {
    return DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG;
  }
  return {
    ...DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG,
    ...config,
    channels: {
      caster: { ...DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG.channels.caster, ...config.channels.caster },
      surface: { ...DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG.channels.surface, ...config.channels.surface },
    },
    visibleChannels: config.visibleChannels
      ?? (["caster", "surface"] as ShadowGuideChannel[]).filter((channel) => config.channels[channel].visibleInUi !== false),
    defaults: {
      ...DEFAULT_GUIDE_SESSION_DEFAULTS,
      ...config.defaults,
      guideMode: config.guideMode,
    },
  };
}

function getVisibleChannels(config: ShadowGuideSessionConfig): ShadowGuideChannel[] {
  const configuredChannels = config.visibleChannels
    ?? (["caster", "surface"] as ShadowGuideChannel[]).filter((channel) => config.channels[channel].visibleInUi !== false);
  return configuredChannels.length > 0 ? configuredChannels : ["caster", "surface"];
}

export function createShadowGuideSessionController(
  deps: ShadowGuideSessionControllerDeps,
): ShadowGuideSessionController {
  let session: ShadowGuideSessionState | null = null;

  function isActive() {
    return !!session;
  }

  function getState(): ShadowGuideSessionResult | null {
    if (!session) {
      return null;
    }
    return {
      guideMode: session.guideMode,
      intensity: session.intensity,
      lightDirection: session.lightDirection,
      inputScope: session.inputScope,
      casterMask: session.casterMask,
      surfaceMask: session.surfaceMask,
    };
  }

  function updateChannelButtons() {
    if (!session) {
      return;
    }
    const activeSession = session;
    (Object.keys(activeSession.channelButtons) as ShadowGuideChannel[]).forEach((channel) => {
      activeSession.channelButtons[channel]?.classList.toggle("is-active", activeSession.activeChannel === channel);
    });
  }

  function setActiveChannel(channel: ShadowGuideChannel) {
    if (!session || session.activeChannel === channel) {
      return;
    }
    session.activeChannel = channel;
    updateChannelButtons();
    deps.renderCanvas();
  }

  function restoreTool(activeSession: ShadowGuideSessionState) {
    if (activeSession.previousTool) {
      deps.setActiveTool(activeSession.previousTool);
    }
  }

  function closeSession(result: ShadowGuideSessionResult | null, toastMessage?: string) {
    const activeSession = session;
    if (!activeSession) {
      return result;
    }

    session = null;
    activeSession.panel.remove();
    deps.mountRoot.hidden = true;
    restoreTool(activeSession);
    deps.renderCanvas();
    if (toastMessage) {
      deps.showToast(toastMessage, result ? "success" : "info");
    }
    activeSession.resolve?.(result);
    return result;
  }

  function cancel() {
    closeSession(null, session?.config.cancelToastMessage ?? DEFAULT_ADD_SHADOW_GUIDE_SESSION_CONFIG.cancelToastMessage);
  }

  function complete() {
    if (!session) {
      return null;
    }
    if (session.config.channels.caster.required !== false && isMaskEmpty(session.casterMask)) {
      deps.showToast(session.config.channels.caster.validationMessage, "error");
      return null;
    }
    if (session.config.channels.surface.required !== false && isMaskEmpty(session.surfaceMask)) {
      deps.showToast(session.config.channels.surface.validationMessage, "error");
      return null;
    }
    return closeSession({
      guideMode: session.guideMode,
      intensity: session.intensity,
      lightDirection: session.lightDirection,
      inputScope: session.inputScope,
      casterMask: session.casterMask,
      surfaceMask: session.surfaceMask,
    }, session.config.readyToastMessage);
  }

  function createPanel(config: ShadowGuideSessionConfig, defaults: ShadowGuideSessionDefaults) {
    const extraControlsHtml = config.extraControls?.render?.({ defaults }) ?? "";
    const visibleChannels = getVisibleChannels(config);
    const channelButtonsHtml = visibleChannels
      .map((channel) => `<button type="button" class="secondary-btn" data-shadow-guide-channel="${channel}">${config.channels[channel].label}</button>`)
      .join("");

    const panel = document.createElement("section");
    panel.className = "shadow-guide-panel";
    panel.setAttribute("data-shadow-guide-session", "");
    panel.innerHTML = `
      <div class="modal-card shadow-guide-panel__card">
        <div class="modal-header">
          <h3>${config.title}</h3>
          <button class="icon-btn modal-close-btn" type="button" data-shadow-guide-cancel aria-label="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
        <p class="modal-body-text">${config.description}</p>
        <div class="modal-body shadow-guide-panel__body">
          ${extraControlsHtml}
          <div class="field-block shadow-guide-panel__channels-block">
            <span>Guide channel</span>
            <div class="shadow-guide-panel__channels">
              ${channelButtonsHtml}
            </div>
          </div>
          <p class="shadow-guide-panel__hint">${config.guideHint}</p>
        </div>
        <div class="modal-footer shadow-guide-panel__actions">
          <button type="button" class="secondary-btn" data-shadow-guide-cancel>Cancel</button>
          <button type="button" data-shadow-guide-complete>${config.applyLabel}</button>
        </div>
      </div>
    `;
    deps.mountRoot.hidden = false;
    deps.mountRoot.replaceChildren(panel);
    applyIcons();
    return panel;
  }

  async function start(doc: DocumentState, config?: ShadowGuideSessionConfig) {
    if (session) {
      closeSession(null);
    }

    const resolvedConfig = resolveConfig(config);
    const visibleChannels = getVisibleChannels(resolvedConfig);
    const defaults: ShadowGuideSessionDefaults = {
      ...DEFAULT_GUIDE_SESSION_DEFAULTS,
      ...resolvedConfig.defaults,
      guideMode: resolvedConfig.guideMode,
    };

    const casterMask = createMaskCanvas(doc.width, doc.height);
    const surfaceMask = createMaskCanvas(doc.width, doc.height);

    const panel = createPanel(resolvedConfig, defaults);
    const channelButtons: Partial<Record<ShadowGuideChannel, HTMLButtonElement>> = {};
    visibleChannels.forEach((channel) => {
      const button = panel.querySelector<HTMLButtonElement>(`button[data-shadow-guide-channel="${channel}"]`);
      if (button) {
        channelButtons[channel] = button;
      }
    });

    const previousTool = deps.getActiveTool();
    if (previousTool !== "brush" && previousTool !== "eraser") {
      deps.setActiveTool("brush");
    }

    const promise = new Promise<ShadowGuideSessionResult | null>((resolve) => {
      session = {
        guideMode: defaults.guideMode,
        casterMask,
        surfaceMask,
        intensity: defaults.intensity,
        lightDirection: defaults.lightDirection,
        inputScope: defaults.inputScope,
        activeChannel: visibleChannels.includes(resolvedConfig.initialChannel ?? "caster")
          ? (resolvedConfig.initialChannel ?? "caster")
          : visibleChannels[0],
        previousTool: previousTool !== "brush" && previousTool !== "eraser" ? previousTool : null,
        resolve,
        panel,
        channelButtons,
        intensityOutput: panel.querySelector<HTMLOutputElement>('output[data-shadow-guide-intensity-output]'),
        directionSelect: panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-direction]'),
        inputScopeSelect: panel.querySelector<HTMLSelectElement>('select[data-shadow-guide-input-scope]'),
        config: resolvedConfig,
      };
    });

    channelButtons.caster?.addEventListener("click", () => setActiveChannel("caster"));
    channelButtons.surface?.addEventListener("click", () => setActiveChannel("surface"));
    panel.querySelectorAll<HTMLElement>("[data-shadow-guide-cancel]").forEach((button) => {
      button.addEventListener("click", () => cancel());
    });
    panel.querySelector<HTMLElement>("[data-shadow-guide-complete]")?.addEventListener("click", () => complete());
    resolvedConfig.extraControls?.bind?.({
      panel,
      getSession: () => session,
    });

    updateChannelButtons();
    deps.renderCanvas();
    deps.showToast(resolvedConfig.startToastMessage, "info");
    return promise;
  }

  function getPaintTarget(): MaskPaintTarget | null {
    if (!session) {
      return null;
    }
    return {
      canvas: session.activeChannel === "caster" ? session.casterMask : session.surfaceMask,
      exclusiveCanvas: session.activeChannel === "caster" ? session.surfaceMask : session.casterMask,
      historyMode: "ephemeral",
      paintLabel: "Painted shadow guide",
      logLabel: `Shadow guide ${session.activeChannel}`,
    };
  }

  function getMaskOverlays(): CanvasMaskOverlay[] {
    if (!session) {
      return [];
    }
    return (["surface", "caster"] as ShadowGuideChannel[]).map((channel) => ({
      canvas: channel === "caster" ? session!.casterMask : session!.surfaceMask,
      color: session!.config.channels[channel].color,
      outlineColor: session!.config.channels[channel].outlineColor,
      active: session!.activeChannel === channel,
    }));
  }

  return {
    start,
    isActive,
    getState,
    getPaintTarget,
    getMaskOverlays,
    cancel,
    complete,
  };
}
