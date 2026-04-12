/// <reference types="node" />

import { describe, it, expect, vi } from "vitest";
import { createGeminiProvider } from "../../app/ai/providers/geminiProvider";
import type { AiProviderResponse, AiTaskSuccess } from "../../app/ai/contracts";
import type {
  AiCaptioningTask,
  AiEnhancementTask,
  AiGenerationTask,
  AiInpaintingTask,
  AiSegmentationTask,
  AiTask,
} from "../../app/ai/types";
import { loadNamedSampleMask, loadSampleImage, loadSampleMask } from "./helpers";

/**
 * E2E tests for the Gemini AI provider.
 * Requires GEMINI_API_KEY environment variable to be set.
 * Image-producing tasks use the gemini-2.5-flash-image model variant;
 * captioning (text-only output) uses gemini-2.5-flash.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const AI_SHADOW_FINISH_MESSAGE = "Unable to show the generated image. The model could not generate the image based on the prompt provided. You will not be charged for this request. Try rephrasing the prompt. If you think this was an error, [send feedback](https://ai.google.dev/gemini-api/docs/troubleshooting).";

/**
 * Asserts that a provider response is a success and narrows the type.
 * Includes the full error payload in the assertion message for debugging.
 */
function assertSuccess<T extends AiTask>(
  result: AiProviderResponse<T>,
): asserts result is AiTaskSuccess<T> {
  expect(result.ok, result.ok ? "" : `Provider returned failure: ${JSON.stringify((result as { error?: unknown }).error)}`).toBe(true);
}

describe("Gemini provider fixture-backed refusal handling", () => {
  it("surfaces finishMessage for AI shadow inpainting refusals with real image and mask fixtures", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            finishReason: "IMAGE_OTHER",
            index: 0,
            finishMessage: AI_SHADOW_FINISH_MESSAGE,
          },
        ],
        usageMetadata: {
          promptTokenCount: 721,
          candidatesTokenCount: 1,
          totalTokenCount: 722,
          promptTokensDetails: [
            { modality: "TEXT", tokenCount: 205 },
            { modality: "IMAGE", tokenCount: 516 },
          ],
        },
        modelVersion: "gemini-2.5-flash-image",
        responseId: "dOPPafiOI_6FkdUPsqKtkQE",
      }),
    }));

    const provider = createGeminiProvider({ apiKey: "test-key", fetch: fetchMock });
    const image = { ...loadSampleImage("ai_shadow_selected_layers.png"), width: 1600, height: 1000 };
    const mask = { ...loadNamedSampleMask("ai_shadow_mask.png"), width: 1600, height: 1000 };

    const task: AiInpaintingTask = {
      id: "e2e-inp-shadow-refusal",
      family: "inpainting",
      prompt: "Add a realistic grounded shadow beneath the selected subject, matching the scene lighting and preserving the rest of the image unchanged.",
      input: { image, mask },
      options: { mode: "replace" },
    };

    const result = await provider.execute({ task });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failure");
    }

    expect(result.error.message).toContain(AI_SHADOW_FINISH_MESSAGE);
    expect(result.error.aiMessage).toBe(AI_SHADOW_FINISH_MESSAGE);
    expect(result.error.message).not.toBe("Gemini did not return an image. AI response: Finish reason: IMAGE_OTHER");
  });
});

describe.skipIf(!GEMINI_API_KEY)("Gemini provider E2E", () => {
  function getProvider() {
    return createGeminiProvider({
      apiKey: GEMINI_API_KEY!,
    });
  }

  // ─── Captioning ────────────────────────────────────────────────────────

  describe("captioning", () => {
    it("returns a text caption for a sample photo", async () => {
      const provider = getProvider();
      const image = loadSampleImage("sample_photo_1.png");

      const task: AiCaptioningTask = {
        id: `e2e-cap-${crypto.randomUUID()}`,
        family: "captioning",
        input: { image },
        options: { detail: "brief" },
      };

      const result = await provider.execute({ task });

      assertSuccess(result);

      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const caption = result.artifacts.find((a) => a.kind === "text");
      expect(caption, "Expected at least one text artifact").toBeDefined();
      expect(caption!.kind).toBe("text");
      if (caption!.kind === "text") {
        expect(caption!.text.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Generation ────────────────────────────────────────────────────────

  describe("generation", () => {
    it("generates an image from a text prompt", async () => {
      const provider = getProvider();

      const task: AiGenerationTask = {
        id: `e2e-gen-${crypto.randomUUID()}`,
        family: "generation",
        prompt: "A small green goblin sitting on a mushroom",
        options: { width: 512, height: 512, imageCount: 1 },
      };

      const result = await provider.execute({ task });

      assertSuccess(result);

      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const image = result.artifacts.find((a) => a.kind === "image");
      expect(image, "Expected at least one image artifact").toBeDefined();
      expect(image!.kind).toBe("image");
      if (image!.kind === "image") {
        expect(image!.data.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Segmentation ─────────────────────────────────────────────────────

  describe("segmentation", () => {
    it("returns a mask artifact for subject segmentation", async () => {
      const provider = getProvider();
      const image = loadSampleImage("sample_photo_1.png");

      const task: AiSegmentationTask = {
        id: `e2e-seg-${crypto.randomUUID()}`,
        family: "segmentation",
        prompt: "Segment the main subject of this image.",
        input: { image, subjectHint: "main subject" },
        options: { mode: "subject" },
      };

      const result = await provider.execute({ task });

      assertSuccess(result);

      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const mask = result.artifacts.find((a) => a.kind === "mask");
      expect(mask, "Expected at least one mask artifact").toBeDefined();
      expect(mask!.kind).toBe("mask");
      if (mask!.kind === "mask") {
        expect(mask!.data.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Enhancement ──────────────────────────────────────────────────────

  describe("enhancement", () => {
    it("returns an enhanced image for auto-enhance", async () => {
      const provider = getProvider();
      const image = loadSampleImage("sample_photo_1.png");

      const task: AiEnhancementTask = {
        id: `e2e-enh-${crypto.randomUUID()}`,
        family: "enhancement",
        input: { image },
        options: { operation: "auto-enhance" },
      };

      const result = await provider.execute({ task });

      assertSuccess(result);

      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const enhanced = result.artifacts.find((a) => a.kind === "image");
      expect(enhanced, "Expected at least one image artifact").toBeDefined();
      expect(enhanced!.kind).toBe("image");
      if (enhanced!.kind === "image") {
        expect(enhanced!.data.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Inpainting ───────────────────────────────────────────────────────

  describe("inpainting", () => {
    it("returns an inpainted image", async () => {
      const provider = getProvider();
      const image = loadSampleImage("sample_photo_1.png");
      const mask = loadSampleMask();

      const task: AiInpaintingTask = {
        id: `e2e-inp-${crypto.randomUUID()}`,
        family: "inpainting",
        prompt: "Replace with flowers",
        input: { image, mask },
        options: { mode: "replace" },
      };

      const result = await provider.execute({ task });

      assertSuccess(result);

      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const inpainted = result.artifacts.find((a) => a.kind === "image");
      expect(inpainted, "Expected at least one image artifact").toBeDefined();
      expect(inpainted!.kind).toBe("image");
      if (inpainted!.kind === "image") {
        expect(inpainted!.data.length).toBeGreaterThan(0);
      }
    });
  });
});
