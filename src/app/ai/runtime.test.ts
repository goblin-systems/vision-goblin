import { describe, expect, it, vi } from "vitest";
import { getDefaultSettings } from "../../settings";
import { createAiPlatformRuntime } from "./runtime";
import type { AiGenerationTask } from "./types";

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
});
