import { EFFECT_DEFAULTS } from "./documents";
import type { EffectType, LayerEffect, StylePreset } from "./types";

// ---------------------------------------------------------------------------
// Effect metadata — labels, UI field descriptors
// ---------------------------------------------------------------------------

export interface EffectFieldDescriptor {
  key: string;
  label: string;
  type: "color" | "number" | "range";
  min?: number;
  max?: number;
  step?: number;
  /** For range inputs: multiply stored value by this to get UI value (e.g. 100 for opacity 0-1 → 0-100) */
  uiScale?: number;
}

export interface EffectMeta {
  type: EffectType;
  label: string;
  fields: EffectFieldDescriptor[];
}

export const EFFECT_META: EffectMeta[] = [
  {
    type: "drop-shadow",
    label: "Drop Shadow",
    fields: [
      { key: "color", label: "Colour", type: "color" },
      { key: "blur", label: "Blur", type: "number", min: 0 },
      { key: "offsetX", label: "Offset X", type: "number" },
      { key: "offsetY", label: "Offset Y", type: "number" },
      { key: "opacity", label: "Opacity", type: "range", min: 0, max: 100, step: 5, uiScale: 100 },
    ],
  },
  {
    type: "inner-shadow",
    label: "Inner Shadow",
    fields: [
      { key: "color", label: "Colour", type: "color" },
      { key: "blur", label: "Blur", type: "number", min: 0 },
      { key: "offsetX", label: "Offset X", type: "number" },
      { key: "offsetY", label: "Offset Y", type: "number" },
      { key: "opacity", label: "Opacity", type: "range", min: 0, max: 100, step: 5, uiScale: 100 },
    ],
  },
  {
    type: "outer-glow",
    label: "Outer Glow",
    fields: [
      { key: "color", label: "Colour", type: "color" },
      { key: "blur", label: "Blur", type: "number", min: 0 },
      { key: "spread", label: "Spread", type: "number", min: 0 },
      { key: "opacity", label: "Opacity", type: "range", min: 0, max: 100, step: 5, uiScale: 100 },
    ],
  },
  {
    type: "outline",
    label: "Outline",
    fields: [
      { key: "color", label: "Colour", type: "color" },
      { key: "width", label: "Width", type: "number", min: 0 },
      { key: "opacity", label: "Opacity", type: "range", min: 0, max: 100, step: 5, uiScale: 100 },
    ],
  },
  {
    type: "color-overlay",
    label: "Colour Overlay",
    fields: [
      { key: "color", label: "Colour", type: "color" },
      { key: "opacity", label: "Opacity", type: "range", min: 0, max: 100, step: 5, uiScale: 100 },
    ],
  },
];

const META_BY_TYPE = new Map<EffectType, EffectMeta>(EFFECT_META.map((m) => [m.type, m]));
export function getEffectMeta(type: EffectType): EffectMeta | undefined {
  return META_BY_TYPE.get(type);
}

// ---------------------------------------------------------------------------
// Effect factory
// ---------------------------------------------------------------------------

/** Creates a new effect instance with defaults, enabled by default. */
export function createEffect(type: EffectType): LayerEffect {
  const base = EFFECT_DEFAULTS[type];
  if (!base) throw new Error(`Unknown effect type: ${type}`);
  return { ...base, enabled: true };
}

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

export const BUILT_IN_PRESETS: StylePreset[] = [
  {
    name: "Soft Shadow",
    builtIn: true,
    effects: [
      { type: "drop-shadow", color: "#000000", offsetX: 0, offsetY: 6, blur: 16, opacity: 0.3, enabled: true },
    ],
  },
  {
    name: "Hard Shadow",
    builtIn: true,
    effects: [
      { type: "drop-shadow", color: "#000000", offsetX: 4, offsetY: 4, blur: 0, opacity: 0.6, enabled: true },
    ],
  },
  {
    name: "Neon Glow",
    builtIn: true,
    effects: [
      { type: "outer-glow", color: "#00ffff", blur: 24, spread: 8, opacity: 0.8, enabled: true },
    ],
  },
  {
    name: "Inset",
    builtIn: true,
    effects: [
      { type: "inner-shadow", color: "#000000", offsetX: 0, offsetY: 4, blur: 8, opacity: 0.5, enabled: true },
    ],
  },
  {
    name: "Outlined",
    builtIn: true,
    effects: [
      { type: "outline", color: "#ffffff", width: 3, opacity: 1, enabled: true },
    ],
  },
  {
    name: "Glass Button",
    builtIn: true,
    effects: [
      { type: "drop-shadow", color: "#000000", offsetX: 0, offsetY: 4, blur: 12, opacity: 0.3, enabled: true },
      { type: "inner-shadow", color: "#ffffff", offsetX: 0, offsetY: -2, blur: 6, opacity: 0.25, enabled: true },
      { type: "color-overlay", color: "#ffffff", opacity: 0.1, enabled: true },
    ],
  },
];

/** Load custom presets from localStorage */
export function loadCustomPresets(): StylePreset[] {
  try {
    const raw = localStorage.getItem("vision-goblin-style-presets");
    if (!raw) return [];
    return JSON.parse(raw) as StylePreset[];
  } catch {
    return [];
  }
}

/** Save custom presets to localStorage */
export function saveCustomPresets(presets: StylePreset[]) {
  localStorage.setItem("vision-goblin-style-presets", JSON.stringify(presets));
}

/** Get all presets (built-in + custom) */
export function getAllPresets(): StylePreset[] {
  return [...BUILT_IN_PRESETS, ...loadCustomPresets()];
}

/** Apply a preset to a layer's effects (replaces effects with deep-copied preset effects) */
export function applyPreset(preset: StylePreset): LayerEffect[] {
  return preset.effects.map((e) => ({ ...e }));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Returns true if the layer has at least one enabled effect. */
export function hasEnabledEffects(effects?: LayerEffect[]): boolean {
  if (!effects) return false;
  return effects.some((e) => e.enabled);
}
