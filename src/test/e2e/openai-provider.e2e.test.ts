/// <reference types="node" />

import { describe, it, expect } from "vitest";
import { createOpenAiCompatibleProvider } from "../../app/ai/providers/openAiCompatibleProvider";
import type { AiProviderResponse, AiTaskSuccess } from "../../app/ai/contracts";
import type {
  AiCaptioningTask,
  AiEnhancementTask,
  AiGenerationTask,
  AiInpaintingTask,
  AiSegmentationTask,
  AiTask,
} from "../../app/ai/types";
import { loadSampleImage, loadSampleMask } from "./helpers";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ENDPOINT = "https://api.openai.com/v1";

/**
 * Asserts that a provider response is a success and narrows the type.
 * Includes the full error payload in the assertion message for debugging.
 */
function assertSuccess<T extends AiTask>(
  result: AiProviderResponse<T>,
): asserts result is AiTaskSuccess<T> {
  expect(result.ok, result.ok ? "" : `Provider returned failure: ${JSON.stringify((result as { error?: unknown }).error)}`).toBe(true);
}

describe.skipIf(!OPENAI_API_KEY)("OpenAI provider E2E", () => {
  function getProvider() {
    return createOpenAiCompatibleProvider({
      endpoint: ENDPOINT,
      apiKey: OPENAI_API_KEY!,
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

      const result = await provider.execute({
        task,
        preferredModel: "gpt-4.1-mini",
      });

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
        options: { width: 1024, height: 1024, imageCount: 1 },
      };

      const result = await provider.execute({
        task,
        preferredModel: "gpt-image-1",
      });

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

      const result = await provider.execute({
        task,
        preferredModel: "gpt-image-1",
      });

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

      const result = await provider.execute({
        task,
        preferredModel: "gpt-image-1",
      });

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

      const result = await provider.execute({
        task,
        preferredModel: "gpt-image-1",
      });

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
