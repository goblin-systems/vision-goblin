import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultSettings, type VisionSettings } from "../../settings";
import type { AiTaskFamily } from "./types";
import type { DiscoveredModel, ModelDiscoveryResult, ModelDiscoveryService } from "./modelDiscovery";

const secureStoreMocks = vi.hoisted(() => ({
  clearAiProviderSecret: vi.fn(async () => {}),
  getAiProviderSecret: vi.fn(async () => null),
  hasAiProviderSecret: vi.fn(async () => false),
  storeAiProviderSecret: vi.fn(async () => {}),
}));

const modelDiscoveryMocks = vi.hoisted(() => {
  const modelsForFamily = new Map<string, DiscoveredModel[]>();
  const cachedResults = new Map<string, ModelDiscoveryResult>();
  const service: ModelDiscoveryService = {
    discoverModels: vi.fn(async (providerId) => {
      const cached = cachedResults.get(providerId);
      if (cached) return cached;
      return { ok: true, providerId, models: [], fetchedAt: new Date().toISOString() };
    }),
    getCachedModels: vi.fn((providerId) => cachedResults.get(providerId) ?? null),
    getModelsForFamily: vi.fn((providerId, family) => {
      const key = `${providerId}:${family}`;
      return modelsForFamily.get(key) ?? [];
    }),
    clearCache: vi.fn(),
  };
  return {
    createModelDiscoveryService: vi.fn(() => service),
    service,
    modelsForFamily,
    cachedResults,
  };
});

vi.mock("@goblin-systems/goblin-design-system", async () => {
  const actual = await vi.importActual<typeof import("@goblin-systems/goblin-design-system")>("@goblin-systems/goblin-design-system");
  return {
    ...actual,
    applyIcons: vi.fn(),
  };
});

vi.mock("./secureStore", () => secureStoreMocks);

vi.mock("./modelDiscovery", () => ({
  createModelDiscoveryService: modelDiscoveryMocks.createModelDiscoveryService,
}));

