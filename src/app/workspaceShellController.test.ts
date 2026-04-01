import { describe, expect, it } from "vitest";
import { makeNewDocument } from "../editor/actions/documentActions";
import { getDefaultSettings } from "../settings";
import {
  buildWorkspaceShellState,
  formatShortcutFromKeyboardEvent,
  getCanvasFloatingChipText,
  getToolTooltipLabel,
} from "./workspaceShellController";

describe("workspaceShellController helpers", () => {
  it("builds an empty-shell state when no document is active", () => {
    const settings = getDefaultSettings();
    const state = buildWorkspaceShellState({
      settings,
      doc: null,
      activeLayer: null,
      selectedLayerCount: 0,
      quickMaskActive: false,
      activeShapeKind: "rectangle",
    });

    expect(state.hasDocument).toBe(false);
    expect(state.activeDocMeta).toBe("No canvas open");
    expect(state.zoomReadout).toBe("100%");
    expect(state.navDisabled["save-project-nav"]).toBe(true);
    expect(state.navDisabled["warp-nav"]).toBe(true);
  });

  it("builds document shell state from active layer and selection counts", () => {
    const settings = getDefaultSettings();
    const doc = makeNewDocument("Doc", 400, 300, 100, "transparent");
    doc.selectionRect = { x: 10, y: 20, width: 100, height: 80 };
    doc.dirty = true;
    doc.undoStack.push("undo");
    doc.redoStack.push("redo");

    const activeLayer = doc.layers[0] ?? null;
    const state = buildWorkspaceShellState({
      settings,
      doc,
      activeLayer,
      selectedLayerCount: 3,
      quickMaskActive: false,
      activeShapeKind: "ellipse",
    });

    expect(state.hasDocument).toBe(true);
    expect(state.activeDocMeta).toContain("400 x 300 px");
    expect(state.activeDocMeta).toContain("selection 100x80");
    expect(state.activeDocMeta).toContain("unsaved");
    expect(state.navDisabled["warp-nav"]).toBe(false);
    expect(state.navDisabled["distribute-h-nav"]).toBe(false);
    expect(state.undoDisabled).toBe(false);
    expect(state.redoDisabled).toBe(false);
  });

  it("clips fractional selection dimensions in document metadata", () => {
    const settings = getDefaultSettings();
    const doc = makeNewDocument("Doc", 400, 300, 100, "transparent");
    doc.selectionRect = { x: 10, y: 20, width: 14.33333333, height: 16.6666666666666 };

    const state = buildWorkspaceShellState({
      settings,
      doc,
      activeLayer: doc.layers[0] ?? null,
      selectedLayerCount: 1,
      quickMaskActive: false,
      activeShapeKind: "rectangle",
    });

    expect(state.activeDocMeta).toContain("selection 14.33x16.67");
    expect(state.activeDocMeta).not.toContain("14.33333333");
    expect(state.activeDocMeta).not.toContain("16.6666666666666");
  });

  it("formats tooltips and floating chip copy", () => {
    expect(getToolTooltipLabel("Move tool", "V")).toBe("Move tool (V)");
    expect(getCanvasFloatingChipText({
      quickMaskActive: true,
      activeTool: "move",
      activeShapeKind: "rectangle",
    })).toContain("Quick Mask");
    expect(getCanvasFloatingChipText({
      quickMaskActive: false,
      activeTool: "fill",
      activeShapeKind: "ellipse",
    })).toBe("Click to fill the current selection on the active raster layer.");
    expect(getCanvasFloatingChipText({
      quickMaskActive: false,
      activeTool: "gradient",
      activeShapeKind: "ellipse",
    })).toBe("Open the gradient editor to apply a left-to-right gradient to the active target area.");
    expect(getCanvasFloatingChipText({
      quickMaskActive: false,
      activeTool: "shape",
      activeShapeKind: "ellipse",
    })).toBe("Click or drag to create a ellipse.");
  });

  it("formats captured shortcuts and ignores bare modifiers", () => {
    expect(formatShortcutFromKeyboardEvent({
      key: "k",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    })).toBe("Ctrl+Shift+K");
    expect(formatShortcutFromKeyboardEvent({
      key: "Control",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBeNull();
  });
});
