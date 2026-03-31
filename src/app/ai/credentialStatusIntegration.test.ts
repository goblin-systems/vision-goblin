import { beforeEach, describe, expect, it, vi } from "vitest";

const { integrationMap, integrationReset, mockLoad } = vi.hoisted(() => {
  const integrationMap = new Map<string, unknown>();
  const mockStore = {
    get: vi.fn((key: string) => Promise.resolve(integrationMap.get(key))),
    set: vi.fn((key: string, value: unknown) => { integrationMap.set(key, value); return Promise.resolve(); }),
    delete: vi.fn((key: string) => { const had = integrationMap.has(key); integrationMap.delete(key); return Promise.resolve(had); }),
    has: vi.fn((key: string) => Promise.resolve(integrationMap.has(key))),
    save: vi.fn(() => Promise.resolve()),
  };
  const mockLoad = vi.fn(() => Promise.resolve(mockStore));
  const integrationReset = () => { integrationMap.clear(); vi.clearAllMocks(); };
  return { integrationMap, integrationReset, mockLoad };
});

vi.mock("@tauri-apps/plugin-store", () => ({ load: mockLoad }));
vi.mock("../../logger", () => ({ debugLog: vi.fn() }));

import { createCredentialStatusStore } from "./credentialStatus";
import { hasAiProviderSecret, storeAiProviderSecret } from "./secureStore";

describe("credential status store with secure store integration", () => {
  beforeEach(() => integrationReset());

  it("refresh reflects the stored credential state", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-abc123");

    const onChange = vi.fn();
    const store = createCredentialStatusStore({
      loadStatus: (id) => hasAiProviderSecret(id),
      onChange,
    });

    const result = await store.refresh("openai-compatible");
    expect(result).toBe(true);
    expect(store.get("openai-compatible")).toBe(true);
  });

  it("optimistic set after store makes get return true without refresh", async () => {
    const onChange = vi.fn();
    const store = createCredentialStatusStore({
      loadStatus: (id) => hasAiProviderSecret(id),
      onChange,
    });

    await storeAiProviderSecret("openai-compatible", "sk-abc123");
    store.set("openai-compatible", true);

    expect(store.get("openai-compatible")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