describe("AI controller", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="ai-routing-grid"></div>
      <div id="ai-provider-openai-compatible-secret-status"></div>
      <div id="ai-provider-openai-compatible-status"></div>
      <div id="ai-provider-gemini-secret-status"></div>
      <div id="ai-provider-gemini-status"></div>
      <input id="ai-show-estimated-costs-checkbox" type="checkbox" />
      <input id="ai-provider-openai-compatible-enabled" type="checkbox" />
      <input id="ai-provider-openai-compatible-endpoint" type="text" />
      <input id="ai-provider-gemini-enabled" type="checkbox" />
      <input id="ai-provider-gemini-endpoint" type="text" />
      <div id="ai-jobs-summary"></div>
      <button id="ai-jobs-status-btn" type="button"><span></span></button>
      <div id="ai-jobs-list"></div>
      <input id="ai-provider-openai-compatible-secret" type="password" />
      <button id="ai-provider-openai-compatible-save-secret-btn" type="button"></button>
      <button id="ai-provider-openai-compatible-clear-secret-btn" type="button"></button>
      <button id="ai-provider-openai-compatible-validate-btn" type="button"></button>
      <input id="ai-provider-gemini-secret" type="password" />
      <button id="ai-provider-gemini-save-secret-btn" type="button"></button>
      <button id="ai-provider-gemini-clear-secret-btn" type="button"></button>
      <button id="ai-provider-gemini-validate-btn" type="button"></button>
      <button id="focus-ai-jobs-btn" type="button"></button>
      <button id="focus-ai-settings-btn" type="button"></button>
      <section id="ai-settings-section"></section>
      <section id="ai-jobs-panel"></section>
    `;
    vi.clearAllMocks();
    modelDiscoveryMocks.modelsForFamily.clear();
    modelDiscoveryMocks.cachedResults.clear();
  });

  it("renders exactly 'AI idle' without helper text when no jobs need attention", async () => {
    const { createAiController } = await import("./controller");
    const settings = getDefaultSettings();

    const controller = createAiController({
      getSettings: () => settings,
      persistSettings: async () => {},
      showToast: vi.fn(),
      log: vi.fn(),
    });

    controller.render();

    const summary = document.getElementById("ai-jobs-summary");
    const statusBtn = document.getElementById("ai-jobs-status-btn") as HTMLButtonElement;
    const label = statusBtn.querySelector<HTMLElement>("[data-ai-jobs-status-label]");
    const spinner = statusBtn.querySelector<HTMLElement>("[data-ai-jobs-status-spinner]");

    expect(summary?.textContent).toBe("AI idle");
    expect(statusBtn.textContent?.replace(/\s+/g, " ").trim()).toBe("AI idle");
    expect(statusBtn.textContent).not.toContain("Validation and future tool jobs appear here.");
    expect(label?.textContent).toBe("AI idle");
    expect(statusBtn.classList.contains("is-loading")).toBe(false);
    expect(statusBtn.getAttribute("aria-busy")).toBe("false");
    expect(spinner).not.toBeNull();
    expect(spinner?.hidden).toBe(true);
  });

  it("shows a right-aligned spinner on the jobs status button when AI is not idle", async () => {
    const { createAiController } = await import("./controller");
    const settings = getDefaultSettings();

    const controller = createAiController({
      getSettings: () => settings,
      persistSettings: async () => {},
      showToast: vi.fn(),
      log: vi.fn(),
    });

    controller.render();
    controller.queueValidation("openai-compatible");

    const statusBtn = document.getElementById("ai-jobs-status-btn") as HTMLButtonElement;
    const label = statusBtn.querySelector<HTMLElement>("[data-ai-jobs-status-label]");
    const spinner = statusBtn.querySelector<HTMLElement>("[data-ai-jobs-status-spinner]");

    expect(label?.textContent).toBe("AI 1 running.");
    expect(statusBtn.classList.contains("is-loading")).toBe(true);
    expect(statusBtn.getAttribute("aria-busy")).toBe("true");
    expect(spinner).not.toBeNull();
    expect(spinner?.hidden).toBe(false);
    expect(label?.nextElementSibling).toBe(spinner);
  });

  it("treats a successful native save as authoritative and updates the status label", async () => {
    const { createAiController } = await import("./controller");
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    let persistedSettings: VisionSettings = settings;
    const showToast = vi.fn();

    const hasSecretMock = secureStoreMocks.hasAiProviderSecret.mockImplementation(async () => false);
    const getSecretMock = secureStoreMocks.getAiProviderSecret.mockImplementation(async () => null);

    const controller = createAiController({
      getSettings: () => persistedSettings,
      persistSettings: async (next) => {
        persistedSettings = next;
      },
      showToast,
      log: vi.fn(),
    });

    controller.bind();
    await Promise.resolve();

    const input = document.getElementById("ai-provider-openai-compatible-secret") as HTMLInputElement;
    input.value = "test-secret";

    const button = document.getElementById("ai-provider-openai-compatible-save-secret-btn") as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(secureStoreMocks.storeAiProviderSecret).toHaveBeenCalledWith("openai-compatible", "test-secret");
    expect(hasSecretMock).toHaveBeenCalledTimes(2);
    expect(getSecretMock).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(document.getElementById("ai-provider-openai-compatible-secret-status")?.textContent).toBe(
      "API key stored securely.",
    );
    expect(showToast).toHaveBeenCalledWith("AI key stored securely.", "success");
  });

  it("shows an error toast and refreshes credential status when save fails", async () => {
    const { createAiController } = await import("./controller");
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    let persistedSettings: VisionSettings = settings;
    const showToast = vi.fn();

    secureStoreMocks.storeAiProviderSecret.mockRejectedValueOnce(new Error("Store write failed"));
    secureStoreMocks.hasAiProviderSecret.mockResolvedValue(false);

    const controller = createAiController({
      getSettings: () => persistedSettings,
      persistSettings: async (next) => {
        persistedSettings = next;
      },
      showToast,
      log: vi.fn(),
    });

    controller.bind();
    await Promise.resolve();

    const input = document.getElementById("ai-provider-openai-compatible-secret") as HTMLInputElement;
    input.value = "sk-test";

    const button = document.getElementById("ai-provider-openai-compatible-save-secret-btn") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to store AI key"),
        "error",
      );
    });
    expect(secureStoreMocks.hasAiProviderSecret).toHaveBeenCalled();
    expect(input.value).toBe("sk-test");
  });

  it("clears the stored secret, refreshes status, and shows info toast", async () => {
    const { createAiController } = await import("./controller");
    const settings = getDefaultSettings();
    settings.ai.providers["openai-compatible"].enabled = true;
    let persistedSettings: VisionSettings = settings;
    const showToast = vi.fn();

    secureStoreMocks.hasAiProviderSecret.mockResolvedValue(false);

    const controller = createAiController({
      getSettings: () => persistedSettings,
      persistSettings: async (next) => {
        persistedSettings = next;
      },
      showToast,
      log: vi.fn(),
    });

    controller.bind();
    await Promise.resolve();

    const button = document.getElementById("ai-provider-openai-compatible-clear-secret-btn") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Stored AI key cleared.", "info");
    });
    expect(secureStoreMocks.clearAiProviderSecret).toHaveBeenCalledWith("openai-compatible");
  });

  describe("model dropdown (P4.5)", () => {
    async function createControllerWithDefaults(settingsOverrides?: (s: VisionSettings) => void) {
      const { createAiController } = await import("./controller");
      const settings = getDefaultSettings();
      if (settingsOverrides) settingsOverrides(settings);
      let persistedSettings: VisionSettings = settings;
      const controller = createAiController({
        getSettings: () => persistedSettings,
        persistSettings: async (next) => { persistedSettings = next; },
        showToast: vi.fn(),
        log: vi.fn(),
      });
      controller.bind();
      controller.render();
      return { controller, getSettings: () => persistedSettings };
    }

    it("renders a <select> for preferred model (not an <input>)", async () => {
      await createControllerWithDefaults();
      const grid = document.getElementById("ai-routing-grid")!;
      const modelSelects = grid.querySelectorAll<HTMLSelectElement>("select[data-ai-route-field='model']");
      const modelInputs = grid.querySelectorAll<HTMLInputElement>("input[data-ai-route-field='model']");
      expect(modelSelects.length).toBeGreaterThan(0);
      expect(modelInputs.length).toBe(0);
    });

    it("includes 'Auto (default)' as the first option with empty value", async () => {
      await createControllerWithDefaults();
      const grid = document.getElementById("ai-routing-grid")!;
      const modelSelect = grid.querySelector<HTMLSelectElement>("select[data-ai-route-field='model']")!;
      const firstOption = modelSelect.options[0];
      expect(firstOption.value).toBe("");
      expect(firstOption.textContent).toBe("Auto (default)");
    });

    it("populates options from discovered models", async () => {
      const models: DiscoveredModel[] = [
        { id: "gpt-4o", displayName: "GPT-4o", providerId: "openai-compatible", capabilities: ["segmentation", "captioning"] },
        { id: "gpt-4.1-mini", displayName: "GPT-4.1 Mini", providerId: "openai-compatible", capabilities: ["segmentation", "captioning"] },
      ];
      modelDiscoveryMocks.modelsForFamily.set("openai-compatible:segmentation", models);

      await createControllerWithDefaults();
      const grid = document.getElementById("ai-routing-grid")!;
      const segmentationSelect = grid.querySelector<HTMLSelectElement>(
        "select[data-ai-route-family='segmentation'][data-ai-route-field='model']",
      )!;

      const optionValues = Array.from(segmentationSelect.options).map((o) => o.value);
      expect(optionValues).toContain("");
      expect(optionValues).toContain("gpt-4o");
      expect(optionValues).toContain("gpt-4.1-mini");

      const gpt4oOption = Array.from(segmentationSelect.options).find((o) => o.value === "gpt-4o")!;
      expect(gpt4oOption.textContent).toBe("GPT-4o");
    });

    it("preserves current preferred model as a custom option when not in discovered list", async () => {
      await createControllerWithDefaults((s) => {
        s.ai.routing.segmentation.preferredModel = "my-custom-model";
      });

      const grid = document.getElementById("ai-routing-grid")!;
      const segmentationSelect = grid.querySelector<HTMLSelectElement>(
        "select[data-ai-route-family='segmentation'][data-ai-route-field='model']",
      )!;

      const customOption = Array.from(segmentationSelect.options).find((o) => o.value === "my-custom-model");
      expect(customOption).toBeDefined();
      expect(customOption!.textContent).toBe("my-custom-model (custom)");
      expect(segmentationSelect.value).toBe("my-custom-model");
    });

    it("does not add a custom option when preferred model matches a discovered model", async () => {
      const models: DiscoveredModel[] = [
        { id: "gpt-4.1-mini", displayName: "GPT-4.1 Mini", providerId: "openai-compatible", capabilities: ["segmentation"] },
      ];
      modelDiscoveryMocks.modelsForFamily.set("openai-compatible:segmentation", models);

      await createControllerWithDefaults((s) => {
        s.ai.routing.segmentation.preferredModel = "gpt-4.1-mini";
      });

      const grid = document.getElementById("ai-routing-grid")!;
      const segmentationSelect = grid.querySelector<HTMLSelectElement>(
        "select[data-ai-route-family='segmentation'][data-ai-route-field='model']",
      )!;

      const customOptions = Array.from(segmentationSelect.options).filter((o) =>
        o.textContent?.includes("(custom)"),
      );
      expect(customOptions.length).toBe(0);
      expect(segmentationSelect.value).toBe("gpt-4.1-mini");
    });

    it("does not add a custom option when preferred model is empty", async () => {
      await createControllerWithDefaults((s) => {
        s.ai.routing.segmentation.preferredModel = "";
      });

      const grid = document.getElementById("ai-routing-grid")!;
      const segmentationSelect = grid.querySelector<HTMLSelectElement>(
        "select[data-ai-route-family='segmentation'][data-ai-route-field='model']",
      )!;

      const customOptions = Array.from(segmentationSelect.options).filter((o) =>
        o.textContent?.includes("(custom)"),
      );
      expect(customOptions.length).toBe(0);
      expect(segmentationSelect.value).toBe("");
    });

    it("renders one model <select> per task family", async () => {
      await createControllerWithDefaults();
      const grid = document.getElementById("ai-routing-grid")!;
      const modelSelects = grid.querySelectorAll<HTMLSelectElement>("select[data-ai-route-field='model']");
      // 5 families: segmentation, inpainting, enhancement, generation, captioning
      expect(modelSelects.length).toBe(5);
    });

    it("exposes discoverModels on the controller interface", async () => {
      const { controller } = await createControllerWithDefaults();
      expect(typeof controller.discoverModels).toBe("function");
    });
  });
});
