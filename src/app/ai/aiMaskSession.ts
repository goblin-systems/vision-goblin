import { applyIcons } from "@goblin-systems/goblin-design-system";
import { createMaskCanvas, isMaskEmpty, type SelectionMode } from "../../editor/selection";
import type { DocumentState } from "../../editor/types";
import type { ToolName } from "../../settings";
import type { AiGuideMode, AiInputScope } from "./types";

export type AiMaskChannel = "caster" | "surface";
export type ShadowLightDirection = "auto" | "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left" | "top-left";

export interface AiMaskSessionResult {
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

export interface AiMaskChannelDefinition {
  key: AiMaskChannel;
  label: string;
  color: string;
  outlineColor: string;
  validationMessage: string;
  required?: boolean;
  visibleInUi?: boolean;
}

export interface AiMaskExtraControlRenderArgs {
  defaults: AiMaskSessionDefaults;
}

export interface AiMaskExtraControlBindArgs {
  panel: HTMLElement;
  getSession: () => AiMaskSessionState | null;
}

export interface AiMaskExtraControls {
  render?: (args: AiMaskExtraControlRenderArgs) => string;
  bind?: (args: AiMaskExtraControlBindArgs) => void;
}

export interface AiMaskSessionDefaults {
  guideMode: AiGuideMode;
  intensity: number;
  lightDirection: ShadowLightDirection;
  inputScope: AiInputScope;
}

export interface AiMaskSessionConfig {
  guideMode: AiGuideMode;
  title: string;
  description: string;
  applyLabel: string;
  startToastMessage: string;
  readyToastMessage: string;
  cancelToastMessage: string;
  guideHint: string;
  channels: Record<AiMaskChannel, AiMaskChannelDefinition>;
  initialChannel?: AiMaskChannel;
  visibleChannels?: AiMaskChannel[];
  defaults?: Partial<AiMaskSessionDefaults>;
  extraControls?: AiMaskExtraControls;
  /** Which tools are available in the session tool picker. Defaults to ["brush", "eraser"]. */
  allowedTools?: ToolName[];
}

interface AiMaskSessionState extends AiMaskSessionResult {
  activeChannel: AiMaskChannel;
  previousTool: ToolName | null;
  resolve: ((value: AiMaskSessionResult | null) => void) | null;
  panel: HTMLElement;
  channelButtons: Partial<Record<AiMaskChannel, HTMLButtonElement>>;
  intensityOutput: HTMLOutputElement | null;
  directionSelect: HTMLSelectElement | null;
  inputScopeSelect: HTMLSelectElement | null;
  config: AiMaskSessionConfig;
  allowedTools: ToolName[];
}

export interface AiMaskSessionControllerDeps {
  mountRoot: HTMLElement;
  getActiveTool: () => ToolName;
  setActiveTool: (tool: ToolName) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  getSelectionMode: () => SelectionMode;
  renderCanvas: () => void;
  renderEditorState: () => void;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

export interface AiMaskSessionController {
  start(doc: DocumentState, config?: AiMaskSessionConfig): Promise<AiMaskSessionResult | null>;
  isActive(): boolean;
  getState(): AiMaskSessionResult | null;
  getActiveChannelCanvas(): HTMLCanvasElement | null;
  getPaintTarget(): MaskPaintTarget | null;
  getMaskOverlays(): CanvasMaskOverlay[];
  cancel(): void;
  complete(): AiMaskSessionResult | null;
  /** Sync the tool picker and selection mode UI with external state changes (e.g. keyboard shortcut tool switches). */
  syncToolState(): void;
}

const AI_LIGHT_DIRECTIONS: Array<{ value: ShadowLightDirection; label: string }> = [
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

const DEFAULT_MASK_CHANNELS: Record<AiMaskChannel, AiMaskChannelDefinition> = {
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

const DEFAULT_SESSION_DEFAULTS: AiMaskSessionDefaults = {
  guideMode: "shadow-add",
  intensity: 50,
  lightDirection: "auto",
  inputScope: "visible-content",
};

const DEFAULT_ALLOWED_TOOLS: ToolName[] = ["brush", "eraser"];

const TOOL_ICON_MAP: Partial<Record<ToolName, string>> = {
  brush: "paintbrush",
  eraser: "eraser",
  marquee: "square-dashed",
  lasso: "lasso",
  "polygon-lasso": "pentagon",
  "magic-wand": "wand-sparkles",
};

const SELECTION_TOOLS: ToolName[] = ["marquee", "lasso", "polygon-lasso", "magic-wand"];

const SELECTION_MODES: Array<{ mode: SelectionMode; icon: string; label: string }> = [
  { mode: "replace", icon: "replace", label: "Replace" },
  { mode: "add", icon: "plus", label: "Add" },
  { mode: "subtract", icon: "minus", label: "Subtract" },
  { mode: "intersect", icon: "combine", label: "∩" },
];

function resolveAllowedTools(config: AiMaskSessionConfig): ToolName[] {
  return config.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
}

function hasSelectionTools(allowedTools: ToolName[]): boolean {
  return allowedTools.some((t) => SELECTION_TOOLS.includes(t));
}

export const DEFAULT_ADD_SHADOW_SESSION_CONFIG: AiMaskSessionConfig = {
  guideMode: "shadow-add",
  title: "AI: Add Shadow",
  description: "Set the light, then paint both guides manually: red for the shadow caster and black for the landing surface.",
  applyLabel: "Apply Shadow",
  startToastMessage: "Paint both guides manually: red for the caster, black for the landing surface.",
  readyToastMessage: "Shadow guides ready.",
  cancelToastMessage: "Shadow guide cancelled.",
  guideHint: "Both guides start empty. Use Brush to add and Eraser to subtract.",
  channels: DEFAULT_MASK_CHANNELS,
  defaults: DEFAULT_SESSION_DEFAULTS,
  extraControls: {
    render: ({ defaults }) => {
      const directionOptionsHtml = AI_LIGHT_DIRECTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.lightDirection ? " selected" : ""}>${opt.label}</option>`)
        .join("");
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block">
          <span>Intensity</span>
          <div class="range-with-value">
            <input type="range" min="0" max="100" step="1" value="${defaults.intensity}" data-ai-mask-intensity />
            <output data-ai-mask-intensity-output>${defaults.intensity}</output>
          </div>
        </label>
        <label class="field-block" for="ai-mask-direction">
          <span>Light direction</span>
          <select id="ai-mask-direction" class="input" data-ai-mask-direction>${directionOptionsHtml}</select>
        </label>
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const intensityInput = panel.querySelector<HTMLInputElement>('input[data-ai-mask-intensity]');
      const intensityOutput = panel.querySelector<HTMLOutputElement>('output[data-ai-mask-intensity-output]');
      const directionSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-direction]');
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

      intensityInput?.addEventListener("input", () => {
        const session = getSession();
        if (!session || !intensityOutput) {
          return;
        }
        session.intensity = Number(intensityInput.value || DEFAULT_SESSION_DEFAULTS.intensity);
        intensityOutput.textContent = String(session.intensity);
      });
      directionSelect?.addEventListener("change", () => {
        const session = getSession();
        if (!session) {
          return;
        }
        session.lightDirection = (directionSelect.value || DEFAULT_SESSION_DEFAULTS.lightDirection) as ShadowLightDirection;
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

export const DEFAULT_REMOVE_SHADOW_SESSION_CONFIG: AiMaskSessionConfig = {
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
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Shadow area (black)",
      validationMessage: "Paint the existing shadow area in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
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
            <input type="range" min="0" max="100" step="1" value="${defaults.intensity}" data-ai-mask-intensity />
            <output data-ai-mask-intensity-output>${defaults.intensity}</output>
          </div>
        </label>
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const intensityInput = panel.querySelector<HTMLInputElement>('input[data-ai-mask-intensity]');
      const intensityOutput = panel.querySelector<HTMLOutputElement>('output[data-ai-mask-intensity-output]');
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_ADD_REFLECTION_SESSION_CONFIG: AiMaskSessionConfig = {
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
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Source / glare cause (red)",
      validationMessage: "Paint the source object or bright glare cause in red before applying.",
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Reflection target (black)",
      validationMessage: "Paint the target reflection or glare region in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "reflection-add",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_REMOVE_REFLECTION_SESSION_CONFIG: AiMaskSessionConfig = {
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
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Reflection / glare area (black)",
      validationMessage: "Paint the reflection or glare region in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "reflection-remove",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_MOVE_OBJECT_SESSION_CONFIG: AiMaskSessionConfig = {
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
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Object to move (red)",
      validationMessage: "Paint the object to move in red before applying.",
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Destination (black)",
      validationMessage: "Paint one destination area in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "move-object",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_CLONE_OBJECT_SESSION_CONFIG: AiMaskSessionConfig = {
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
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Object to clone (red)",
      validationMessage: "Paint the object to clone in red before applying.",
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Clone destinations (black)",
      validationMessage: "Paint one or more destination areas in black before applying.",
    },
  },
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "clone-object",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_INPAINT_SESSION_CONFIG: AiMaskSessionConfig = {
  guideMode: "inpaint",
  title: "AI: Inpaint Selection",
  description: "Paint or select the area to inpaint, then describe the replacement.",
  applyLabel: "Continue",
  startToastMessage: "Paint or select the area to inpaint.",
  readyToastMessage: "Inpaint mask ready.",
  cancelToastMessage: "Inpaint cancelled.",
  guideHint: "Use any mask tool to mark the area to inpaint. Use Brush to add and Eraser to subtract.",
  initialChannel: "surface",
  visibleChannels: ["surface"],
  channels: {
    caster: {
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Mask area",
      validationMessage: "Paint or select the area to inpaint before continuing.",
    },
  },
  allowedTools: ["brush", "eraser", "marquee", "lasso", "polygon-lasso", "magic-wand"],
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "inpaint",
    inputScope: "visible-content",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_REMOVE_OBJECT_SESSION_CONFIG: AiMaskSessionConfig = {
  guideMode: "remove-object",
  title: "AI: Remove Object",
  description: "Paint or select the object to remove.",
  applyLabel: "Remove",
  startToastMessage: "Paint or select the object to remove.",
  readyToastMessage: "Remove object mask ready.",
  cancelToastMessage: "Remove object cancelled.",
  guideHint: "Use any mask tool to mark the object to remove. Use Brush to add and Eraser to subtract.",
  initialChannel: "surface",
  visibleChannels: ["surface"],
  channels: {
    caster: {
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Object to remove",
      validationMessage: "Paint or select the object to remove before continuing.",
    },
  },
  allowedTools: ["brush", "eraser", "marquee", "lasso", "polygon-lasso", "magic-wand"],
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "remove-object",
    inputScope: "visible-content",
  },
  extraControls: {
    render: ({ defaults }) => {
      const inputScopeOptionsHtml = AI_INPUT_SCOPE_OPTIONS
        .map((opt) => `<option value="${opt.value}"${opt.value === defaults.inputScope ? " selected" : ""}>${opt.label}</option>`)
        .join("");

      return `
        <label class="field-block" for="ai-mask-input-scope">
          <span>Input scope</span>
          <select id="ai-mask-input-scope" class="input" data-ai-mask-input-scope>${inputScopeOptionsHtml}</select>
        </label>
      `;
    },
    bind: ({ panel, getSession }) => {
      const inputScopeSelect = panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]');

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

export const DEFAULT_REPLACE_TEXT_SESSION_CONFIG: AiMaskSessionConfig = {
  guideMode: "replace-text",
  title: "AI: Replace Raster Text",
  description: "Paint the text region to replace, or continue to use the full layer.",
  applyLabel: "Continue",
  startToastMessage: "Paint the text region to replace, or continue to use the full layer.",
  readyToastMessage: "Text region mask ready.",
  cancelToastMessage: "Replace text cancelled.",
  guideHint: "Paint the text area, or skip to process the full layer. Use Brush to add and Eraser to subtract. Best results with horizontal printed text; handwriting, curved, and decorative text may not reconstruct accurately.",
  initialChannel: "surface",
  visibleChannels: ["surface"],
  channels: {
    caster: {
      ...DEFAULT_MASK_CHANNELS.caster,
      label: "Optional context (red)",
      validationMessage: "",
      required: false,
      visibleInUi: false,
    },
    surface: {
      ...DEFAULT_MASK_CHANNELS.surface,
      label: "Text region",
      validationMessage: "",
      required: false,
    },
  },
  allowedTools: ["brush", "eraser", "marquee", "lasso", "polygon-lasso", "magic-wand"],
  defaults: {
    ...DEFAULT_SESSION_DEFAULTS,
    guideMode: "replace-text",
    inputScope: "visible-content",
  },
};

function resolveConfig(config?: AiMaskSessionConfig): AiMaskSessionConfig {
  if (!config) {
    return DEFAULT_ADD_SHADOW_SESSION_CONFIG;
  }
  return {
    ...DEFAULT_ADD_SHADOW_SESSION_CONFIG,
    ...config,
    channels: {
      caster: { ...DEFAULT_ADD_SHADOW_SESSION_CONFIG.channels.caster, ...config.channels.caster },
      surface: { ...DEFAULT_ADD_SHADOW_SESSION_CONFIG.channels.surface, ...config.channels.surface },
    },
    visibleChannels: config.visibleChannels
      ?? (["caster", "surface"] as AiMaskChannel[]).filter((channel) => config.channels[channel].visibleInUi !== false),
    defaults: {
      ...DEFAULT_SESSION_DEFAULTS,
      ...config.defaults,
      guideMode: config.guideMode,
    },
  };
}

function getVisibleChannels(config: AiMaskSessionConfig): AiMaskChannel[] {
  const configuredChannels = config.visibleChannels
    ?? (["caster", "surface"] as AiMaskChannel[]).filter((channel) => config.channels[channel].visibleInUi !== false);
  return configuredChannels.length > 0 ? configuredChannels : ["caster", "surface"];
}

export function createAiMaskSessionController(
  deps: AiMaskSessionControllerDeps,
): AiMaskSessionController {
  let session: AiMaskSessionState | null = null;

  function isActive() {
    return !!session;
  }

  function getState(): AiMaskSessionResult | null {
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

  function getActiveChannelCanvas(): HTMLCanvasElement | null {
    if (!session) return null;
    return session.activeChannel === "caster" ? session.casterMask : session.surfaceMask;
  }

  function updateChannelButtons() {
    if (!session) {
      return;
    }
    const activeSession = session;
    (Object.keys(activeSession.channelButtons) as AiMaskChannel[]).forEach((channel) => {
      activeSession.channelButtons[channel]?.classList.toggle("is-active", activeSession.activeChannel === channel);
    });
  }

  function setActiveChannel(channel: AiMaskChannel) {
    if (!session || session.activeChannel === channel) {
      return;
    }
    session.activeChannel = channel;
    updateChannelButtons();
    deps.renderCanvas();
  }

  function restoreTool(activeSession: AiMaskSessionState) {
    if (activeSession.previousTool) {
      deps.setActiveTool(activeSession.previousTool);
    }
  }

  function closeSession(result: AiMaskSessionResult | null, toastMessage?: string) {
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
    closeSession(null, session?.config.cancelToastMessage ?? DEFAULT_ADD_SHADOW_SESSION_CONFIG.cancelToastMessage);
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

  function createPanel(config: AiMaskSessionConfig, defaults: AiMaskSessionDefaults) {
    const extraControlsHtml = config.extraControls?.render?.({ defaults }) ?? "";
    const visibleChannels = getVisibleChannels(config);
    const channelButtonsHtml = visibleChannels
      .map((channel) => `<button type="button" class="secondary-btn" data-ai-mask-channel="${channel}">${config.channels[channel].label}</button>`)
      .join("");

    const allowedTools = resolveAllowedTools(config);
    const showToolPicker = allowedTools.length > 2;
    const showSelectionMode = hasSelectionTools(allowedTools);

    const toolPickerHtml = showToolPicker
      ? `<div class="ai-mask-panel__tools" data-ai-mask-tools>
          <span>Mask tools</span>
          <div class="ai-mask-panel__tool-buttons">
            ${allowedTools.map((tool) => {
              const icon = TOOL_ICON_MAP[tool] ?? "circle";
              return `<button type="button" class="icon-btn" data-ai-mask-tool="${tool}" aria-label="${tool}" title="${tool}"><i data-lucide="${icon}"></i></button>`;
            }).join("")}
          </div>
        </div>`
      : "";

    const selectionModeHtml = showSelectionMode
      ? `<div class="ai-mask-panel__mode" data-ai-mask-modes>
          <span>Selection mode</span>
          <div class="ai-mask-panel__mode-buttons">
            ${SELECTION_MODES.map((sm) => {
              const hasIcon = sm.icon === "plus" || sm.icon === "minus" || sm.icon === "replace" || sm.icon === "combine";
              const content = hasIcon
                ? `<i data-lucide="${sm.icon}"></i>`
                : `<span>${sm.label}</span>`;
              return `<button type="button" class="secondary-btn slim-btn" data-ai-mask-selection-mode="${sm.mode}" aria-label="${sm.label}" title="${sm.label}">${content}</button>`;
            }).join("")}
          </div>
        </div>`
      : "";

    const panel = document.createElement("section");
    panel.className = "ai-mask-panel";
    panel.setAttribute("data-ai-mask-session", "");
    panel.innerHTML = `
      <div class="modal-card ai-mask-panel__card">
        <div class="modal-header">
          <h3>${config.title}</h3>
          <button class="icon-btn modal-close-btn" type="button" data-ai-mask-cancel aria-label="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
        <p class="modal-body-text">${config.description}</p>
        <div class="modal-body ai-mask-panel__body">
          ${toolPickerHtml}
          ${selectionModeHtml}
          ${extraControlsHtml}
          <div class="field-block ai-mask-panel__channels-block">
            <span>Guide channel</span>
            <div class="ai-mask-panel__channels">
              ${channelButtonsHtml}
            </div>
          </div>
          <p class="ai-mask-panel__hint">${config.guideHint}</p>
        </div>
        <div class="modal-footer ai-mask-panel__actions">
          <button type="button" class="secondary-btn" data-ai-mask-cancel>Cancel</button>
          <button type="button" data-ai-mask-complete>${config.applyLabel}</button>
        </div>
      </div>
    `;
    deps.mountRoot.hidden = false;
    deps.mountRoot.replaceChildren(panel);
    applyIcons();
    return panel;
  }

  function updateToolButtons() {
    if (!session) return;
    const activeTool = deps.getActiveTool();
    session.panel.querySelectorAll<HTMLButtonElement>("[data-ai-mask-tool]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-ai-mask-tool") === activeTool);
    });
  }

  function updateSelectionModeButtons() {
    if (!session) return;
    const currentMode = deps.getSelectionMode();
    session.panel.querySelectorAll<HTMLButtonElement>("[data-ai-mask-selection-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-ai-mask-selection-mode") === currentMode);
    });
  }

  function syncToolState() {
    updateToolButtons();
    updateSelectionModeButtons();
  }

  async function start(doc: DocumentState, config?: AiMaskSessionConfig) {
    if (session) {
      closeSession(null);
    }

    const resolvedConfig = resolveConfig(config);
    const visibleChannels = getVisibleChannels(resolvedConfig);
    const defaults: AiMaskSessionDefaults = {
      ...DEFAULT_SESSION_DEFAULTS,
      ...resolvedConfig.defaults,
      guideMode: resolvedConfig.guideMode,
    };

    const casterMask = createMaskCanvas(doc.width, doc.height);
    const surfaceMask = createMaskCanvas(doc.width, doc.height);

    const panel = createPanel(resolvedConfig, defaults);
    const channelButtons: Partial<Record<AiMaskChannel, HTMLButtonElement>> = {};
    visibleChannels.forEach((channel) => {
      const button = panel.querySelector<HTMLButtonElement>(`button[data-ai-mask-channel="${channel}"]`);
      if (button) {
        channelButtons[channel] = button;
      }
    });

    const allowedTools = resolveAllowedTools(resolvedConfig);
    const previousTool = deps.getActiveTool();
    const needsToolSwitch = !allowedTools.includes(previousTool);
    if (needsToolSwitch) {
      deps.setActiveTool(allowedTools[0]);
    }

    const promise = new Promise<AiMaskSessionResult | null>((resolve) => {
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
        previousTool: needsToolSwitch ? previousTool : null,
        resolve,
        panel,
        channelButtons,
        intensityOutput: panel.querySelector<HTMLOutputElement>('output[data-ai-mask-intensity-output]'),
        directionSelect: panel.querySelector<HTMLSelectElement>('select[data-ai-mask-direction]'),
        inputScopeSelect: panel.querySelector<HTMLSelectElement>('select[data-ai-mask-input-scope]'),
        config: resolvedConfig,
        allowedTools,
      };
    });

    channelButtons.caster?.addEventListener("click", () => setActiveChannel("caster"));
    channelButtons.surface?.addEventListener("click", () => setActiveChannel("surface"));
    panel.querySelectorAll<HTMLElement>("[data-ai-mask-cancel]").forEach((button) => {
      button.addEventListener("click", () => cancel());
    });
    panel.querySelector<HTMLElement>("[data-ai-mask-complete]")?.addEventListener("click", () => complete());

    // Tool picker buttons
    panel.querySelectorAll<HTMLButtonElement>("[data-ai-mask-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const toolName = btn.getAttribute("data-ai-mask-tool") as ToolName;
        if (toolName) {
          deps.setActiveTool(toolName);
          updateToolButtons();
        }
      });
    });

    // Selection mode buttons
    panel.querySelectorAll<HTMLButtonElement>("[data-ai-mask-selection-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-ai-mask-selection-mode") as SelectionMode;
        if (mode) {
          deps.setSelectionMode(mode);
          updateSelectionModeButtons();
        }
      });
    });

    resolvedConfig.extraControls?.bind?.({
      panel,
      getSession: () => session,
    });

    updateChannelButtons();
    updateToolButtons();
    updateSelectionModeButtons();
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
      paintLabel: "Painted AI mask guide",
      logLabel: `AI mask ${session.activeChannel}`,
    };
  }

  function getMaskOverlays(): CanvasMaskOverlay[] {
    if (!session) {
      return [];
    }
    return (["surface", "caster"] as AiMaskChannel[]).map((channel) => ({
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
    getActiveChannelCanvas,
    getPaintTarget,
    getMaskOverlays,
    cancel,
    complete,
    syncToolState,
  };
}
