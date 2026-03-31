import { describe, expect, it } from "vitest";
import { classifyOpenAiModel, getOpenAiModelDisplayName, OPENAI_MODEL_HINTS } from "./modelHints";

describe("modelHints", () => {
  // ─── classifyOpenAiModel ────────────────────────────────────────────

  describe("classifyOpenAiModel", () => {
    it("classifies gpt-image-1 as generation, inpainting, enhancement", () => {
      expect(classifyOpenAiModel("gpt-image-1")).toEqual(["generation", "inpainting", "enhancement"]);
    });

    it("classifies gpt-image-1-hd as generation, inpainting, enhancement (prefix match)", () => {
      expect(classifyOpenAiModel("gpt-image-1-hd")).toEqual(["generation", "inpainting", "enhancement"]);
    });

    it("classifies dall-e-3 as generation only", () => {
      expect(classifyOpenAiModel("dall-e-3")).toEqual(["generation"]);
    });

    it("classifies dall-e-2 as generation only", () => {
      expect(classifyOpenAiModel("dall-e-2")).toEqual(["generation"]);
    });

    it("classifies gpt-4o as captioning, segmentation, inpainting, enhancement", () => {
      expect(classifyOpenAiModel("gpt-4o")).toEqual(["captioning", "segmentation", "inpainting", "enhancement"]);
    });

    it("classifies gpt-4o-mini variant via prefix match", () => {
      expect(classifyOpenAiModel("gpt-4o-mini")).toEqual(["captioning", "segmentation", "inpainting", "enhancement"]);
    });

    it("classifies gpt-4.1-mini as captioning, segmentation", () => {
      expect(classifyOpenAiModel("gpt-4.1-mini")).toEqual(["captioning", "segmentation"]);
    });

    it("classifies gpt-4-turbo as captioning, segmentation", () => {
      expect(classifyOpenAiModel("gpt-4-turbo")).toEqual(["captioning", "segmentation"]);
    });

    it("classifies gpt-4-vision-preview as captioning, segmentation", () => {
      expect(classifyOpenAiModel("gpt-4-vision-preview")).toEqual(["captioning", "segmentation"]);
    });

    it("classifies gpt-3.5-turbo as empty (no image capabilities)", () => {
      expect(classifyOpenAiModel("gpt-3.5-turbo")).toEqual([]);
    });

    it("classifies exact gpt-4 as empty (text-only)", () => {
      expect(classifyOpenAiModel("gpt-4")).toEqual([]);
    });

    it("returns empty array for unknown model", () => {
      expect(classifyOpenAiModel("some-custom-model")).toEqual([]);
    });

    it("returns first matching hint (gpt-4o before gpt-4$)", () => {
      // gpt-4o matches the gpt-4o pattern, NOT the gpt-4$ exact pattern
      const result = classifyOpenAiModel("gpt-4o");
      expect(result).toContain("captioning");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── getOpenAiModelDisplayName ──────────────────────────────────────

  describe("getOpenAiModelDisplayName", () => {
    it("returns display name for gpt-image-1", () => {
      expect(getOpenAiModelDisplayName("gpt-image-1")).toBe("GPT Image 1");
    });

    it("returns display name for gpt-4o variant", () => {
      expect(getOpenAiModelDisplayName("gpt-4o-mini")).toBe("GPT-4o");
    });

    it("returns display name for dall-e-3", () => {
      expect(getOpenAiModelDisplayName("dall-e-3")).toBe("DALL-E 3");
    });

    it("returns display name for gpt-4.1 variant", () => {
      expect(getOpenAiModelDisplayName("gpt-4.1-mini")).toBe("GPT-4.1");
    });

    it("returns raw model ID when no hint matches", () => {
      expect(getOpenAiModelDisplayName("custom-model-v2")).toBe("custom-model-v2");
    });

    it("returns raw model ID when hint matches but has no displayName", () => {
      expect(getOpenAiModelDisplayName("gpt-4-turbo-preview")).toBe("gpt-4-turbo-preview");
    });
  });

  // ─── OPENAI_MODEL_HINTS structure ──────────────────────────────────

  describe("OPENAI_MODEL_HINTS", () => {
    it("is a non-empty readonly array", () => {
      expect(OPENAI_MODEL_HINTS.length).toBeGreaterThan(0);
    });

    it("every hint has a pattern and capabilities array", () => {
      for (const hint of OPENAI_MODEL_HINTS) {
        expect(hint.pattern).toBeDefined();
        expect(Array.isArray(hint.capabilities)).toBe(true);
      }
    });
  });
});
