import { AI_PROVIDER_IDS, type AiProviderId } from "./config";

type LogLevel = "INFO" | "WARN" | "ERROR";

export interface CredentialStatusStoreOptions {
  loadStatus: (providerId: AiProviderId) => Promise<boolean>;
  onChange: () => void;
  log?: (message: string, level?: LogLevel) => void;
}

export interface CredentialStatusStore {
  get(providerId: AiProviderId): boolean | undefined;
  set(providerId: AiProviderId, nextStatus: boolean): void;
  refresh(providerId: AiProviderId): Promise<boolean | undefined>;
  refreshAll(): Promise<void>;
}

export function createCredentialStatusStore(options: CredentialStatusStoreOptions): CredentialStatusStore {
  const status: Partial<Record<AiProviderId, boolean>> = {};
  const requestVersion = AI_PROVIDER_IDS.reduce<Record<AiProviderId, number>>((acc, providerId) => {
    acc[providerId] = 0;
    return acc;
  }, {} as Record<AiProviderId, number>);

  async function refresh(providerId: AiProviderId, emit = true): Promise<boolean | undefined> {
    const version = requestVersion[providerId] + 1;
    requestVersion[providerId] = version;

    try {
      const nextStatus = await options.loadStatus(providerId);
      if (requestVersion[providerId] !== version) {
        return status[providerId];
      }
      status[providerId] = nextStatus;
      if (emit) {
        options.onChange();
      }
      return nextStatus;
    } catch (error) {
      if (requestVersion[providerId] === version) {
        options.log?.(
          `Failed to refresh AI credential status for ${providerId}: ${toErrorMessage(error)}`,
          "ERROR",
        );
        if (emit) {
          options.onChange();
        }
      }
      return status[providerId];
    }
  }

  return {
    get(providerId) {
      return status[providerId];
    },
    set(providerId, nextStatus) {
      requestVersion[providerId] += 1;
      status[providerId] = nextStatus;
      options.onChange();
    },
    refresh(providerId) {
      return refresh(providerId);
    },
    async refreshAll() {
      await Promise.all(AI_PROVIDER_IDS.map((providerId) => refresh(providerId, false)));
      options.onChange();
    },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
