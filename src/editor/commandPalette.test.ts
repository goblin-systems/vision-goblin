import { describe, it, expect, beforeEach } from "vitest";
import { scoreMatch, filterCommands, categoryLabel, type PaletteItem } from "./commandPalette";
import { registerCommands, type CommandDefinition } from "./commands";

// Register some test commands before filtering tests
const testCommands: CommandDefinition[] = [
  { id: "brightness-contrast", label: "Brightness / Contrast", category: "adjust", enabled: () => true, execute: () => {} },
  { id: "hue-saturation", label: "Hue / Saturation", category: "adjust", enabled: () => true, execute: () => {} },
  { id: "new-document", label: "New document", category: "file", enabled: () => true, execute: () => {} },
  { id: "save-project", label: "Save project", category: "file", enabled: () => true, execute: () => {} },
  { id: "tool-brush", label: "Brush", category: "tool", enabled: () => true, execute: () => {} },
  { id: "undo", label: "Undo", category: "edit", enabled: () => true, execute: () => {} },
  { id: "redo", label: "Redo", category: "edit", enabled: () => true, execute: () => {} },
  { id: "redo-alt", label: "Redo", category: "edit", enabled: () => true, execute: () => {} },
  { id: "select-all", label: "Select all", category: "select", enabled: () => true, execute: () => {} },
];

beforeEach(() => {
  registerCommands(testCommands);
});

describe("commandPalette", () => {
  describe("scoreMatch", () => {
    it("returns positive score for substring match", () => {
      expect(scoreMatch("Brightness / Contrast", "bright")).toBeGreaterThan(0);
    });

    it("returns -1 for no match", () => {
      expect(scoreMatch("Brightness / Contrast", "xyz")).toBe(-1);
    });

    it("gives higher score to start-of-string matches", () => {
      const startScore = scoreMatch("Brightness / Contrast", "bright");
      const midScore = scoreMatch("Brightness / Contrast", "contrast");
      expect(startScore).toBeGreaterThan(midScore);
    });

    it("gives highest score to exact match", () => {
      const exact = scoreMatch("Undo", "undo");
      const partial = scoreMatch("Undo something", "undo");
      expect(exact).toBeGreaterThan(partial);
    });

    it("matches empty query with positive score", () => {
      expect(scoreMatch("anything", "")).toBeGreaterThan(0);
    });

    it("matches multi-word queries", () => {
      expect(scoreMatch("Brightness / Contrast", "bright contrast")).toBeGreaterThan(0);
    });

    it("returns -1 when only one word of multi-word query matches", () => {
      expect(scoreMatch("Brightness / Contrast", "bright xyz")).toBe(-1);
    });
  });

  describe("filterCommands", () => {
    it("returns all commands for empty query (except redo-alt)", () => {
      const results = filterCommands("");
      expect(results.length).toBe(testCommands.length - 1); // minus redo-alt
    });

    it("filters by label", () => {
      const results = filterCommands("brush");
      expect(results.some((r) => r.command.id === "tool-brush")).toBe(true);
    });

    it("filters by category", () => {
      const results = filterCommands("adjust");
      expect(results.some((r) => r.command.id === "brightness-contrast")).toBe(true);
      expect(results.some((r) => r.command.id === "hue-saturation")).toBe(true);
    });

    it("filters by command id", () => {
      const results = filterCommands("new-document");
      expect(results.some((r) => r.command.id === "new-document")).toBe(true);
    });

    it("excludes redo-alt duplicate", () => {
      const results = filterCommands("redo");
      const redoAlts = results.filter((r) => r.command.id === "redo-alt");
      expect(redoAlts.length).toBe(0);
    });

    it("returns empty array for nonsense query", () => {
      const results = filterCommands("zzzqqqxxx");
      expect(results.length).toBe(0);
    });

    it("sorts higher-scoring matches first", () => {
      const results = filterCommands("save");
      expect(results.length).toBeGreaterThan(0);
      // Scores should be non-increasing
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });
  });

  describe("categoryLabel", () => {
    it("returns display name for known categories", () => {
      expect(categoryLabel("file")).toBe("File");
      expect(categoryLabel("edit")).toBe("Edit");
      expect(categoryLabel("adjust")).toBe("Adjust");
      expect(categoryLabel("tool")).toBe("Tool");
    });

    it("returns raw string for unknown categories", () => {
      expect(categoryLabel("unknown")).toBe("unknown");
    });
  });
});
