import { describe, expect, it } from "vitest";
import {
  getCaptureGlobalShortcutBindings,
  isCaptureDestination,
  normalizeCaptureDelaySeconds,
  toTauriShortcut,
} from "./capture";

describe("capture helpers", () => {
  it("recognizes valid capture destinations", () => {
    expect(isCaptureDestination("new-canvas")).toBe(true);
    expect(isCaptureDestination("add-layer")).toBe(true);
    expect(isCaptureDestination("clipboard")).toBe(true);
    expect(isCaptureDestination("something-else")).toBe(false);
  });

  it("normalizes unsupported capture delays to zero", () => {
    expect(normalizeCaptureDelaySeconds(0)).toBe(0);
    expect(normalizeCaptureDelaySeconds(3)).toBe(3);
    expect(normalizeCaptureDelaySeconds(5)).toBe(5);
    expect(normalizeCaptureDelaySeconds(2)).toBe(0);
  });

  it("converts app shortcuts to tauri accelerators", () => {
    expect(toTauriShortcut("Ctrl+Shift+4")).toBe("CommandOrControl+Shift+4");
    expect(toTauriShortcut("Ctrl+Shift+C")).toBe("CommandOrControl+Shift+C");
    expect(toTauriShortcut("Alt+F")).toBe("Alt+F");
  });

  it("returns capture shortcut bindings only for configured shortcuts", () => {
    const bindings = getCaptureGlobalShortcutBindings({
      "capture-region": "Ctrl+Shift+4",
      "capture-window": "",
      "capture-fullscreen": "Ctrl+Shift+5",
      "pick-from-screen": "Ctrl+Shift+C",
    });

    expect(bindings).toEqual([
      { commandId: "capture-region", accelerator: "CommandOrControl+Shift+4" },
      { commandId: "capture-fullscreen", accelerator: "CommandOrControl+Shift+5" },
      { commandId: "pick-from-screen", accelerator: "CommandOrControl+Shift+C" },
    ]);
  });
});
