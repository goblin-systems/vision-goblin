import { describe, expect, it } from "vitest";
import type { AiEnhancementTask, AiGenerationTask, AiGuideMode, AiImageAsset } from "../types";
import {
  buildEnhancementPromptContract,
  buildGenerationPrompt,
  buildGuideSemanticsPrompt,
  buildInpaintingPromptContract,
  buildSegmentationSystemPrompt,
  buildSizeGuidance,
  defaultCaptionPrompt,
  defaultSegmentationUserPrompt,
  enhancementPurpose,
  getEnhancementTargetSize,
  getReferenceSourceSize,
} from "./provider";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeImageAsset(overrides?: Partial<AiImageAsset>): AiImageAsset {
  return { kind: "image", mimeType: "image/png", data: "base64data", width: 800, height: 600, ...overrides };
}

// ── defaultCaptionPrompt ────────────────────────────────────────────────

describe("defaultCaptionPrompt", () => {
  it("returns a brief caption prompt when detail is 'brief'", () => {
    expect(defaultCaptionPrompt("brief")).toBe("Write a brief caption for this image.");
  });

  it("returns a detailed caption prompt when detail is 'detailed'", () => {
    expect(defaultCaptionPrompt("detailed")).toBe("Describe this image in detail.");
  });

  it("returns the detailed prompt when detail is undefined", () => {
    expect(defaultCaptionPrompt()).toBe("Describe this image in detail.");
  });
});

// ── defaultSegmentationUserPrompt ───────────────────────────────────────

describe("defaultSegmentationUserPrompt", () => {
  it("returns the expected segmentation user prompt", () => {
    expect(defaultSegmentationUserPrompt()).toBe("Generate the segmentation mask for this image.");
  });
});

// ── buildSegmentationSystemPrompt ───────────────────────────────────────

describe("buildSegmentationSystemPrompt", () => {
  it("returns subject-mode prompt", () => {
    const result = buildSegmentationSystemPrompt("subject");
    expect(result).toContain("main subject");
    expect(result).toContain("white pixels represent the main subject");
  });

  it("returns background-mode prompt", () => {
    const result = buildSegmentationSystemPrompt("background");
    expect(result).toContain("white pixels represent the background");
    expect(result).toContain("black pixels represent the foreground");
  });

  it("returns object-mode prompt with subject hint", () => {
    const result = buildSegmentationSystemPrompt("object", "red car");
    expect(result).toContain("isolates a specific object");
    expect(result).toContain('"red car"');
  });

  it("returns object-mode prompt without subject hint", () => {
    const result = buildSegmentationSystemPrompt("object");
    expect(result).toContain("Identify the most prominent object");
    expect(result).not.toContain('"');
  });

  it("returns background-removal mode prompt", () => {
    const result = buildSegmentationSystemPrompt("background-removal");
    expect(result).toContain("background removal");
    expect(result).toContain("white pixels represent the main subject");
  });

  it("returns a default prompt when mode is undefined", () => {
    const result = buildSegmentationSystemPrompt(undefined);
    expect(result).toContain("main subject");
    expect(result).toContain("Output only the mask image");
  });
});

// ── buildSizeGuidance ───────────────────────────────────────────────────

describe("buildSizeGuidance", () => {
  it("returns empty string when no arguments provided", () => {
    expect(buildSizeGuidance()).toBe("");
  });

  it("includes source size when only source dimensions provided", () => {
    const result = buildSizeGuidance(1920, 1080);
    expect(result).toContain("Source image size: 1920x1080px.");
    expect(result).not.toContain("Output image must be exactly");
  });

  it("includes target size when only target dimensions provided", () => {
    const result = buildSizeGuidance(undefined, undefined, 3840, 2160);
    expect(result).toContain("Output image must be exactly 3840x2160px.");
    expect(result).not.toContain("Source image size:");
  });

  it("includes both source and target when both provided", () => {
    const result = buildSizeGuidance(1920, 1080, 3840, 2160);
    expect(result).toContain("Source image size: 1920x1080px.");
    expect(result).toContain("Output image must be exactly 3840x2160px.");
  });

  it("includes alignment preservation when preserveAlignment is true", () => {
    const result = buildSizeGuidance(800, 600, undefined, undefined, true);
    expect(result).toContain("Preserve the original framing");
    expect(result).toContain("do not crop, pad, shift, or re-center");
  });

  it("includes all parts when all parameters provided", () => {
    const result = buildSizeGuidance(800, 600, 1600, 1200, true);
    expect(result).toContain("Layout requirements:");
    expect(result).toContain("Source image size: 800x600px.");
    expect(result).toContain("Output image must be exactly 1600x1200px.");
    expect(result).toContain("Preserve the original framing");
  });
});

