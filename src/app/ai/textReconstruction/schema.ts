import type { LayerEffect, TextFill, TextStroke } from "../../../editor/types";
import type { StructuredTextReconstructionBlock } from "../../../editor/textReconstruction";

export interface StructuredTextReconstructionParseResult {
  ok: boolean;
  blocks: StructuredTextReconstructionBlock[];
  warnings: string[];
  error?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseFill(value: unknown, warnings: string[], path: string): TextFill | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = asNonEmptyString(value.type);
  if (type === "solid") {
    const color = asNonEmptyString(value.color);
    if (!color) {
      warnings.push(`${path}.color was invalid and was dropped.`);
      return null;
    }
    return { type: "solid", color };
  }
  if (type === "linear-gradient") {
    const angle = asFiniteNumber(value.angle) ?? 0;
    const rawStops = Array.isArray(value.stops) ? value.stops : [];
    const stops = rawStops.map((stop, index) => {
      if (!isRecord(stop)) return null;
      const offset = asFiniteNumber(stop.offset) ?? asFiniteNumber(stop.position);
      const color = asNonEmptyString(stop.color);
      if (offset === null || color === null) {
        warnings.push(`${path}.stops[${index}] was invalid and was dropped.`);
        return null;
      }
      return { offset: Math.max(0, Math.min(1, offset)), color };
    }).filter((stop): stop is NonNullable<typeof stop> => stop !== null);
    return stops.length >= 2 ? { type: "linear-gradient", angle, stops } : null;
  }
  if (type === "radial-gradient") {
    const centerX = asFiniteNumber(value.centerX);
    const centerY = asFiniteNumber(value.centerY);
    const rawStops = Array.isArray(value.stops) ? value.stops : [];
    const stops = rawStops.map((stop, index) => {
      if (!isRecord(stop)) return null;
      const offset = asFiniteNumber(stop.offset) ?? asFiniteNumber(stop.position);
      const color = asNonEmptyString(stop.color);
      if (offset === null || color === null) {
        warnings.push(`${path}.stops[${index}] was invalid and was dropped.`);
        return null;
      }
      return { offset: Math.max(0, Math.min(1, offset)), color };
    }).filter((stop): stop is NonNullable<typeof stop> => stop !== null);
    return stops.length >= 2
      ? {
          type: "radial-gradient",
          stops,
          centerX: centerX === null ? undefined : Math.max(0, Math.min(1, centerX)),
          centerY: centerY === null ? undefined : Math.max(0, Math.min(1, centerY)),
        }
      : null;
  }
  warnings.push(`${path}.type was unsupported and was dropped.`);
  return null;
}

function parseStroke(value: unknown, warnings: string[], path: string): TextStroke | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const color = asNonEmptyString(value.color);
  const width = asFiniteNumber(value.width);
  if (!color || width === null || width <= 0) {
    warnings.push(`${path} was invalid and was dropped.`);
    return null;
  }
  return { color, width };
}

function parseEffects(value: unknown, warnings: string[], path: string): LayerEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const effects: LayerEffect[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      warnings.push(`${path}[${index}] was invalid and was dropped.`);
      continue;
    }
    const type = asNonEmptyString(entry.type);
    if (!type) {
      warnings.push(`${path}[${index}].type was invalid and was dropped.`);
      continue;
    }
    switch (type) {
      case "drop-shadow": {
        const color = asNonEmptyString(entry.color) ?? "#000000";
        const offsetX = asFiniteNumber(entry.offsetX) ?? 0;
        const offsetY = asFiniteNumber(entry.offsetY) ?? 0;
        const blur = asFiniteNumber(entry.blur) ?? 0;
        const opacity = asFiniteNumber(entry.opacity) ?? 1;
        effects.push({ type, color, offsetX, offsetY, blur, opacity: Math.max(0, Math.min(1, opacity)), enabled: entry.enabled !== false });
        break;
      }
      case "inner-shadow": {
        const color = asNonEmptyString(entry.color) ?? "#000000";
        const offsetX = asFiniteNumber(entry.offsetX) ?? 0;
        const offsetY = asFiniteNumber(entry.offsetY) ?? 0;
        const blur = asFiniteNumber(entry.blur) ?? 0;
        const opacity = asFiniteNumber(entry.opacity) ?? 1;
        effects.push({ type, color, offsetX, offsetY, blur, opacity: Math.max(0, Math.min(1, opacity)), enabled: entry.enabled !== false });
        break;
      }
      case "outer-glow": {
        const color = asNonEmptyString(entry.color) ?? "#ffffff";
        const blur = asFiniteNumber(entry.blur) ?? 0;
        const spread = asFiniteNumber(entry.spread) ?? 0;
        const opacity = asFiniteNumber(entry.opacity) ?? 1;
        effects.push({ type, color, blur, spread, opacity: Math.max(0, Math.min(1, opacity)), enabled: entry.enabled !== false });
        break;
      }
      case "outline": {
        const color = asNonEmptyString(entry.color) ?? "#000000";
        const width = asFiniteNumber(entry.width) ?? 1;
        const opacity = asFiniteNumber(entry.opacity) ?? 1;
        effects.push({ type, color, width: Math.max(0, width), opacity: Math.max(0, Math.min(1, opacity)), enabled: entry.enabled !== false });
        break;
      }
      case "color-overlay": {
        const color = asNonEmptyString(entry.color) ?? "#000000";
        const opacity = asFiniteNumber(entry.opacity) ?? 1;
        effects.push({ type, color, opacity: Math.max(0, Math.min(1, opacity)), enabled: entry.enabled !== false });
        break;
      }
      default:
        warnings.push(`${path}[${index}].type '${type}' is unsupported and was dropped.`);
    }
  }
  return effects;
}

