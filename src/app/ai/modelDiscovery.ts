import type { AiProviderId, AiSettings } from "./config";
import type { AiTaskFamily } from "./types";
import { classifyOpenAiModel, getOpenAiModelDisplayName } from "./modelHints";

// ─── Public types ──────────────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  displayName: string;
  providerId: AiProviderId;
  capabilities: readonly AiTaskFamily[];
}

export interface ModelDiscoveryResult {
  ok: boolean;
  providerId: AiProviderId;
  models: DiscoveredModel[];
  error?: string;
  fetchedAt: string;
}

export interface ModelDiscoveryService {
  /** Fetch models for a specific provider; uses session cache if available. */
  discoverModels(providerId: AiProviderId, signal?: AbortSignal): Promise<ModelDiscoveryResult>;
  /** Get cached models for a provider, or null if not yet fetched. */
  getCachedModels(providerId: AiProviderId): ModelDiscoveryResult | null;
  /** Get cached models for a provider filtered by task family capability. */
  getModelsForFamily(providerId: AiProviderId, family: AiTaskFamily): DiscoveredModel[];
  /** Clear the cache for one or all providers. */
  clearCache(providerId?: AiProviderId): void;
}

// ─── Factory options ───────────────────────────────────────────────────

interface RuntimeFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type RuntimeFetch = (input: string, init?: RequestInit) => Promise<RuntimeFetchResponse>;

type LogLevel = "INFO" | "WARN" | "ERROR";