// ── getReferenceSourceSize ──────────────────────────────────────────────

describe("getReferenceSourceSize", () => {
  it("returns undefined for undefined input", () => {
    expect(getReferenceSourceSize(undefined)).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(getReferenceSourceSize([])).toBeUndefined();
  });

  it("returns undefined when first reference has missing dimensions", () => {
    expect(getReferenceSourceSize([makeImageAsset({ width: undefined, height: undefined })])).toBeUndefined();
  });

  it("returns undefined when first reference has missing width", () => {
    expect(getReferenceSourceSize([makeImageAsset({ width: undefined })])).toBeUndefined();
  });

  it("returns dimensions from the first valid reference", () => {
    const refs = [makeImageAsset({ width: 1024, height: 768 }), makeImageAsset({ width: 500, height: 500 })];
    expect(getReferenceSourceSize(refs)).toEqual({ width: 1024, height: 768 });
  });
});

// ── getEnhancementTargetSize ────────────────────────────────────────────

describe("getEnhancementTargetSize", () => {
  it("passes through dimensions for a non-upscale task", () => {
    const task: AiEnhancementTask = {
      id: "t1",
      family: "enhancement",
      input: { image: makeImageAsset({ width: 800, height: 600 }) },
      options: { operation: "auto-enhance" },
    };
    expect(getEnhancementTargetSize(task)).toEqual({ width: 800, height: 600 });
  });

  it("applies default 2x factor for upscale", () => {
    const task: AiEnhancementTask = {
      id: "t2",
      family: "enhancement",
      input: { image: makeImageAsset({ width: 400, height: 300 }) },
      options: { operation: "upscale" },
    };
    expect(getEnhancementTargetSize(task)).toEqual({ width: 800, height: 600 });
  });

  it("applies custom scale factor for upscale", () => {
    const task: AiEnhancementTask = {
      id: "t3",
      family: "enhancement",
      input: { image: makeImageAsset({ width: 400, height: 300 }) },
      options: { operation: "upscale", scaleFactor: 4 },
    };
    expect(getEnhancementTargetSize(task)).toEqual({ width: 1600, height: 1200 });
  });

  it("returns original dimensions when upscale image has missing dimensions", () => {
    const task: AiEnhancementTask = {
      id: "t4",
      family: "enhancement",
      input: { image: makeImageAsset({ width: undefined, height: undefined }) },
      options: { operation: "upscale" },
    };
    expect(getEnhancementTargetSize(task)).toEqual({ width: undefined, height: undefined });
  });
});

// ── enhancementPurpose ──────────────────────────────────────────────────

describe("enhancementPurpose", () => {
  it("returns 'upscaled' for upscale operation", () => {
    expect(enhancementPurpose("upscale")).toBe("upscaled");
  });

  it("returns 'styled' for style-transfer operation", () => {
    expect(enhancementPurpose("style-transfer")).toBe("styled");
  });

  it("returns 'enhanced' for auto-enhance operation", () => {
    expect(enhancementPurpose("auto-enhance")).toBe("enhanced");
  });

  it("returns 'enhanced' for denoise operation", () => {
    expect(enhancementPurpose("denoise")).toBe("enhanced");
  });

  it("returns 'enhanced' for restore operation", () => {
    expect(enhancementPurpose("restore")).toBe("enhanced");
  });

  it("returns 'enhanced' for colorize operation", () => {
    expect(enhancementPurpose("colorize")).toBe("enhanced");
  });
});

