import {
  createAiFailureResponse,
  normalizeAiTaskError,
  type AiDebugLogger,
  type AiProviderResponse,
  type AiTaskFailure,
  type AiTaskSuccess,
  type AiTaskUsage,
} from "./contracts";
import { createOpenAiCompatibleProvider } from "./providers/openAiCompatibleProvider";
import { createGeminiProvider } from "./providers/geminiProvider";
import { createAiProviderRegistry } from "./registry";
import type { AiTask, AiTaskFamily } from "./types";
import { AI_PROVIDER_IDS, type AiProviderId, type AiSettings } from "./config";

interface RuntimeFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type RuntimeFetch = (input: string, init?: RequestInit) => Promise<RuntimeFetchResponse>;

export interface AiProviderDescriptor {
  id: AiProviderId;
  displayName: string;
  supportedFamilies: readonly AiTaskFamily[];
  requiresSecureKey: boolean;
}

export interface AiValidationResult {
  ok: boolean;
  providerId: AiProviderId;
  providerName: string;
  message: string;
  checkedAt: string;
  modelCount?: number;
}

export interface AiRuntimeTaskRequest<TTask extends AiTask = AiTask> {
  task: TTask;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AiTaskExecutionResult<TTask extends AiTask = AiTask> {
  ok: boolean;
  attemptedProviderIds: AiProviderId[];
  primaryProviderId: AiProviderId;
  fallbackProviderIds: AiProviderId[];
  fallbackUsed: boolean;
  degradedMode: boolean;
  degradedMessage?: string;
  estimatedCostMessage?: string;
}

export interface AiTaskExecutionSuccess<TTask extends AiTask = AiTask> extends AiTaskExecutionResult<TTask> {
  ok: true;
  response: AiTaskSuccess<TTask>;
}

export interface AiTaskExecutionFailure<TTask extends AiTask = AiTask> extends AiTaskExecutionResult<TTask> {
  ok: false;
  response: AiTaskFailure<TTask>;
}

export type AiTaskExecutionOutcome<TTask extends AiTask = AiTask> = AiTaskExecutionSuccess<TTask> | AiTaskExecutionFailure<TTask>;

export interface AiPlatformRuntime {
  listProviders(): AiProviderDescriptor[];
  validateProvider(providerId: AiProviderId, signal?: AbortSignal): Promise<AiValidationResult>;
  executeTask<TTask extends AiTask>(request: AiRuntimeTaskRequest<TTask>): Promise<AiTaskExecutionOutcome<TTask>>;
}

export interface AiPlatformRuntimeOptions {
  getSettings: () => AiSettings;
  getProviderSecret: (providerId: AiProviderId) => Promise<string | null>;
  fetch?: RuntimeFetch;
  log?: AiDebugLogger;
}

const PROVIDERS: Record<AiProviderId, AiProviderDescriptor> = {
  "openai-compatible": {
    id: "openai-compatible",
    displayName: "OpenAI compatible",
    supportedFamilies: ["segmentation", "inpainting", "enhancement", "generation", "captioning"],
    requiresSecureKey: true,
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    supportedFamilies: ["segmentation", "inpainting", "enhancement", "generation", "captioning"],
    requiresSecureKey: true,
  },
};

export function createAiPlatformRuntime(options: AiPlatformRuntimeOptions): AiPlatformRuntime {
  const fetchImpl = options.fetch ?? defaultFetch;
  const log = options.log;

  return {
    listProviders() {
      return AI_PROVIDER_IDS.map((providerId) => PROVIDERS[providerId]);
    },
    async validateProvider(providerId, signal) {
      const settings = options.getSettings();
      const provider = settings.providers[providerId];
      const endpoint = provider.endpoint.trim();
      if (!endpoint) {
        return validationFailure(providerId, "Set an endpoint before testing the provider.");
      }

      try {
        const secret = await options.getProviderSecret(providerId);
        if (PROVIDERS[providerId].requiresSecureKey && !hasProviderSecret(secret)) {
          log?.(`AI validation blocked for ${providerId}: missing stored API key.`, "WARN");
          return validationFailure(providerId, missingProviderKeyMessage(providerId, "validating"));
        }
        const verifiedSecret = secret as string;
        const response = await fetchImpl(buildUrl(endpoint, "/models"), {
          method: "GET",
          signal,
          headers: buildRequestHeaders(verifiedSecret),
        });
        const payload = await response.json();
        if (!response.ok) {
          log?.(`AI validation failed for ${providerId}: ${extractProviderMessage(payload, response.status)}`, "WARN");
          return validationFailure(providerId, extractProviderMessage(payload, response.status));
        }

        const modelCount = Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data.length : undefined;
        return {
          ok: true,
          providerId,
          providerName: PROVIDERS[providerId].displayName,
          message: modelCount ? `Connected. ${modelCount} models reported by the endpoint.` : "Connected. Endpoint responded successfully.",
          checkedAt: new Date().toISOString(),
          modelCount,
        };
      } catch (error) {
        const normalized = normalizeAiTaskError(error, {
          code: "transport_error",
          message: "Unable to reach the provider endpoint.",
          retryable: true,
        });
        log?.(`AI validation failed for ${providerId}: ${normalized.message}`, "ERROR");
        return validationFailure(providerId, normalized.message);
      }
    },
    async executeTask(request) {
      const settings = options.getSettings();
      const route = settings.routing[request.task.family];
      const attemptedProviderIds: AiProviderId[] = [];
      const fallbackProviderIds = route.fallbackProviderIds.filter((providerId) => providerId !== route.primaryProviderId);
      const providerOrder = [route.primaryProviderId, ...fallbackProviderIds];
      const preferredModel = route.preferredModel.trim() || undefined;
      let lastFailure: AiTaskFailure<typeof request.task> | null = null;

      for (const providerId of providerOrder) {
        if (request.signal?.aborted) {
          break;
        }
        attemptedProviderIds.push(providerId);

        const adapter = await resolveProviderAdapter(providerId, settings, options.getProviderSecret, fetchImpl, log);
        if (!adapter.ok) {
          log?.(`AI task blocked for ${providerId}: ${adapter.message}`, "WARN");
          lastFailure = createConfigurationFailure(request.task, providerId, adapter.message);
          continue;
        }

        const registry = createAiProviderRegistry([adapter.adapter]);
        const response = await registry.execute({
          task: request.task,
          providerId,
          preferredModel,
          metadata: request.metadata,
          signal: request.signal,
        });

        if (response.ok) {
          const fallbackUsed: boolean = providerId !== route.primaryProviderId;
          const degradedMessage = fallbackUsed
            ? `Primary route failed. Vision Goblin continued with ${PROVIDERS[providerId].displayName}.`
            : undefined;
          const warnings = fallbackUsed && degradedMessage ? [...response.warnings, degradedMessage] : response.warnings;
          const success: AiTaskSuccess<typeof request.task> = warnings === response.warnings ? response : { ...response, warnings };

          return {
            ok: true,
            response: success,
            attemptedProviderIds,
            primaryProviderId: route.primaryProviderId,
            fallbackProviderIds,
            fallbackUsed,
            degradedMode: fallbackUsed,
            degradedMessage,
            estimatedCostMessage: formatEstimatedCostMessage(success.usage, settings.showEstimatedCosts),
          } satisfies AiTaskExecutionSuccess<typeof request.task>;
        }

        lastFailure = response;
        log?.(`AI task failed for ${providerId}: ${response.error.message}`, response.error.retryable ? "WARN" : "ERROR");
      }

      const failure = lastFailure ?? createConfigurationFailure(request.task, route.primaryProviderId, `No configured provider could run '${request.task.family}' tasks.`);
      const fallbackUsed = attemptedProviderIds.some((providerId) => providerId !== route.primaryProviderId);
      const warnings = attemptedProviderIds.length > 1
        ? [...failure.warnings, `Tried providers: ${attemptedProviderIds.join(", ")}.`]
        : failure.warnings;
      const response: AiTaskFailure<typeof request.task> = warnings === failure.warnings ? failure : { ...failure, warnings };

      return {
        ok: false,
        response,
        attemptedProviderIds,
        primaryProviderId: route.primaryProviderId,
        fallbackProviderIds,
        fallbackUsed,
        degradedMode: false,
      } satisfies AiTaskExecutionFailure<typeof request.task>;
    },
  };
}

async function resolveProviderAdapter(
  providerId: AiProviderId,
  settings: AiSettings,
  getProviderSecret: (providerId: AiProviderId) => Promise<string | null>,
  fetchImpl: RuntimeFetch,
  log?: AiDebugLogger,
): Promise<{ ok: true; adapter: import("./contracts").AiProviderAdapter } | { ok: false; message: string }> {
  const providerSettings = settings.providers[providerId];
  if (!providerSettings.enabled) {
    return { ok: false, message: `${PROVIDERS[providerId].displayName} is disabled in AI settings.` };
  }

  const endpoint = providerSettings.endpoint.trim();
  if (!endpoint) {
    return { ok: false, message: `Set an endpoint for the ${PROVIDERS[providerId].displayName} provider.` };
  }

  let apiKey: string | null;
  try {
    apiKey = await getProviderSecret(providerId);
  } catch (error) {
    log?.(`Failed to read stored AI credential for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
    return { ok: false, message: `Could not read the stored API key for the ${PROVIDERS[providerId].displayName} provider.` };
  }

  if (PROVIDERS[providerId].requiresSecureKey && !hasProviderSecret(apiKey)) {
    return { ok: false, message: missingProviderKeyMessage(providerId, "using") };
  }

  const adapter = createProviderAdapter(providerId, endpoint, apiKey ?? undefined, fetchImpl, log);
  return { ok: true, adapter };
}

function createProviderAdapter(
  providerId: AiProviderId,
  endpoint: string,
  apiKey: string | undefined,
  fetchImpl: RuntimeFetch,
  log?: AiDebugLogger,
): import("./contracts").AiProviderAdapter {
  switch (providerId) {
    case "gemini":
      return createGeminiProvider({ endpoint, apiKey, fetch: fetchImpl, log });
    case "openai-compatible":
    default:
      return createOpenAiCompatibleProvider({ endpoint, apiKey, fetch: fetchImpl, log });
  }
}

function createConfigurationFailure<TTask extends AiTask>(task: TTask, providerId: AiProviderId, message: string): AiTaskFailure<TTask> {
  return createAiFailureResponse(
    { task, providerId },
    {
      providerId,
      error: {
        code: "provider_error",
        message,
        retryable: false,
      },
    },
  );
}

function validationFailure(providerId: AiProviderId, message: string): AiValidationResult {
  return {
    ok: false,
    providerId,
    providerName: PROVIDERS[providerId].displayName,
    message,
    checkedAt: new Date().toISOString(),
  };
}

function extractProviderMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) {
      return error.message;
    }
  }
  return `Provider request failed with status ${status}.`;
}

function buildRequestHeaders(secret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  };
}

function buildUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/$/, "")}${path}`;
}

function formatEstimatedCostMessage(usage: AiTaskUsage | undefined, showEstimatedCosts: boolean): string | undefined {
  if (!showEstimatedCosts || typeof usage?.estimatedCostUsd !== "number") {
    return undefined;
  }

  return `Estimated cost: $${usage.estimatedCostUsd.toFixed(4)}.`;
}

async function defaultFetch(input: string, init?: RequestInit): Promise<RuntimeFetchResponse> {
  return fetch(input, init);
}

function hasProviderSecret(secret: string | null): secret is string {
  return typeof secret === "string" && secret.trim().length > 0;
}

function missingProviderKeyMessage(providerId: AiProviderId, action: "validating" | "using"): string {
  if (providerId === "openai-compatible") {
    return `Store an API key for the OpenAI compatible provider before ${action} it.`;
  }
  if (providerId === "gemini") {
    return `Store an API key for Google Gemini before ${action} it.`;
  }
  return `Store a provider API key before ${action} it.`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
