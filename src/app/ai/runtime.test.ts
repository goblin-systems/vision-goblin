import { describe, expect, it, vi } from "vitest";
import { getDefaultSettings } from "../../settings";
import { createAiPlatformRuntime } from "./runtime";
import type { AiGenerationTask, AiInpaintingTask, AiTextReplacementTask } from "./types";

describe("AI platform runtime", () => {
  it("validates an OpenAI compatible endpoint", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gpt-4.1-mini" }, { id: "gpt-image-1" }] }),
    }));

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => "secret",
      fetch: fetchMock,
    });

    const result = await runtime.validateProvider("openai-compatible");

    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("fails validation locally when the provider key is missing", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";

    const fetchMock = vi.fn();

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => null,
      fetch: fetchMock,
    });

    const result = await runtime.validateProvider("openai-compatible");

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Store an API key for the OpenAI compatible provider before validating it.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails task execution locally when the provider key is missing", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";
    settings.ai.routing.generation.primaryProviderId = "openai-compatible";
    settings.ai.routing.generation.fallbackProviderIds = [];

    const fetchMock = vi.fn();

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => null,
      fetch: fetchMock,
    });

    const task: AiGenerationTask = {
      id: "task-generation-2",
      family: "generation",
      prompt: "A goblin guarding a keychain",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    const result = await runtime.executeTask({ task });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing-key execution failure.");
    }
    expect(result.response.error.message).toBe("Store an API key for the OpenAI compatible provider before using it.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a Gemini endpoint", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers.gemini.enabled = true;
    settings.ai.providers.gemini.endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gemini-2.0-flash" }, { id: "gemini-2.0-flash-exp" }] }),
    }));

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => "gemini-api-key",
      fetch: fetchMock,
    });

    const result = await runtime.validateProvider("gemini");

    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);
    expect(result.providerName).toBe("Google Gemini");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer gemini-api-key" }),
      }),
    );
  });

  it("fails task execution locally when the Gemini key is missing", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers.gemini.enabled = true;
    settings.ai.providers.gemini.endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";
    settings.ai.routing.generation.primaryProviderId = "gemini";
    settings.ai.routing.generation.fallbackProviderIds = [];

    const fetchMock = vi.fn();

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => null,
      fetch: fetchMock,
    });

    const task: AiGenerationTask = {
      id: "task-generation-gemini-1",
      family: "generation",
      prompt: "A goblin guarding a keychain",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    const result = await runtime.executeTask({ task });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing-key execution failure.");
    }
    expect(result.response.error.message).toBe("Store an API key for Google Gemini before using it.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists both providers", () => {
    const settings = getDefaultSettings();
    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => null,
    });

    const providers = runtime.listProviders();
    const ids = providers.map((p) => p.id);

    expect(ids).toContain("openai-compatible");
    expect(ids).toContain("gemini");
    expect(providers).toHaveLength(2);
  });

  it("passes the runtime logger through to providers without logging secrets", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";
    settings.ai.routing.generation.primaryProviderId = "openai-compatible";
    settings.ai.routing.generation.fallbackProviderIds = [];

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        created: "gen-runtime-log",
        model: "gpt-image-1",
        data: [{ b64_json: "AAAA" }],
      }),
    }));
    const logMock = vi.fn();

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => "super-secret-key",
      fetch: fetchMock,
      log: logMock,
    });

    const task: AiGenerationTask = {
      id: "runtime-log-task",
      family: "generation",
      prompt: "A runtime logged goblin",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    const result = await runtime.executeTask({ task });

    expect(result.ok).toBe(true);
    expect(logMock).toHaveBeenCalled();
    const messages = logMock.mock.calls.map(([message]) => String(message));
    expect(messages.some((message) => message.includes("A runtime logged goblin"))).toBe(true);
    expect(messages.some((message) => message.includes("super-secret-key"))).toBe(false);
  });

  it("honors fallbackPolicy=forbid by not trying fallback providers", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers.gemini.enabled = true;
    settings.ai.providers.gemini.endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";
    settings.ai.routing.generation.primaryProviderId = "gemini";
    settings.ai.routing.generation.fallbackProviderIds = ["openai-compatible"];

    const fetchMock = vi.fn();
    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async (providerId) => providerId === "gemini" ? null : "secret",
      fetch: fetchMock,
    });

    const task: AiGenerationTask = {
      id: "task-generation-primary-only",
      family: "generation",
      prompt: "A goblin guarding a keychain",
      options: { width: 512, height: 512, imageCount: 1 },
    };

    const result = await runtime.executeTask({ task, fallbackPolicy: "forbid" });

    expect(result.ok).toBe(false);
    expect(result.attemptedProviderIds).toEqual(["gemini"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures provider inspection payloads on successful execution", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";
    settings.ai.routing.captioning.primaryProviderId = "openai-compatible";
    settings.ai.routing.captioning.fallbackProviderIds = [];

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "resp_1", model: "gpt-4.1-mini", output_text: "caption text" }),
    }));

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => "secret",
      fetch: fetchMock,
    });

    const result = await runtime.executeTask({
      task: {
        id: "cap-1",
        family: "captioning",
        prompt: "describe image",
        input: { image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,AAAA" } },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.response.inspection?.request?.prompt).toBe("describe image");
    expect(result.response.inspection?.response?.rawPayload).toEqual({ id: "resp_1", model: "gpt-4.1-mini", output_text: "caption text" });
  });

  it("routes preferredModel from settings to the Gemini provider for text-replacement tasks", async () => {
    const settings = getDefaultSettings();
    settings.ai.providers.gemini.enabled = true;
    settings.ai.providers.gemini.endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";
    settings.ai.routing["text-replacement"].primaryProviderId = "gemini";
    settings.ai.routing["text-replacement"].preferredModel = "gemini-2.0-flash-exp";

    const jsonPayload = '{"schemaVersion":"f4.2/v1","blocks":[]}';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: "REPLACED" } },
              { text: jsonPayload },
            ],
            role: "model",
          },
          finishReason: "STOP",
        }],
      }),
    }));

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => "gemini-api-key",
      fetch: fetchMock,
    });

    const task: AiTextReplacementTask = {
      id: "task-txr-model-route",
      family: "text-replacement",
      prompt: "Replace text with routing test",
      input: {
        image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,SOURCE", width: 512, height: 512 },
        mask: { kind: "mask", mimeType: "image/png", data: "data:image/png;base64,MASK", width: 512, height: 512 },
      },
    };

    const result = await runtime.executeTask({ task });

    expect(result.ok).toBe(true);
    // Verify the preferred model was used in the native endpoint URL.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("honours plannedProviderId and plannedModel overrides instead of route settings", async () => {
    const settings = getDefaultSettings();
    // Route inpainting to openai-compatible with a specific model – the override should bypass this.
    settings.ai.providers["openai-compatible"].enabled = true;
    settings.ai.providers["openai-compatible"].endpoint = "https://example.test/v1";
    settings.ai.routing.inpainting.primaryProviderId = "openai-compatible";
    settings.ai.routing.inpainting.preferredModel = "gpt-image-1";
    // Also enable gemini so the override can resolve it.
    settings.ai.providers.gemini.enabled = true;
    settings.ai.providers.gemini.endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";

    const jsonPayload = '{"schemaVersion":"f4.2/v1","blocks":[]}';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: "REPLACED" } },
              { text: jsonPayload },
            ],
            role: "model",
          },
          finishReason: "STOP",
        }],
      }),
    }));

    const runtime = createAiPlatformRuntime({
      getSettings: () => settings.ai,
      getProviderSecret: async () => "gemini-api-key",
      fetch: fetchMock,
    });

    const task: AiInpaintingTask = {
      id: "task-override-test",
      family: "inpainting",
      prompt: "Override routing test",
      input: {
        image: { kind: "image", mimeType: "image/png", data: "data:image/png;base64,SOURCE", width: 512, height: 512 },
        mask: { kind: "mask", mimeType: "image/png", data: "data:image/png;base64,MASK", width: 512, height: 512 },
      },
    };

    const result = await runtime.executeTask({
      task,
      plannedProviderId: "gemini",
      plannedModel: "gemini-2.5-flash-image",
    });

    expect(result.ok).toBe(true);
    // The request must hit the gemini endpoint with the overridden model, not the
    // openai-compatible endpoint configured in inpainting route settings.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
