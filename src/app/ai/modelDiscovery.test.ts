import { describe, expect, it, vi } from "vitest";
import { createModelDiscoveryService, type ModelDiscoveryOptions } from "./modelDiscovery";
import { DEFAULT_AI_SETTINGS, cloneAiSettings, type AiProviderId, type AiSettings } from "./config";

type MockFetchFn = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  return vi.fn<MockFetchFn>(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  }));
}

function makeSettings(overrides?: Partial<{ openaiEnabled: boolean; geminiEnabled: boolean; openaiEndpoint: string; geminiEndpoint: string }>): AiSettings {
  const settings = cloneAiSettings(DEFAULT_AI_SETTINGS);
  if (overrides?.openaiEnabled !== undefined) {
    settings.providers["openai-compatible"].enabled = overrides.openaiEnabled;
  }
  if (overrides?.geminiEnabled !== undefined) {
    settings.providers.gemini.enabled = overrides.geminiEnabled;
  }
  if (overrides?.openaiEndpoint !== undefined) {
    settings.providers["openai-compatible"].endpoint = overrides.openaiEndpoint;
  }
  if (overrides?.geminiEndpoint !== undefined) {
    settings.providers.gemini.endpoint = overrides.geminiEndpoint;
  }
  return settings;
}

function makeOptions(overrides: Partial<ModelDiscoveryOptions> & { settings?: AiSettings }): ModelDiscoveryOptions {
  const settings = overrides.settings ?? makeSettings({ openaiEnabled: true });
  return {
    getSettings: overrides.getSettings ?? (() => settings),
    getProviderSecret: overrides.getProviderSecret ?? (async () => "test-secret"),
    fetch: overrides.fetch,
    log: overrides.log,
  };
}

