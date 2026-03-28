import { describe, expect, it } from "vitest";
import { normalizeEffects, EFFECT_DEFAULTS } from "./documents";
import {
  createEffect,
  BUILT_IN_PRESETS,
  applyPreset,
  hasEnabledEffects,
  getEffectMeta,
  EFFECT_META,
  getAllPresets,
} from "./layerStyles";
import type { EffectType, LayerEffect } from "./types";

describe("normalizeEffects (F2.3 rework)", () => {
  it("returns empty array when called with no args", () => {
    expect(normalizeEffects()).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeEffects([])).toEqual([]);
  });

  it("fills missing fields using per-type defaults", () => {
    const partial = [{ type: "drop-shadow", enabled: true }] as LayerEffect[];
    const result = normalizeEffects(partial);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("drop-shadow");
    expect(result[0].enabled).toBe(true);
    if (result[0].type === "drop-shadow") {
      expect(result[0].blur).toBe(12);
      expect(result[0].color).toBe("#000000");
    }
  });

  it("preserves all 5 effect types", () => {
    const effects: LayerEffect[] = [
      { type: "drop-shadow", color: "#ff0000", offsetX: 1, offsetY: 2, blur: 5, opacity: 0.5, enabled: true },
      { type: "inner-shadow", color: "#00ff00", offsetX: 0, offsetY: 0, blur: 10, opacity: 0.3, enabled: false },
      { type: "outer-glow", color: "#0000ff", blur: 20, spread: 5, opacity: 0.8, enabled: true },
      { type: "outline", color: "#ffffff", width: 3, opacity: 1, enabled: true },
      { type: "color-overlay", color: "#ffff00", opacity: 0.4, enabled: false },
    ];
    const result = normalizeEffects(effects);
    expect(result).toHaveLength(5);
    expect(result.map((e) => e.type)).toEqual(["drop-shadow", "inner-shadow", "outer-glow", "outline", "color-overlay"]);
  });

  it("drops unknown effect types", () => {
    const effects = [
      { type: "drop-shadow", color: "#000", offsetX: 0, offsetY: 0, blur: 4, opacity: 0.5, enabled: true },
      { type: "unknown-effect" as any, foo: "bar", enabled: true },
    ] as LayerEffect[];
    const result = normalizeEffects(effects);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("drop-shadow");
  });

  it("backward-compatible with old 2-item [shadow, outline] saves", () => {
    const oldEffects: LayerEffect[] = [
      { type: "drop-shadow", color: "#000000", offsetX: 0, offsetY: 0, blur: 12, opacity: 0.35, enabled: false },
      { type: "outline", color: "#ffffff", width: 2, opacity: 1, enabled: false },
    ];
    const result = normalizeEffects(oldEffects);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("drop-shadow");
    expect(result[1].type).toBe("outline");
  });

  it("supports multiple effects of the same type", () => {
    const effects: LayerEffect[] = [
      { type: "drop-shadow", color: "#000000", offsetX: 0, offsetY: 4, blur: 12, opacity: 0.35, enabled: true },
      { type: "drop-shadow", color: "#ff0000", offsetX: 2, offsetY: 2, blur: 4, opacity: 0.5, enabled: true },
    ];
    const result = normalizeEffects(effects);
    expect(result).toHaveLength(2);
    expect(result[0].color).toBe("#000000");
    expect(result[1].color).toBe("#ff0000");
  });
});

describe("EFFECT_DEFAULTS", () => {
  it("has defaults for all 5 effect types", () => {
    const types: EffectType[] = ["drop-shadow", "inner-shadow", "outer-glow", "outline", "color-overlay"];
    for (const type of types) {
      expect(EFFECT_DEFAULTS[type]).toBeDefined();
      expect(EFFECT_DEFAULTS[type].type).toBe(type);
      expect(EFFECT_DEFAULTS[type].enabled).toBe(false);
    }
  });
});

describe("createEffect", () => {
  it("creates a new effect with defaults, enabled by default", () => {
    const effect = createEffect("drop-shadow");
    expect(effect.type).toBe("drop-shadow");
    expect(effect.enabled).toBe(true);
    if (effect.type === "drop-shadow") {
      expect(effect.blur).toBe(12);
    }
  });

  it("creates each effect type", () => {
    const types: EffectType[] = ["drop-shadow", "inner-shadow", "outer-glow", "outline", "color-overlay"];
    for (const type of types) {
      const effect = createEffect(type);
      expect(effect.type).toBe(type);
      expect(effect.enabled).toBe(true);
    }
  });

  it("throws for unknown type", () => {
    expect(() => createEffect("bogus" as EffectType)).toThrow("Unknown effect type");
  });
});

describe("EFFECT_META", () => {
  it("has metadata for all 5 effect types", () => {
    expect(EFFECT_META).toHaveLength(5);
    const types = EFFECT_META.map((m) => m.type);
    expect(types).toContain("drop-shadow");
    expect(types).toContain("inner-shadow");
    expect(types).toContain("outer-glow");
    expect(types).toContain("outline");
    expect(types).toContain("color-overlay");
  });

  it("each meta has a label and fields", () => {
    for (const meta of EFFECT_META) {
      expect(meta.label).toBeTruthy();
      expect(meta.fields.length).toBeGreaterThan(0);
      for (const field of meta.fields) {
        expect(field.key).toBeTruthy();
        expect(field.label).toBeTruthy();
        expect(["color", "number", "range"]).toContain(field.type);
      }
    }
  });
});

describe("getEffectMeta", () => {
  it("returns meta for known types", () => {
    expect(getEffectMeta("drop-shadow")?.label).toBe("Drop Shadow");
    expect(getEffectMeta("color-overlay")?.label).toBe("Colour Overlay");
  });

  it("returns undefined for unknown types", () => {
    expect(getEffectMeta("bogus" as EffectType)).toBeUndefined();
  });
});

describe("style presets", () => {
  it("has 6 built-in presets", () => {
    expect(BUILT_IN_PRESETS).toHaveLength(6);
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.builtIn).toBe(true);
      expect(preset.effects.length).toBeGreaterThan(0);
    }
  });

  it("applyPreset returns a deep copy of effects", () => {
    const preset = BUILT_IN_PRESETS[0];
    const applied = applyPreset(preset);
    expect(applied).toEqual(preset.effects);
    // Verify it's a deep copy
    applied[0].enabled = false;
    expect(preset.effects[0].enabled).toBe(true);
  });

  it("getAllPresets returns built-in presets (no custom saved)", () => {
    const presets = getAllPresets();
    expect(presets.length).toBeGreaterThanOrEqual(BUILT_IN_PRESETS.length);
  });
});

describe("hasEnabledEffects", () => {
  it("returns false for undefined", () => {
    expect(hasEnabledEffects(undefined)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasEnabledEffects([])).toBe(false);
  });

  it("returns false when no effects are enabled", () => {
    expect(hasEnabledEffects([
      { type: "drop-shadow", color: "#000", offsetX: 0, offsetY: 0, blur: 4, opacity: 0.5, enabled: false },
    ])).toBe(false);
  });

  it("returns true when at least one effect is enabled", () => {
    expect(hasEnabledEffects([
      { type: "drop-shadow", color: "#000", offsetX: 0, offsetY: 0, blur: 4, opacity: 0.5, enabled: true },
    ])).toBe(true);
  });
});
