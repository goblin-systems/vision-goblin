import type { CaptureDestination } from "../settings";

const CAPTURE_GLOBAL_SHORTCUT_IDS = [
  "capture-region",
  "capture-window",
  "capture-fullscreen",
  "pick-from-screen",
] as const;

export interface CaptureGlobalShortcutBinding {
  commandId: typeof CAPTURE_GLOBAL_SHORTCUT_IDS[number];
  accelerator: string;
}

export function isCaptureDestination(value: string): value is CaptureDestination {
  return value === "new-canvas" || value === "add-layer" || value === "clipboard";
}

export function normalizeCaptureDelaySeconds(value: number): number {
  return value === 3 || value === 5 ? value : 0;
}

export function toTauriShortcut(shortcut: string): string | null {
  if (!shortcut.trim()) return null;
  const normalized = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl" || lower === "cmd" || lower === "command" || lower === "meta") return "CommandOrControl";
      if (lower === "shift") return "Shift";
      if (lower === "alt" || lower === "option") return "Alt";
      if (part.length === 1) return part.toUpperCase();
      return part;
    });
  return normalized.length ? normalized.join("+") : null;
}

export function getCaptureGlobalShortcutBindings(keybindings: Record<string, string>): CaptureGlobalShortcutBinding[] {
  const bindings: CaptureGlobalShortcutBinding[] = [];
  for (const commandId of CAPTURE_GLOBAL_SHORTCUT_IDS) {
    const accelerator = toTauriShortcut(keybindings[commandId] ?? "");
    if (!accelerator) continue;
    bindings.push({ commandId, accelerator });
  }
  return bindings;
}
