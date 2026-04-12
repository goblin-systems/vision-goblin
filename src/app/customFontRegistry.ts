export interface CustomFontEntry {
  /** The family name used in CSS / canvas (e.g. "My Custom Font") */
  family: string;
  /** The raw font file as a base64 data URL for persistence */
  dataUrl: string;
  /** Original file name for display (e.g. "MyFont.ttf") */
  fileName: string;
}

/** In-memory registry of custom fonts loaded in this session. */
const registry: CustomFontEntry[] = [];

/** Returns a snapshot of all loaded custom fonts. */
export function getCustomFonts(): readonly CustomFontEntry[] {
  return registry;
}

/** Returns just the family names of all loaded custom fonts. */
export function getCustomFontFamilies(): string[] {
  return registry.map((entry) => entry.family);
}

/**
 * Register a custom font from a data URL.
 * Creates a FontFace, loads it, adds it to the document, and records it in the registry.
 * Returns the registered family name.
 * If a font with the same family name is already registered, skips re-registration.
 */
export async function registerCustomFont(family: string, dataUrl: string, fileName: string): Promise<string> {
  const existing = registry.find((e) => e.family === family);
  if (existing) return existing.family;

  const fontFace = new FontFace(family, `url(${dataUrl})`);
  await fontFace.load();
  document.fonts.add(fontFace);

  registry.push({ family, dataUrl, fileName });
  return family;
}

/**
 * Derive a font family name from a file name.
 * E.g. "Fira-Code-Bold.ttf" → "Fira Code Bold"
 */
export function fontFamilyFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(ttf|otf|woff2?)$/i, "");
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Custom Font";
}

/**
 * Read a font file (from an ArrayBuffer, e.g. from Tauri file dialog) and register it.
 * Converts the buffer to a data URL, derives a family name, and registers.
 */
export async function loadFontFromBuffer(buffer: ArrayBuffer, fileName: string): Promise<CustomFontEntry> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "ttf";
  const mimeMap: Record<string, string> = {
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  const mime = mimeMap[ext] ?? "font/ttf";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const dataUrl = `data:${mime};base64,${btoa(binary)}`;
  const family = fontFamilyFromFileName(fileName);
  await registerCustomFont(family, dataUrl, fileName);
  return { family, dataUrl, fileName };
}

/**
 * Reset the registry. Only for testing — not exported as part of the public API contract.
 * @internal
 */
export function _resetRegistryForTesting(): void {
  registry.length = 0;
}
