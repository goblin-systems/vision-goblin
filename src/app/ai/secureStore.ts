import { load, type Store } from "@tauri-apps/plugin-store";
import type { AiProviderId } from "./config";
import { debugLog } from "../../logger";

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("credentials.json", { autoSave: true, defaults: {} });
  }
  return store;
}

function secretKey(providerId: AiProviderId): string {
  return `secret:${providerId}`;
}

export async function storeAiProviderSecret(providerId: AiProviderId, secret: string): Promise<void> {
  try {
    const s = await getStore();
    await s.set(secretKey(providerId), secret);
  } catch (error) {
    debugLog(`Failed to store AI credential for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
    throw error;
  }
}

export async function getAiProviderSecret(providerId: AiProviderId): Promise<string | null> {
  try {
    const s = await getStore();
    const value = await s.get<string>(secretKey(providerId));
    return value ?? null;
  } catch (error) {
    debugLog(`Failed to read AI credential for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
    throw error;
  }
}

export async function clearAiProviderSecret(providerId: AiProviderId): Promise<void> {
  try {
    const s = await getStore();
    await s.delete(secretKey(providerId));
  } catch (error) {
    debugLog(`Failed to clear AI credential for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
    throw error;
  }
}

export async function hasAiProviderSecret(providerId: AiProviderId): Promise<boolean> {
  try {
    const s = await getStore();
    return await s.has(secretKey(providerId));
  } catch (error) {
    debugLog(`Failed to check AI credential status for ${providerId}: ${toErrorMessage(error)}`, "ERROR");
    throw error;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