// ── buildGenerationPrompt ───────────────────────────────────────────────

describe("buildGenerationPrompt", () => {
  it("returns the prompt as-is when no references or size options", () => {
    const task: AiGenerationTask = { id: "g1", family: "generation", prompt: "A sunset over mountains" };
    expect(buildGenerationPrompt(task)).toBe("A sunset over mountains");
  });

  it("appends size guidance when reference images provided", () => {
    const task: AiGenerationTask = {
      id: "g2",
      family: "generation",
      prompt: "A sunset over mountains",
      input: { referenceImages: [makeImageAsset({ width: 1024, height: 768 })] },
    };
    const result = buildGenerationPrompt(task);
    expect(result).toContain("A sunset over mountains");
    expect(result).toContain("Source image size: 1024x768px.");
    expect(result).toContain("Preserve the original framing");
  });

  it("appends target size when size options provided", () => {
    const task: AiGenerationTask = {
      id: "g3",
      family: "generation",
      prompt: "A forest scene",
      options: { width: 1920, height: 1080 },
    };
    const result = buildGenerationPrompt(task);
    expect(result).toContain("A forest scene");
    expect(result).toContain("Output image must be exactly 1920x1080px.");
  });
});

// ── buildGuideSemanticsPrompt ───────────────────────────────────────────

describe("buildGuideSemanticsPrompt", () => {
  const guideModes: AiGuideMode[] = ["shadow-add", "shadow-remove", "reflection-add", "reflection-remove", "clone-object", "move-object"];

  it.each(guideModes)("returns a non-empty string for mode '%s'", (mode) => {
    const result = buildGuideSemanticsPrompt(mode);
    expect(result.length).toBeGreaterThan(0);
  });

  it("shadow-add prompt mentions dual-colour shadow guide", () => {
    expect(buildGuideSemanticsPrompt("shadow-add")).toContain("dual-colour shadow guide");
  });

  it("shadow-remove prompt mentions shadow region to clean up", () => {
    expect(buildGuideSemanticsPrompt("shadow-remove")).toContain("shadow region to clean up");
  });

  it("reflection-add prompt mentions reflection guide", () => {
    expect(buildGuideSemanticsPrompt("reflection-add")).toContain("reflection guide");
  });

  it("reflection-remove prompt mentions reflection or glare region", () => {
    expect(buildGuideSemanticsPrompt("reflection-remove")).toContain("reflection or glare region");
  });

  it("clone-object prompt mentions source object to clone", () => {
    expect(buildGuideSemanticsPrompt("clone-object")).toContain("source object to clone");
  });

  it("move-object prompt mentions source object to move", () => {
    expect(buildGuideSemanticsPrompt("move-object")).toContain("source object to move");
  });

  it("returns empty string for undefined mode", () => {
    expect(buildGuideSemanticsPrompt(undefined)).toBe("");
  });
});

// ── buildInpaintingPromptContract ───────────────────────────────────────

describe("buildInpaintingPromptContract", () => {
  it("builds colour-coded guide mask contract when guideMode is set", () => {
    const result = buildInpaintingPromptContract({
      guideMode: "shadow-add",
      image: makeImageAsset(),
    });
    expect(result.systemPrompt).toContain("colour-coded guide mask");
    expect(result.systemPrompt).toContain("dual-colour shadow guide");
    expect(result.inputOrder).toContain("1) source image, 2) colour-coded guide mask");
  });

  it("builds binary edit mask contract when no guideMode is set", () => {
    const result = buildInpaintingPromptContract({
      image: makeImageAsset(),
    });
    expect(result.systemPrompt).toContain("binary edit mask");
    expect(result.systemPrompt).not.toContain("colour-coded guide mask");
    expect(result.inputOrder).toContain("1) source image, 2) binary edit mask");
  });

  it("builds colour-coded guide mask contract for clone-object", () => {
    const result = buildInpaintingPromptContract({
      guideMode: "clone-object",
      image: makeImageAsset(),
    });
    expect(result.systemPrompt).toContain("colour-coded guide mask");
    expect(result.systemPrompt).toContain("source object to clone");
    expect(result.inputOrder).toContain("1) source image, 2) colour-coded guide mask");
  });

  it("includes size guidance with alignment preservation", () => {
    const result = buildInpaintingPromptContract({
      image: makeImageAsset({ width: 1920, height: 1080 }),
    });
    expect(result.systemPrompt).toContain("Layout requirements:");
    expect(result.systemPrompt).toContain("1920x1080px");
    expect(result.systemPrompt).toContain("Preserve the original framing");
  });
});