export interface ModelDiscoveryOptions {
  getSettings: () => AiSettings;
  getProviderSecret: (providerId: AiProviderId) => Promise<string | null>;
  fetch?: RuntimeFetch;
  log?: (message: string, level?: LogLevel) => void;
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createModelDiscoveryService(options: ModelDiscoveryOptions): ModelDiscoveryService {
  const fetchImpl = options.fetch ?? defaultFetch;
  const log = options.log;
  const cache = new Map<AiProviderId, ModelDiscoveryResult>();

  return {
    async discoverModels(providerId, signal) {
      const cached = cache.get(providerId);
      if (cached) {
        return cached;
      }

      const settings = options.getSettings();
      const providerSettings = settings.providers[providerId];

      if (!providerSettings.enabled) {
        const result = failureResult(providerId, `Provider "${providerId}" is not enabled.`);
        log?.(`Model discovery skipped for ${providerId}: provider not enabled.`, "WARN");
        return result;
      }

      const endpoint = providerSettings.endpoint.trim();
      if (!endpoint) {
        const result = failureResult(providerId, `No endpoint configured for provider "${providerId}".`);
        log?.(`Model discovery skipped for ${providerId}: no endpoint configured.`, "WARN");
        return result;
      }

      let secret: string | null;
      try {
        secret = await options.getProviderSecret(providerId);
      } catch (error) {
        const message = `Failed to read API key for provider "${providerId}".`;
        log?.(`Model discovery failed for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
        return failureResult(providerId, message);
      }

      if (!hasSecret(secret)) {
        const message = `No API key stored for provider "${providerId}".`;
        log?.(`Model discovery skipped for ${providerId}: no API key.`, "WARN");
        return failureResult(providerId, message);
      }

      try {
        const result = providerId === "gemini"
          ? await fetchGeminiModels(endpoint, secret, providerId, fetchImpl, signal)
          : await fetchOpenAiModels(endpoint, secret, providerId, fetchImpl, signal);

        if (result.ok) {
          cache.set(providerId, result);
          log?.(`Model discovery for ${providerId}: found ${result.models.length} models.`, "INFO");
        } else {
          log?.(`Model discovery failed for ${providerId}: ${result.error}`, "WARN");
        }
        return result;
      } catch (error) {
        const message = `Model discovery failed for "${providerId}": ${toErrorMessage(error)}`;
        log?.(`Model discovery error for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
        return failureResult(providerId, message);
      }
    },

    getCachedModels(providerId) {
      return cache.get(providerId) ?? null;
    },

    getModelsForFamily(providerId, family) {
      const cached = cache.get(providerId);
      if (!cached || !cached.ok) {
        return [];
      }
      return cached.models.filter((model) => model.capabilities.includes(family));
    },

    clearCache(providerId) {
      if (providerId) {
        cache.delete(providerId);
      } else {
        cache.clear();
      }
    },
  };
}

// ─── OpenAI-compatible fetching ────────────────────────────────────────

interface OpenAiModelEntry {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface OpenAiModelsResponse {
  data: OpenAiModelEntry[];
}

async function fetchOpenAiModels(
  endpoint: string,
  apiKey: string,
  providerId: AiProviderId,
  fetchImpl: RuntimeFetch,
  signal?: AbortSignal,
): Promise<ModelDiscoveryResult> {
  const url = `${endpoint.replace(/\/$/, "")}/models`;
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = extractErrorMessage(payload, response.status);
    return failureResult(providerId, message);
  }

  const payload = (await response.json()) as OpenAiModelsResponse;
  const entries = Array.isArray(payload.data) ? payload.data : [];

  const models: DiscoveredModel[] = entries.map((entry) => ({
    id: entry.id,
    displayName: getOpenAiModelDisplayName(entry.id),
    providerId,
    capabilities: classifyOpenAiModel(entry.id),
  }));

  return {
    ok: true,
    providerId,
    models,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Gemini fetching ───────────────────────────────────────────────────

interface GeminiModelEntry {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsResponse {
  models: GeminiModelEntry[];
}

async function fetchGeminiModels(
  endpoint: string,
  apiKey: string,
  providerId: AiProviderId,
  fetchImpl: RuntimeFetch,
  signal?: AbortSignal,
): Promise<ModelDiscoveryResult> {
  const baseUrl = stripGeminiOpenAiSuffix(endpoint);
  const url = `${baseUrl}/models?key=${apiKey}`;
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = extractErrorMessage(payload, response.status);
    return failureResult(providerId, message);
  }

  const payload = (await response.json()) as GeminiModelsResponse;
  const entries = Array.isArray(payload.models) ? payload.models : [];

  const models: DiscoveredModel[] = entries.map((entry) => ({
    id: stripGeminiModelPrefix(entry.name),
    displayName: entry.displayName ?? stripGeminiModelPrefix(entry.name),
    providerId,
    capabilities: classifyGeminiModel(entry.supportedGenerationMethods ?? []),
  }));

  return {
    ok: true,
    providerId,
    models,
    fetchedAt: new Date().toISOString(),
  };
}

function classifyGeminiModel(methods: string[]): readonly AiTaskFamily[] {
  const families: AiTaskFamily[] = [];

  const hasGenerateContent = methods.includes("generateContent");
  const hasGenerateImages = methods.includes("generateImages");

  if (hasGenerateContent) {
    families.push("captioning", "segmentation", "generation", "inpainting", "enhancement");
  } else if (hasGenerateImages) {
    families.push("generation", "inpainting", "enhancement");
  }

  return families;
}

/**
 * Strip the `/openai` suffix from the Gemini OAI-compatible endpoint
 * to get the native Gemini API base URL.
 *
 * Example: `https://generativelanguage.googleapis.com/v1beta/openai`
 *       → `https://generativelanguage.googleapis.com/v1beta`
 */
function stripGeminiOpenAiSuffix(endpoint: string): string {
  return endpoint.replace(/\/openai\/?$/, "");
}

/** Strip the `models/` prefix from Gemini model names. */
function stripGeminiModelPrefix(name: string): string {
  return name.replace(/^models\//, "");
}

// ─── Shared helpers ────────────────────────────────────────────────────

function failureResult(providerId: AiProviderId, error: string): ModelDiscoveryResult {
  return {
    ok: false,
    providerId,
    models: [],
    error,
    fetchedAt: new Date().toISOString(),
  };
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) {
      return error.message;
    }
  }
  return `Provider request failed with status ${status}.`;
}

function hasSecret(secret: string | null): secret is string {
  return typeof secret === "string" && secret.trim().length > 0;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultFetch(input: string, init?: RequestInit): Promise<RuntimeFetchResponse> {
  return fetch(input, init);
}