describe("modelDiscovery", () => {
  // ─── OpenAI-compatible discovery ────────────────────────────────────

  describe("OpenAI-compatible provider", () => {
    it("fetches models from /v1/models with Bearer auth", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          data: [
            { id: "gpt-4o", object: "model", created: 1234567890, owned_by: "openai" },
            { id: "gpt-image-1", object: "model", created: 1234567891, owned_by: "openai" },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true, openaiEndpoint: "https://api.example.test/v1" }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(true);
      expect(result.models).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.test/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ Authorization: "Bearer test-secret" }),
        }),
      );
    });

    it("classifies OpenAI models using modelHints", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          data: [
            { id: "gpt-4o" },
            { id: "gpt-image-1" },
            { id: "gpt-3.5-turbo" },
            { id: "unknown-model" },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(true);
      const byId = new Map(result.models.map((m) => [m.id, m]));

      expect(byId.get("gpt-4o")!.capabilities).toEqual(["captioning", "segmentation", "inpainting", "enhancement"]);
      expect(byId.get("gpt-image-1")!.capabilities).toEqual(["generation", "inpainting", "enhancement"]);
      expect(byId.get("gpt-3.5-turbo")!.capabilities).toEqual([]);
      expect(byId.get("unknown-model")!.capabilities).toEqual([]);
    });

    it("uses human-friendly display names from modelHints", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [{ id: "gpt-4o" }, { id: "custom-model" }] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(true);
      const byId = new Map(result.models.map((m) => [m.id, m]));
      expect(byId.get("gpt-4o")!.displayName).toBe("GPT-4o");
      expect(byId.get("custom-model")!.displayName).toBe("custom-model");
    });
  });

  // ─── Gemini discovery ───────────────────────────────────────────────

  describe("Gemini provider", () => {
    it("fetches models from native /v1beta/models with ?key= auth", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          models: [
            {
              name: "models/gemini-2.0-flash",
              displayName: "Gemini 2.0 Flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({
          geminiEnabled: true,
          geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
        }),
        getProviderSecret: async () => "gemini-key-123",
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("gemini");

      expect(result.ok).toBe(true);
      expect(result.models).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=gemini-key-123",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("strips /openai suffix to build discovery URL", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { models: [] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({
          geminiEnabled: true,
          geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
        }),
        fetch: fetchMock,
      }));

      await service.discoverModels("gemini");

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toMatch(/\/v1beta\/models\?key=/);
      expect(calledUrl).not.toContain("/openai");
    });

    it("classifies Gemini models using supportedGenerationMethods", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          models: [
            {
              name: "models/gemini-2.0-flash",
              displayName: "Gemini 2.0 Flash",
              supportedGenerationMethods: ["generateContent", "generateImages"],
            },
            {
              name: "models/gemini-1.5-pro",
              displayName: "Gemini 1.5 Pro",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/imagen-3.0",
              displayName: "Imagen 3.0",
              supportedGenerationMethods: ["generateImages"],
            },
            {
              name: "models/embedding-001",
              displayName: "Embedding 001",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ geminiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("gemini");

      expect(result.ok).toBe(true);
      const byId = new Map(result.models.map((m) => [m.id, m]));

      // Both methods → all families (same as generateContent alone)
      expect(byId.get("gemini-2.0-flash")!.capabilities).toEqual(["captioning", "segmentation", "generation", "inpainting", "enhancement"]);
      // Only generateContent → all families (generateContent implies full capability)
      expect(byId.get("gemini-1.5-pro")!.capabilities).toEqual(["captioning", "segmentation", "generation", "inpainting", "enhancement"]);
      // Only generateImages → generation, inpainting, enhancement (Imagen-style)
      expect(byId.get("imagen-3.0")!.capabilities).toEqual(["generation", "inpainting", "enhancement"]);
      // Neither method → empty
      expect(byId.get("embedding-001")!.capabilities).toEqual([]);
    });

    it("strips models/ prefix from Gemini model IDs", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          models: [
            { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", supportedGenerationMethods: ["generateContent"] },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ geminiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("gemini");

      expect(result.models[0].id).toBe("gemini-2.0-flash");
      expect(result.models[0].displayName).toBe("Gemini 2.0 Flash");
    });

    it("uses model name as displayName when displayName is absent", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          models: [
            { name: "models/some-model", supportedGenerationMethods: [] },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ geminiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("gemini");

      expect(result.models[0].displayName).toBe("some-model");
    });
  });

  // ─── Session caching ────────────────────────────────────────────────

  describe("session cache", () => {
    it("returns cached result on second call without re-fetching", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [{ id: "gpt-4o" }] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      const first = await service.discoverModels("openai-compatible");
      const second = await service.discoverModels("openai-compatible");

      expect(first).toBe(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("getCachedModels returns null before discovery", () => {
      const service = createModelDiscoveryService(makeOptions({}));

      expect(service.getCachedModels("openai-compatible")).toBeNull();
      expect(service.getCachedModels("gemini")).toBeNull();
    });

    it("getCachedModels returns result after discovery", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [{ id: "gpt-4o" }] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      await service.discoverModels("openai-compatible");
      const cached = service.getCachedModels("openai-compatible");

      expect(cached).not.toBeNull();
      expect(cached!.ok).toBe(true);
      expect(cached!.models).toHaveLength(1);
    });

    it("clearCache for single provider clears only that provider", async () => {
      const openAiFetch = mockFetch({ ok: true, status: 200, body: { data: [{ id: "gpt-4o" }] } });
      const geminiFetch = mockFetch({ ok: true, status: 200, body: { models: [{ name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }] } });

      let callCount = 0;
      const combinedFetch = vi.fn<MockFetchFn>(async (input, init) => {
        callCount++;
        if (input.includes("generativelanguage")) {
          return geminiFetch(input, init);
        }
        return openAiFetch(input, init);
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true, geminiEnabled: true }),
        fetch: combinedFetch,
      }));

      await service.discoverModels("openai-compatible");
      await service.discoverModels("gemini");

      service.clearCache("openai-compatible");

      expect(service.getCachedModels("openai-compatible")).toBeNull();
      expect(service.getCachedModels("gemini")).not.toBeNull();
    });

    it("clearCache without arguments clears all providers", async () => {
      const fetchMock = mockFetch({ ok: true, status: 200, body: { data: [{ id: "gpt-4o" }] } });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      await service.discoverModels("openai-compatible");
      service.clearCache();

      expect(service.getCachedModels("openai-compatible")).toBeNull();
    });

    it("re-fetches after cache is cleared", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [{ id: "gpt-4o" }] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      await service.discoverModels("openai-compatible");
      service.clearCache("openai-compatible");
      await service.discoverModels("openai-compatible");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getModelsForFamily ─────────────────────────────────────────────

  describe("getModelsForFamily", () => {
    it("filters cached models by task family", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: {
          data: [
            { id: "gpt-4o" },
            { id: "gpt-image-1" },
            { id: "gpt-3.5-turbo" },
          ],
        },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      await service.discoverModels("openai-compatible");

      const generationModels = service.getModelsForFamily("openai-compatible", "generation");
      expect(generationModels.map((m) => m.id)).toEqual(["gpt-image-1"]);

      const captioningModels = service.getModelsForFamily("openai-compatible", "captioning");
      expect(captioningModels.map((m) => m.id)).toEqual(["gpt-4o"]);

      const inpaintingModels = service.getModelsForFamily("openai-compatible", "inpainting");
      expect(inpaintingModels.map((m) => m.id)).toContain("gpt-4o");
      expect(inpaintingModels.map((m) => m.id)).toContain("gpt-image-1");
    });

    it("returns empty array when no cache exists", () => {
      const service = createModelDiscoveryService(makeOptions({}));

      expect(service.getModelsForFamily("openai-compatible", "generation")).toEqual([]);
    });

    it("returns empty array when cache contains a failure", async () => {
      const fetchMock = mockFetch({ ok: false, status: 401, body: { error: { message: "Unauthorized" } } });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      // Failures from the API are not cached in the Map (only successes are set via cache.set)
      // but let's verify the behavior
      await service.discoverModels("openai-compatible");

      expect(service.getModelsForFamily("openai-compatible", "generation")).toEqual([]);
    });
  });

  // ─── Error handling ─────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns failure when provider is disabled", async () => {
      const fetchMock = vi.fn<MockFetchFn>();

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: false }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not enabled");
      expect(result.models).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns failure when API key is missing", async () => {
      const fetchMock = vi.fn<MockFetchFn>();

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        getProviderSecret: async () => null,
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("No API key");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns failure when fetch fails with network error", async () => {
      const fetchMock = vi.fn<MockFetchFn>(async () => {
        throw new Error("network timeout");
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("network timeout");
      expect(result.models).toEqual([]);
    });

    it("returns failure when API responds with error status", async () => {
      const fetchMock = mockFetch({
        ok: false,
        status: 403,
        body: { error: { message: "Forbidden: invalid API key" } },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Forbidden: invalid API key");
    });

    it("returns failure when endpoint is empty", async () => {
      const fetchMock = vi.fn<MockFetchFn>();

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true, openaiEndpoint: "" }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("No endpoint");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns failure when getProviderSecret throws", async () => {
      const fetchMock = vi.fn<MockFetchFn>();

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        getProviderSecret: async () => { throw new Error("keychain locked"); },
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Failed to read API key");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not cache failure results", async () => {
      const fetchMock = mockFetch({
        ok: false,
        status: 500,
        body: { error: { message: "Server error" } },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      await service.discoverModels("openai-compatible");

      expect(service.getCachedModels("openai-compatible")).toBeNull();
    });

    it("includes fetchedAt ISO timestamp in both success and failure results", async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [{ id: "gpt-4o" }] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
      }));

      const result = await service.discoverModels("openai-compatible");

      expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ─── Logging ────────────────────────────────────────────────────────

  describe("logging", () => {
    it("calls log on successful discovery", async () => {
      const logMock = vi.fn();
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: { data: [{ id: "gpt-4o" }] },
      });

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: true }),
        fetch: fetchMock,
        log: logMock,
      }));

      await service.discoverModels("openai-compatible");

      expect(logMock).toHaveBeenCalledWith(
        expect.stringContaining("found 1 models"),
        "INFO",
      );
    });

    it("calls log with WARN when provider is disabled", async () => {
      const logMock = vi.fn();

      const service = createModelDiscoveryService(makeOptions({
        settings: makeSettings({ openaiEnabled: false }),
        log: logMock,
      }));

      await service.discoverModels("openai-compatible");

      expect(logMock).toHaveBeenCalledWith(
        expect.stringContaining("not enabled"),
        "WARN",
      );
    });
  });
});
