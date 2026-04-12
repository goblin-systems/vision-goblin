import { describe, expect, it } from "vitest";
import type { AiGuideMode } from "../types";
import {
  buildGuideDrivenInpaintingPrompt,
  buildRemoveObjectPrompt,
  buildThumbnailTextOverlayPrompt,
  DEFAULT_BACKGROUND_DESCRIPTION,
  RASTER_TEXT_CLEANUP_PROMPT,
  REMOVE_OBJECT_DEFAULT_PROMPT,
} from "./editing";

// ── buildGuideDrivenInpaintingPrompt ────────────────────────────────────

describe("buildGuideDrivenInpaintingPrompt", () => {
  describe("shadow-add", () => {
    it("produces 'subtle' description for low intensity", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 10, lightDirection: "auto" });
      expect(result).toContain("subtle");
    });

    it("produces 'moderate' description for medium intensity", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 50, lightDirection: "auto" });
      expect(result).toContain("moderate");
    });

    it("produces 'strong' description for high intensity", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 85, lightDirection: "auto" });
      expect(result).toContain("strong");
    });

    it("uses auto light direction analysis when lightDirection is 'auto'", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 50, lightDirection: "auto" });
      expect(result).toContain("Analyze the scene to determine the natural light source direction");
    });

    it("includes specific light direction when provided", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 50, lightDirection: "top-right" });
      expect(result).toContain("light source is coming from the top-right");
    });

    it("includes the intensity percentage", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 42, lightDirection: "auto" });
      expect(result).toContain("Shadow intensity: 42%");
    });

    it("mentions dual-colour shadow guide", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-add", { intensity: 50, lightDirection: "auto" });
      expect(result).toContain("dual-colour shadow guide");
    });
  });

  describe("shadow-remove", () => {
    it("mentions shadow reduction strength with intensity percentage", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-remove", { intensity: 75, lightDirection: "auto" });
      expect(result).toContain("Shadow reduction strength: 75%");
    });

    it("mentions removing the existing cast shadow", () => {
      const result = buildGuideDrivenInpaintingPrompt("shadow-remove", { intensity: 50, lightDirection: "auto" });
      expect(result).toContain("Reduce or remove the existing cast shadow");
    });
  });

  describe("reflection-add", () => {
    it("returns a non-empty prompt about adding reflection", () => {
      const result = buildGuideDrivenInpaintingPrompt("reflection-add", { intensity: 50, lightDirection: "auto" });
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("realistic reflection or glare");
    });
  });

  describe("reflection-remove", () => {
    it("returns a non-empty prompt about removing reflection", () => {
      const result = buildGuideDrivenInpaintingPrompt("reflection-remove", { intensity: 50, lightDirection: "auto" });
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("Reduce or remove the existing reflection or glare");
    });
  });

  describe("clone-object", () => {
    it("returns a non-empty prompt about cloning", () => {
      const result = buildGuideDrivenInpaintingPrompt("clone-object", { intensity: 50, lightDirection: "auto" });
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("Clone the red-marked source object");
    });
  });

  describe("move-object", () => {
    it("returns a non-empty prompt about moving", () => {
      const result = buildGuideDrivenInpaintingPrompt("move-object", { intensity: 50, lightDirection: "auto" });
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("Move the red-marked source object");
    });
  });

  describe("default case", () => {
    it("returns a generic fallback prompt for an unknown guide mode", () => {
      const result = buildGuideDrivenInpaintingPrompt("unknown-mode" as AiGuideMode, { intensity: 50, lightDirection: "auto" });
      expect(result).toContain("guide-driven inpainting edit");
    });
  });
});

// ── REMOVE_OBJECT_DEFAULT_PROMPT ────────────────────────────────────────

describe("REMOVE_OBJECT_DEFAULT_PROMPT", () => {
  it("has the expected value", () => {
    expect(REMOVE_OBJECT_DEFAULT_PROMPT).toBe("Remove the selected distraction and reconstruct the background.");
  });
});

// ── buildRemoveObjectPrompt ─────────────────────────────────────────────

describe("buildRemoveObjectPrompt", () => {
  it("interpolates the object description", () => {
    expect(buildRemoveObjectPrompt("trash can")).toBe("Remove the trash can and reconstruct the background naturally.");
  });

  it("works with a multi-word description", () => {
    expect(buildRemoveObjectPrompt("large red car in the foreground")).toContain("large red car in the foreground");
  });
});

// ── DEFAULT_BACKGROUND_DESCRIPTION ──────────────────────────────────────

describe("DEFAULT_BACKGROUND_DESCRIPTION", () => {
  it("has the expected value", () => {
    expect(DEFAULT_BACKGROUND_DESCRIPTION).toBe("soft studio backdrop");
  });
});

// ── RASTER_TEXT_CLEANUP_PROMPT ───────────────────────────────────────────

describe("RASTER_TEXT_CLEANUP_PROMPT", () => {
  it("has the expected value", () => {
    expect(RASTER_TEXT_CLEANUP_PROMPT).toBe(
      "Remove the rasterized text inside the selected region and reconstruct the underlying background cleanly. Do not add any new text, icons, or decorative elements.",
    );
  });
});

// ── buildThumbnailTextOverlayPrompt ─────────────────────────────────────

describe("buildThumbnailTextOverlayPrompt", () => {
  it("concatenates base prompt, text overlay, and position", () => {
    const result = buildThumbnailTextOverlayPrompt("Create a thumbnail", "CLICK HERE", "bottom-center");
    expect(result).toBe('Create a thumbnail. Include the text "CLICK HERE" positioned at the bottom-center of the image.');
  });

  it("preserves the base prompt at the start", () => {
    const result = buildThumbnailTextOverlayPrompt("My prompt", "Hello", "top-left");
    expect(result).toMatch(/^My prompt\./);
  });
});
