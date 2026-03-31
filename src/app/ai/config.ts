import { AI_TASK_FAMILIES, type AiTaskFamily } from "./types";

export const AI_PROVIDER_IDS = ["openai-compatible", "gemini"] as const;

export type AiProviderId = typeof AI_PROVIDER_IDS[number];

export interface AiProviderPreferences {
  enabled: boolean;
  endpoint: string;
}

export interface AiTaskRoutePreferences {
  primaryProviderId: AiProviderId;
  fallbackProviderIds: AiProviderId[];
  preferredModel: string;
}

export interface AiSettings {
  showEstimatedCosts: boolean;
  providers: Record<AiProviderId, AiProviderPreferences>;
  routing: Record<AiTaskFamily, AiTaskRoutePreferences>;
}

const DEFAULT_PROVIDER_SETTINGS: Record<AiProviderId, AiProviderPreferences> = {
  "openai-compatible": {
    enabled: false,
    endpoint: "https://api.openai.com/v1",
  },
  gemini: {
    enabled: false,
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  showEstimatedCosts: true,
  providers: cloneProviderSettings(DEFAULT_PROVIDER_SETTINGS),
  routing: AI_TASK_FAMILIES.reduce<Record<AiTaskFamily, AiTaskRoutePreferences>>((acc, family) => {
    acc[family] = {
      primaryProviderId: "openai-compatible",
      fallbackProviderIds: [],
      preferredModel: defaultModelForFamily(family),
    };
    return acc;
  }, {} as Record<AiTaskFamily, AiTaskRoutePreferences>),
};

export function cloneAiSettings(settings: AiSettings): AiSettings {
  return {
    showEstimatedCosts: settings.showEstimatedCosts,
    providers: cloneProviderSettings(settings.providers),
    routing: AI_TASK_FAMILIES.reduce<Record<AiTaskFamily, AiTaskRoutePreferences>>((acc, family) => {
      const route = settings.routing[family];
      acc[family] = {
        primaryProviderId: route.primaryProviderId,
        fallbackProviderIds: [...route.fallbackProviderIds],
        preferredModel: route.preferredModel,
      };
      return acc;
    }, {} as Record<AiTaskFamily, AiTaskRoutePreferences>),
  };
}

export function normalizeAiSettings(value: unknown): AiSettings {
  const next = cloneAiSettings(DEFAULT_AI_SETTINGS);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }

  const candidate = value as Partial<AiSettings> & {
    providers?: Partial<Record<AiProviderId, Partial<AiProviderPreferences>>>;
    routing?: Partial<Record<AiTaskFamily, Partial<AiTaskRoutePreferences>>>;
  };

  if (typeof candidate.showEstimatedCosts === "boolean") {
    next.showEstimatedCosts = candidate.showEstimatedCosts;
  }

  for (const providerId of AI_PROVIDER_IDS) {
    const storedProvider = candidate.providers?.[providerId];
    if (!storedProvider || typeof storedProvider !== "object") {
      continue;
    }
    if (typeof storedProvider.enabled === "boolean") {
      next.providers[providerId].enabled = storedProvider.enabled;
    }
    if (typeof storedProvider.endpoint === "string") {
      next.providers[providerId].endpoint = storedProvider.endpoint.trim();
    }
  }

  for (const family of AI_TASK_FAMILIES) {
    const storedRoute = candidate.routing?.[family];
    if (!storedRoute || typeof storedRoute !== "object") {
      continue;
    }
    if (isAiProviderId(storedRoute.primaryProviderId)) {
      next.routing[family].primaryProviderId = storedRoute.primaryProviderId;
    }
    if (Array.isArray(storedRoute.fallbackProviderIds)) {
      next.routing[family].fallbackProviderIds = dedupeProviderIds(storedRoute.fallbackProviderIds).filter(
        (providerId) => providerId !== next.routing[family].primaryProviderId,
      );
    }
    if (typeof storedRoute.preferredModel === "string") {
      next.routing[family].preferredModel = storedRoute.preferredModel.trim();
    }
  }

  // Migrate persisted settings that still reference the removed "stub-local" provider.
  for (const family of AI_TASK_FAMILIES) {
    if ((next.routing[family].primaryProviderId as string) === "stub-local") {
      next.routing[family].primaryProviderId = "openai-compatible";
    }
    next.routing[family].fallbackProviderIds = next.routing[family].fallbackProviderIds.filter(
      (id) => (id as string) !== "stub-local",
    );
  }

  // Also clear stub model names from preferredModel.
  for (const family of AI_TASK_FAMILIES) {
    if (next.routing[family].preferredModel.startsWith("stub-")) {
      next.routing[family].preferredModel = defaultModelForFamily(family);
    }
  }

  return next;
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && AI_PROVIDER_IDS.includes(value as AiProviderId);
}

export function defaultModelForFamily(family: AiTaskFamily): string {
  switch (family) {
    case "generation":
      return "gpt-image-1";
    case "inpainting":
    case "enhancement":
      return "gpt-4o";
    case "segmentation":
    case "captioning":
      return "gpt-4.1-mini";
    default:
      return "gpt-4.1-mini";
  }
}

function cloneProviderSettings(settings: Record<AiProviderId, AiProviderPreferences>): Record<AiProviderId, AiProviderPreferences> {
  return {
    "openai-compatible": { ...settings["openai-compatible"] },
    gemini: { ...settings["gemini"] },
  };
}

function dedupeProviderIds(values: unknown[]): AiProviderId[] {
  const next: AiProviderId[] = [];
  for (const value of values) {
    if (!isAiProviderId(value) || next.includes(value)) {
      continue;
    }
    next.push(value);
  }
  return next;
}
