export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function normalizeHexColour(colour: string) {
  const normalized = colour.trim();
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

export function parseHexColour(colour: string) {
  const hex = normalizeHexColour(colour).slice(1);
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
    if ([r, g, b, a].some((value) => Number.isNaN(value))) {
      return null;
    }
    return { r, g, b, a };
  }
  return null;
}

export function blendChannel(source: number, destination: number, sourceAlpha: number, destinationAlpha: number, outAlpha: number) {
  if (outAlpha <= 0) {
    return 0;
  }
  return Math.round(((source * sourceAlpha) + (destination * destinationAlpha * (1 - sourceAlpha))) / outAlpha);
}

export function rgbaToHex(rgba: Rgba) {
  return `#${[rgba.r, rgba.g, rgba.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function interpolateChannel(start: number, end: number, t: number) {
  return Math.round(start + (end - start) * t);
}
