import { beforeEach, describe, expect, it, vi } from "vitest";

const { backingMap, mockLoad, reset } = vi.hoisted(() => {
  const backingMap = new Map<string, unknown>();
  const mockStore = {
    get: vi.fn((key: string) => Promise.resolve(backingMap.get(key))),
    set: vi.fn((key: string, value: unknown) => { backingMap.set(key, value); return Promise.resolve(); }),
    delete: vi.fn((key: string) => { const had = backingMap.has(key); backingMap.delete(key); return Promise.resolve(had); }),
    has: vi.fn((key: string) => Promise.resolve(backingMap.has(key))),
    save: vi.fn(() => Promise.resolve()),
  };
  const mockLoad = vi.fn(() => Promise.resolve(mockStore));
  const reset = () => { backingMap.clear(); vi.clearAllMocks(); };
  return { backingMap, mockStore, mockLoad, reset };
});

vi.mock("@tauri-apps/plugin-store", () => ({ load: mockLoad }));
vi.mock("../../logger", () => ({ debugLog: vi.fn() }));

import {
  clearAiProviderSecret,
  getAiProviderSecret,
  hasAiProviderSecret,
  storeAiProviderSecret,
} from "./secureStore";

describe("secure store", () => {
  beforeEach(() => reset());

  it("uses the credentials.json store file", async () => {
    await hasAiProviderSecret("openai-compatible");
    expect(mockLoad).toHaveBeenCalledWith("credentials.json", expect.anything());
  });

  it("stores a secret and retrieves it", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-abc123");
    const result = await getAiProviderSecret("openai-compatible");
    expect(result).toBe("sk-abc123");
  });

  it("returns true from has after storing a secret", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-abc123");
    const result = await hasAiProviderSecret("openai-compatible");
    expect(result).toBe(true);
  });

  it("returns null when getting a secret that was never stored", async () => {
    const result = await getAiProviderSecret("openai-compatible");
    expect(result).toBeNull();
  });

  it("returns false from has when no secret is stored", async () => {
    const result = await hasAiProviderSecret("openai-compatible");
    expect(result).toBe(false);
  });

  it("returns null after clearing a stored secret", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-abc123");
    await clearAiProviderSecret("openai-compatible");
    expect(await getAiProviderSecret("openai-compatible")).toBeNull();
    expect(await hasAiProviderSecret("openai-compatible")).toBe(false);
  });

  it("does not throw when clearing a secret that was never stored", async () => {
    await expect(clearAiProviderSecret("openai-compatible")).resolves.toBeUndefined();
  });

  it("overwrites an existing secret with a new value", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-old");
    await storeAiProviderSecret("openai-compatible", "sk-new");
    const result = await getAiProviderSecret("openai-compatible");
    expect(result).toBe("sk-new");
  });

  it("isolates secrets between different providers", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-openai");
    expect(await getAiProviderSecret("nonexistent-provider" as any)).toBeNull();
    expect(await getAiProviderSecret("openai-compatible")).toBe("sk-openai");
  });

  it("uses the secret:{providerId} key format", async () => {
    await storeAiProviderSecret("openai-compatible", "sk-abc123");
    expect(backingMap.has("secret:openai-compatible")).toBe(true);
  });
});