// ── buildEnhancementPromptContract ──────────────────────────────────────

describe("buildEnhancementPromptContract", () => {
  it("builds auto-enhance prompt contract", () => {
    const result = buildEnhancementPromptContract({
      operation: "auto-enhance",
      sourceImage: makeImageAsset({ width: 800, height: 600 }),
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    expect(result.globalSystemInstruction).toContain("enhancement assistant");
    expect(result.toolWorkflowInstruction).toContain("Enhance the source image");
    expect(result.toolWorkflowInstruction).toContain("lighting, color balance");
    expect(result.combinedPrompt).toContain("Global system instruction:");
    expect(result.combinedPrompt).toContain("Tool workflow instruction:");
    expect(result.combinedPrompt).toContain("User instruction:");
  });

  it("builds upscale prompt contract with size guidance", () => {
    const result = buildEnhancementPromptContract({
      operation: "upscale",
      sourceImage: makeImageAsset({ width: 400, height: 300 }),
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    expect(result.toolWorkflowInstruction).toContain("higher resolution");
    expect(result.toolWorkflowInstruction).toContain("800x600px");
  });

  it("builds style-transfer prompt contract with embedded references", () => {
    const result = buildEnhancementPromptContract({
      operation: "style-transfer",
      sourceImage: makeImageAsset(),
      referenceImages: [makeImageAsset()],
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    expect(result.toolWorkflowInstruction).toContain("reference image");
    expect(result.toolWorkflowInstruction).toContain("Transfer the visual style");
  });

  it("builds style-transfer with text-only-hint transport", () => {
    const result = buildEnhancementPromptContract({
      operation: "style-transfer",
      sourceImage: makeImageAsset(),
      referenceImages: [makeImageAsset(), makeImageAsset()],
      targetSize: { width: 800, height: 600 },
      referenceTransport: "text-only-hint",
      buildSizeGuidance,
    });
    expect(result.toolWorkflowInstruction).toContain("2 reference images");
    expect(result.toolWorkflowInstruction).toContain("only receives the source image and this text instruction");
  });

  it("builds style-transfer without references falls back to generic style prompt", () => {
    const result = buildEnhancementPromptContract({
      operation: "style-transfer",
      sourceImage: makeImageAsset(),
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    expect(result.toolWorkflowInstruction).toContain("Apply a stylized look");
  });

  it("includes custom prompt in userInstruction", () => {
    const result = buildEnhancementPromptContract({
      operation: "auto-enhance",
      customPrompt: "Make it warmer",
      sourceImage: makeImageAsset(),
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    expect(result.userInstruction).toBe("Make it warmer");
    expect(result.combinedPrompt).toContain("Make it warmer");
  });

  it("produces empty userInstruction when no custom prompt", () => {
    const result = buildEnhancementPromptContract({
      operation: "auto-enhance",
      sourceImage: makeImageAsset(),
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    expect(result.userInstruction).toBe("");
  });

  it("combinedPrompt contains all three sections in order", () => {
    const result = buildEnhancementPromptContract({
      operation: "denoise",
      customPrompt: "Light denoise",
      sourceImage: makeImageAsset(),
      targetSize: { width: 800, height: 600 },
      referenceTransport: "embedded-images",
      buildSizeGuidance,
    });
    const global = result.combinedPrompt.indexOf("Global system instruction:");
    const tool = result.combinedPrompt.indexOf("Tool workflow instruction:");
    const user = result.combinedPrompt.indexOf("User instruction:");
    expect(global).toBeLessThan(tool);
    expect(tool).toBeLessThan(user);
  });
});
