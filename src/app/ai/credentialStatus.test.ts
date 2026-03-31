import { describe, expect, it, vi } from "vitest";
import { createCredentialStatusStore } from "./credentialStatus";

describe("AI credential status store", () => {
  it("lets authoritative updates replace in-flight refreshes", async () => {
    let resolveRefresh: ((value: boolean) => void) | undefined;
    const loadStatus = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveRefresh = resolve;
    }));

    const onChange = vi.fn();
    const store = createCredentialStatusStore({
      loadStatus: loadStatus as never,
      onChange,
    });

    const refresh = store.refresh("openai-compatible");
    store.set("openai-compatible", true);

    resolveRefresh?.(false);
    await refresh;

    expect(store.get("openai-compatible")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores stale refresh results for the same provider", async () => {
    let resolveFirst: ((value: boolean) => void) | undefined;
    let resolveSecond: ((value: boolean) => void) | undefined;
    const loadStatus = vi.fn((providerId: string) => {
      expect(providerId).toBe("openai-compatible");
      return new Promise<boolean>((resolve) => {
        if (!resolveFirst) {
          resolveFirst = resolve;
          return;
        }
        resolveSecond = resolve;
      });
    });

    const onChange = vi.fn();
    const store = createCredentialStatusStore({
      loadStatus: loadStatus as never,
      onChange,
    });

    const firstRefresh = store.refresh("openai-compatible");
    const secondRefresh = store.refresh("openai-compatible");

    resolveSecond?.(true);
    await secondRefresh;
    expect(store.get("openai-compatible")).toBe(true);

    resolveFirst?.(false);
    await firstRefresh;
    expect(store.get("openai-compatible")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