function parseBlock(value: unknown, index: number, warnings: string[]): StructuredTextReconstructionBlock | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asNonEmptyString(value.id) ?? `block-${index + 1}`;
  const text = asNonEmptyString(value.text);
  const bounds = isRecord(value.bounds) ? value.bounds : null;
  const x = bounds ? asFiniteNumber(bounds.x) : null;
  const y = bounds ? asFiniteNumber(bounds.y) : null;
  const width = bounds ? asFiniteNumber(bounds.width) : null;
  const height = bounds ? asFiniteNumber(bounds.height) : null;
  if (!text || x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }

  const style = isRecord(value.style) ? value.style : {};
  const transform = isRecord(value.transform) ? value.transform : {};
  const fill = parseFill(style.fill, warnings, `blocks[${index}].style.fill`);
  const stroke = parseStroke(style.stroke, warnings, `blocks[${index}].style.stroke`);
  const effects = parseEffects(style.effects, warnings, `blocks[${index}].style.effects`);
  const blendModeRaw = asNonEmptyString(value.blendMode);
  const blendMode = blendModeRaw === "normal" ? undefined : blendModeRaw as GlobalCompositeOperation | undefined;

  return {
    id,
    text,
    bounds: { x, y, width, height },
    fontFamily: asNonEmptyString(style.fontFamily) ?? undefined,
    fontSize: asFiniteNumber(style.fontSize) ?? undefined,
    lineHeight: asFiniteNumber(style.lineHeight) ?? undefined,
    kerning: asFiniteNumber(style.kerning) ?? undefined,
    alignment: (asNonEmptyString(style.alignment) as StructuredTextReconstructionBlock["alignment"] | null) ?? undefined,
    fill: fill ?? undefined,
    stroke,
    bold: typeof style.bold === "boolean" ? style.bold : undefined,
    italic: typeof style.italic === "boolean" ? style.italic : undefined,
    underline: typeof style.underline === "boolean" ? style.underline : undefined,
    strikethrough: typeof style.strikethrough === "boolean" ? style.strikethrough : undefined,
    rotationDeg: asFiniteNumber(transform.rotationDeg) ?? undefined,
    scaleX: asFiniteNumber(transform.scaleX) ?? undefined,
    scaleY: asFiniteNumber(transform.scaleY) ?? undefined,
    skewXDeg: asFiniteNumber(transform.skewXDeg) ?? undefined,
    skewYDeg: asFiniteNumber(transform.skewYDeg) ?? undefined,
    effects,
    opacity: asFiniteNumber(value.opacity) ?? undefined,
    blendMode,
    boxHeight: value.boxHeight === null ? null : asFiniteNumber(value.boxHeight) ?? undefined,
    name: asNonEmptyString(value.name) ?? undefined,
    confidence: (() => {
      const raw = asFiniteNumber(value.confidence);
      return raw !== null ? Math.max(0, Math.min(1, raw)) : undefined;
    })(),
    notes: asNonEmptyString(value.notes) ?? undefined,
  };
}

export function parseStructuredTextReconstructionJson(input: string): StructuredTextReconstructionParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {
      ok: false,
      blocks: [],
      warnings: [],
      error: "AI text reconstruction returned invalid JSON.",
    };
  }

  if (!isRecord(parsed) || (parsed.schemaVersion !== "f4.2/v1" && parsed.schemaVersion !== "f4.2/v2") || !Array.isArray(parsed.blocks)) {
    return {
      ok: false,
      blocks: [],
      warnings: [],
      error: "AI text reconstruction returned a schema-invalid payload.",
    };
  }

  const warnings: string[] = [];
  const blocks = parsed.blocks.map((block, index) => parseBlock(block, index, warnings)).filter((block): block is StructuredTextReconstructionBlock => block !== null);
  if (blocks.length === 0) {
    return {
      ok: false,
      blocks: [],
      warnings,
      error: "AI text reconstruction returned no valid text blocks.",
    };
  }

  return {
    ok: true,
    blocks,
    warnings,
  };
}
