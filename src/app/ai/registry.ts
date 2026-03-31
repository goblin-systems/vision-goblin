import {
  createAiFailureResponse,
  normalizeAiTaskError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
} from "./contracts";
import type { AiTask, AiTaskFamily } from "./types";

export interface AiProviderRegistry {
  registerAdapter(adapter: AiProviderAdapter): void;
  getAdapter(providerId: string): AiProviderAdapter | null;
  listAdapters(taskFamily?: AiTaskFamily): AiProviderAdapter[];
  setDefaultProvider(taskFamily: AiTaskFamily, providerId: string): void;
  execute<TTask extends AiTask>(request: AiProviderRequest<TTask>): Promise<AiProviderResponse<TTask>>;
}

export function createAiProviderRegistry(
  adapters: AiProviderAdapter[] = [],
  defaults: Partial<Record<AiTaskFamily, string>> = {},
): AiProviderRegistry {
  const adapterMap = new Map<string, AiProviderAdapter>();
  const defaultProviders = new Map<AiTaskFamily, string>();

  for (const adapter of adapters) {
    adapterMap.set(adapter.id, adapter);
  }

  for (const family of Object.keys(defaults) as AiTaskFamily[]) {
    const providerId = defaults[family];
    if (providerId) {
      defaultProviders.set(family, providerId);
    }
  }

  return {
    registerAdapter(adapter) {
      adapterMap.set(adapter.id, adapter);
    },
    getAdapter(providerId) {
      return adapterMap.get(providerId) ?? null;
    },
    listAdapters(taskFamily) {
      const values = [...adapterMap.values()];
      if (!taskFamily) {
        return values;
      }
      return values.filter((adapter) => adapter.supportedFamilies.includes(taskFamily));
    },
    setDefaultProvider(taskFamily, providerId) {
      defaultProviders.set(taskFamily, providerId);
    },
    async execute(request) {
      const adapter = resolveAdapter(adapterMap, defaultProviders, request);
      if (!adapter) {
        return createAiFailureResponse(request, {
          providerId: request.providerId ?? defaultProviders.get(request.task.family) ?? "unresolved",
          error: {
            code: request.providerId ? "provider_not_found" : "unsupported_task",
            message: request.providerId
              ? `AI provider '${request.providerId}' is not registered.`
              : `No AI provider supports '${request.task.family}' tasks.`,
            retryable: false,
          },
        });
      }

      if (!adapter.supportedFamilies.includes(request.task.family)) {
        return createAiFailureResponse(request, {
          providerId: adapter.id,
          error: {
            code: "unsupported_task",
            message: `AI provider '${adapter.id}' does not support '${request.task.family}' tasks.`,
            retryable: false,
          },
        });
      }

      try {
        return await adapter.execute(request);
      } catch (error) {
        return createAiFailureResponse(request, {
          providerId: adapter.id,
          error: normalizeAiTaskError(error, {
            code: "transport_error",
            retryable: true,
          }),
        });
      }
    },
  };
}

function resolveAdapter<TTask extends AiTask>(
  adapterMap: Map<string, AiProviderAdapter>,
  defaultProviders: Map<AiTaskFamily, string>,
  request: AiProviderRequest<TTask>,
): AiProviderAdapter | null {
  if (request.providerId) {
    return adapterMap.get(request.providerId) ?? null;
  }

  const defaultProviderId = defaultProviders.get(request.task.family);
  if (defaultProviderId) {
    return adapterMap.get(defaultProviderId) ?? null;
  }

  return [...adapterMap.values()].find((adapter) => adapter.supportedFamilies.includes(request.task.family)) ?? null;
}
