import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, defaultModelForFamily, isAiProviderId, normalizeAiSettings } from "./config";

describe("normalizeAiSettings", () => {
  it("migrates stub-local primaryProviderId to openai-compatible", () => {
    const persisted = {
      showEstimatedCosts: true,
      providers: {
        "stub-local": { enabled: true, endpoint: "" },
        "openai-compatible": { enabled: false, endpoint: "https://api.openai.com/v1" },
      },
      routing: {
        generation: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "gpt-image-1" },
        captioning: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "gpt-4.1-mini" },
        segmentation: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
        inpainting: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
        enhancement: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
      },
    };

    const result = normalizeAiSettings(persisted);

    for (const family of Object.keys(result.routing) as (keyof typeof result.routing)[]) {
      expect(result.routing[family].primaryProviderId).toBe("openai-compatible");
    }
  });

  it("strips stub-local from fallbackProviderIds", () => {
    const persisted = {
      showEstimatedCosts: true,
      providers: {
        "openai-compatible": { enabled: true, endpoint: "https://api.openai.com/v1" },
      },
      routing: {
        generation: {
          primaryProviderId: "openai-compatible",
          fallbackProviderIds: ["stub-local", "openai-compatible"],
          preferredModel: "gpt-image-1",
        },
        captioning: {
          primaryProviderId: "openai-compatible",
          fallbackProviderIds: ["stub-local"],
          preferredModel: "gpt-4.1-mini",
        },
        segmentation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        inpainting: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        enhancement: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.routing.generation.fallbackProviderIds).toEqual([]);
    expect(result.routing.captioning.fallbackProviderIds).toEqual([]);
  });

  it("does not crash when persisted data contains a stub-local provider entry", () => {
    const persisted = {
      showEstimatedCosts: false,
      providers: {
        "stub-local": { enabled: true, endpoint: "" },
        "openai-compatible": { enabled: true, endpoint: "https://custom.test/v1" },
      },
      routing: {
        generation: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
        captioning: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        segmentation: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
        inpainting: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
        enhancement: { primaryProviderId: "stub-local", fallbackProviderIds: [], preferredModel: "" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.showEstimatedCosts).toBe(false);
    expect(result.providers["openai-compatible"].endpoint).toBe("https://custom.test/v1");
    expect(result.routing.generation.primaryProviderId).toBe("openai-compatible");
  });

  it("preserves valid openai-compatible settings through migration", () => {
    const persisted = {
      showEstimatedCosts: false,
      providers: {
        "openai-compatible": { enabled: true, endpoint: "https://my-server.test/v1" },
      },
      routing: {
        generation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "dall-e-3" },
        captioning: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4.1-mini" },
        segmentation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        inpainting: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        enhancement: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.showEstimatedCosts).toBe(false);
    expect(result.providers["openai-compatible"].enabled).toBe(true);
    expect(result.providers["openai-compatible"].endpoint).toBe("https://my-server.test/v1");
    expect(result.routing.generation.primaryProviderId).toBe("openai-compatible");
    expect(result.routing.generation.preferredModel).toBe("dall-e-3");
    expect(result.routing.captioning.preferredModel).toBe("gpt-4.1-mini");
  });

  it("defaults produce openai-compatible as the primary provider", () => {
    expect(DEFAULT_AI_SETTINGS.routing.generation.primaryProviderId).toBe("openai-compatible");
    expect(DEFAULT_AI_SETTINGS.routing.captioning.primaryProviderId).toBe("openai-compatible");
  });

  it("clears stub- prefixed model names during migration", () => {
    const persisted = {
      showEstimatedCosts: true,
      providers: {
        "openai-compatible": { enabled: true, endpoint: "https://api.openai.com/v1" },
      },
      routing: {
        generation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "stub-deterministic-v1" },
        captioning: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "stub-caption-v1" },
        segmentation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "stub-seg-v1" },
        inpainting: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "stub-inpaint-v1" },
        enhancement: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "stub-enhance-v1" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.routing.generation.preferredModel).toBe(defaultModelForFamily("generation"));
    expect(result.routing.captioning.preferredModel).toBe(defaultModelForFamily("captioning"));
    expect(result.routing.segmentation.preferredModel).toBe(defaultModelForFamily("segmentation"));
    expect(result.routing.inpainting.preferredModel).toBe(defaultModelForFamily("inpainting"));
    expect(result.routing.enhancement.preferredModel).toBe(defaultModelForFamily("enhancement"));
  });

  it("preserves non-stub model names during migration", () => {
    const persisted = {
      showEstimatedCosts: true,
      providers: {
        "openai-compatible": { enabled: true, endpoint: "https://api.openai.com/v1" },
      },
      routing: {
        generation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "dall-e-3" },
        captioning: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4.1-mini" },
        segmentation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4o" },
        inpainting: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4o" },
        enhancement: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4o" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.routing.generation.preferredModel).toBe("dall-e-3");
    expect(result.routing.captioning.preferredModel).toBe("gpt-4.1-mini");
    expect(result.routing.segmentation.preferredModel).toBe("gpt-4o");
    expect(result.routing.inpainting.preferredModel).toBe("gpt-4o");
    expect(result.routing.enhancement.preferredModel).toBe("gpt-4o");
  });
});

describe("defaultModelForFamily", () => {
  it("returns gpt-image-1 for generation", () => {
    expect(defaultModelForFamily("generation")).toBe("gpt-image-1");
  });

  it("returns gpt-4o for inpainting", () => {
    expect(defaultModelForFamily("inpainting")).toBe("gpt-4o");
  });

  it("returns gpt-4o for enhancement", () => {
    expect(defaultModelForFamily("enhancement")).toBe("gpt-4o");
  });

  it("returns gpt-4.1-mini for segmentation", () => {
    expect(defaultModelForFamily("segmentation")).toBe("gpt-4.1-mini");
  });

  it("returns gpt-4.1-mini for captioning", () => {
    expect(defaultModelForFamily("captioning")).toBe("gpt-4.1-mini");
  });
});

describe("isAiProviderId", () => {
  it("returns true for openai-compatible", () => {
    expect(isAiProviderId("openai-compatible")).toBe(true);
  });

  it("returns true for gemini", () => {
    expect(isAiProviderId("gemini")).toBe(true);
  });

  it("returns false for unknown provider ids", () => {
    expect(isAiProviderId("stub-local")).toBe(false);
    expect(isAiProviderId("")).toBe(false);
    expect(isAiProviderId(42)).toBe(false);
    expect(isAiProviderId(null)).toBe(false);
  });
});

describe("normalizeAiSettings — gemini provider", () => {
  it("defaults gemini settings when not present in persisted data", () => {
    const persisted = {
      showEstimatedCosts: true,
      providers: {
        "openai-compatible": { enabled: true, endpoint: "https://api.openai.com/v1" },
      },
      routing: {
        generation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-image-1" },
        captioning: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4.1-mini" },
        segmentation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        inpainting: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        enhancement: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.providers.gemini).toEqual({
      enabled: false,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    });
  });

  it("preserves valid gemini settings from persisted data", () => {
    const persisted = {
      showEstimatedCosts: false,
      providers: {
        "openai-compatible": { enabled: true, endpoint: "https://api.openai.com/v1" },
        gemini: { enabled: true, endpoint: "https://custom-gemini.test/v1" },
      },
      routing: {
        generation: { primaryProviderId: "gemini", fallbackProviderIds: ["openai-compatible"], preferredModel: "gemini-2.0-flash-exp" },
        captioning: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "gpt-4.1-mini" },
        segmentation: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        inpainting: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
        enhancement: { primaryProviderId: "openai-compatible", fallbackProviderIds: [], preferredModel: "" },
      },
    };

    const result = normalizeAiSettings(persisted);

    expect(result.providers.gemini.enabled).toBe(true);
    expect(result.providers.gemini.endpoint).toBe("https://custom-gemini.test/v1");
    expect(result.routing.generation.primaryProviderId).toBe("gemini");
    expect(result.routing.generation.fallbackProviderIds).toEqual(["openai-compatible"]);
    expect(result.routing.generation.preferredModel).toBe("gemini-2.0-flash-exp");
  });

  it("includes gemini in DEFAULT_AI_SETTINGS providers", () => {
    expect(DEFAULT_AI_SETTINGS.providers.gemini).toEqual({
      enabled: false,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    });
  });
});
