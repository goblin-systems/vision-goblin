import { applyIcons } from "@goblin-systems/goblin-design-system";
import { byId } from "../dom";
import { AI_PROVIDER_IDS, type AiProviderId } from "./config";
import { clearAiProviderSecret, getAiProviderSecret, hasAiProviderSecret, storeAiProviderSecret } from "./secureStore";
import { createAiJobQueue, type AiJobQueue, type AiJobRecord } from "./jobQueue";
import { createAiPlatformRuntime, type AiPlatformRuntime, type AiRuntimeTaskRequest } from "./runtime";
import { AI_TASK_FAMILIES, type AiTask, type AiTaskFamily } from "./types";
import type { VisionSettings } from "../../settings";
import { createCredentialStatusStore } from "./credentialStatus";
import { createModelDiscoveryService, type ModelDiscoveryService } from "./modelDiscovery";

export interface AiControllerDeps {
  getSettings: () => VisionSettings;
  persistSettings: (next: VisionSettings, message?: string) => Promise<void>;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  log: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
}

export interface AiController {
  bind(): void;
  render(): void;
  focusSettings(): Promise<void>;
  focusJobs(): Promise<void>;
  subscribeJobs(listener: () => void): () => void;
  getJob(jobId: string): AiJobRecord | null;
  queueTask<TTask extends AiTask>(request: AiRuntimeTaskRequest<TTask>, title: string): AiJobRecord;
  queueValidation(providerId: AiProviderId): AiJobRecord;
  discoverModels(providerId: AiProviderId): Promise<void>;
}

export function createAiController(deps: AiControllerDeps): AiController {
  const runtime: AiPlatformRuntime = createAiPlatformRuntime({
    getSettings: () => deps.getSettings().ai,
    getProviderSecret: async (providerId) => {
      return getAiProviderSecret(providerId);
    },
    log: deps.log,
  });
  const queue: AiJobQueue = createAiJobQueue(runtime);
  const credentialStatus = createCredentialStatusStore({
    loadStatus: async (providerId) => await hasAiProviderSecret(providerId),
    onChange: () => render(),
    log: deps.log,
  });
  const discovery: ModelDiscoveryService = createModelDiscoveryService({
    getSettings: () => deps.getSettings().ai,
    getProviderSecret: async (providerId) => getAiProviderSecret(providerId),
    log: deps.log,
  });

  /** Tracks provider IDs whose completed validations have already triggered discovery. */
  const discoveryTriggeredForValidation = new Set<string>();

  queue.subscribe(() => {
    render();
    for (const job of queue.listJobs()) {
      if (job.kind === "validation" && job.status === "completed" && job.providerId) {
        const key = job.id;
        if (!discoveryTriggeredForValidation.has(key)) {
          discoveryTriggeredForValidation.add(key);
          void triggerDiscovery(job.providerId as AiProviderId);
        }
      }
    }
  });

  async function triggerDiscovery(providerId: AiProviderId): Promise<void> {
    discovery.clearCache(providerId);
    await discovery.discoverModels(providerId);
    render();
  }

  function getLatestValidation(providerId: AiProviderId): AiJobRecord | null {
    return queue.listJobs().find((job) => job.kind === "validation" && job.providerId === providerId) ?? null;
  }

  function buildProviderOption(providerId: AiProviderId, family: AiTask["family"]): HTMLOptionElement {
    const option = document.createElement("option");
    const provider = runtime.listProviders().find((item) => item.id === providerId);
    const enabled = deps.getSettings().ai.providers[providerId].enabled;
    const supported = !!provider?.supportedFamilies.includes(family);
    option.value = providerId;
    option.textContent = `${provider?.displayName ?? providerId}${supported ? "" : " (unsupported)"}${enabled ? "" : " (disabled)"}`;
    option.disabled = !supported;
    return option;
  }

  function renderRoutingGrid() {
    const settings = deps.getSettings().ai;
    const grid = byId<HTMLElement>("ai-routing-grid");
    grid.innerHTML = "";

    for (const family of AI_TASK_FAMILIES) {
      const row = document.createElement("div");
      row.className = "ai-route-row";

      const copy = document.createElement("div");
      copy.className = "ai-route-copy";
      const title = document.createElement("strong");
      title.textContent = titleCaseFamily(family);
      const hint = document.createElement("span");
      hint.textContent = "Provider and model preference for this task family.";
      copy.append(title, hint);
      row.appendChild(copy);

      const primaryField = document.createElement("label");
      primaryField.className = "field-block";
      primaryField.innerHTML = "<span>Provider</span>";
      const primarySelect = document.createElement("select");
      primarySelect.dataset.aiRouteFamily = family;
      primarySelect.dataset.aiRouteField = "primary";
      AI_PROVIDER_IDS.forEach((providerId) => primarySelect.appendChild(buildProviderOption(providerId, family)));
      primarySelect.value = settings.routing[family].primaryProviderId;
      primaryField.appendChild(primarySelect);
      row.appendChild(primaryField);

      const modelField = document.createElement("label");
      modelField.className = "field-block";
      modelField.innerHTML = "<span>Preferred model</span>";
      const modelSelect = document.createElement("select");
      modelSelect.dataset.aiRouteFamily = family;
      modelSelect.dataset.aiRouteField = "model";

      const autoOption = document.createElement("option");
      autoOption.value = "";
      autoOption.textContent = "Auto (default)";
      modelSelect.appendChild(autoOption);

      const primaryProviderId = settings.routing[family].primaryProviderId;
      const discoveredModels = discovery.getModelsForFamily(primaryProviderId, family as AiTaskFamily);
      const currentPreferredModel = settings.routing[family].preferredModel;

      for (const model of discoveredModels) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.displayName !== model.id ? model.displayName : model.id;
        modelSelect.appendChild(option);
      }

      if (currentPreferredModel && !discoveredModels.some((model) => model.id === currentPreferredModel)) {
        const customOption = document.createElement("option");
        customOption.value = currentPreferredModel;
        customOption.textContent = `${currentPreferredModel} (custom)`;
        modelSelect.appendChild(customOption);
      }

      modelSelect.value = currentPreferredModel;
      modelField.appendChild(modelSelect);
      row.appendChild(modelField);

      grid.appendChild(row);
    }
  }

  function renderProviderStatuses() {
    for (const providerId of AI_PROVIDER_IDS) {
      const credentialStored = credentialStatus.get(providerId);
      const credentialHint = credentialStored === undefined
        ? "Checking secure storage..."
        : credentialStored
          ? "API key stored securely."
          : "No key stored.";
      byId<HTMLElement>(`ai-provider-${providerId}-secret-status`).textContent = credentialHint;

      const validation = getLatestValidation(providerId);
      const statusEl = byId<HTMLElement>(`ai-provider-${providerId}-status`);
      if (!validation) {
        statusEl.textContent = "Not checked yet.";
        continue;
      }

      const timestamp = new Date(validation.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      statusEl.textContent = `${validation.message} (${timestamp})`;
    }
  }

  function renderSettingsSurface() {
    const settings = deps.getSettings().ai;
    byId<HTMLInputElement>("ai-show-estimated-costs-checkbox").checked = settings.showEstimatedCosts;
    for (const providerId of AI_PROVIDER_IDS) {
      byId<HTMLInputElement>(`ai-provider-${providerId}-enabled`).checked = settings.providers[providerId].enabled;
      byId<HTMLInputElement>(`ai-provider-${providerId}-endpoint`).value = settings.providers[providerId].endpoint;
    }
    renderRoutingGrid();
    renderProviderStatuses();
  }

  function renderJobsSurface() {
    const jobs = queue.listJobs();
    const summary = byId<HTMLElement>("ai-jobs-summary");
    const list = byId<HTMLElement>("ai-jobs-list");
    const statusBtn = byId<HTMLButtonElement>("ai-jobs-status-btn");
    const running = jobs.filter((job) => job.status === "running").length;
    const pending = jobs.filter((job) => job.status === "pending").length;
    const failed = jobs.filter((job) => job.status === "failed").length;
    const hasActiveStatus = running > 0 || pending > 0 || failed > 0;
    const summaryText = hasActiveStatus
      ? `AI ${running ? `${running} running` : "idle"}${pending ? `, ${pending} queued` : ""}${failed ? `, ${failed} failed` : ""}.`
      : "AI idle";
    summary.textContent = summaryText;
    const { label, spinner } = ensureJobsStatusButtonContent(statusBtn);
    label.textContent = summaryText;
    statusBtn.classList.toggle("is-loading", hasActiveStatus);
    statusBtn.setAttribute("aria-busy", hasActiveStatus ? "true" : "false");
    spinner.hidden = !hasActiveStatus;

    list.innerHTML = "";
    if (jobs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ai-jobs-empty";
      empty.textContent = "No AI jobs yet.";
      list.appendChild(empty);
      return;
    }

    for (const job of jobs.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "history-row ai-job-row";

      const top = document.createElement("div");
      top.className = "layer-row-top";
      const title = document.createElement("strong");
      title.textContent = job.title;
      const badge = document.createElement("span");
      badge.className = "badge default ai-job-status";
      badge.textContent = job.status;
      top.append(title, badge);

      const meta = document.createElement("div");
      meta.className = "ai-job-meta";
      const detail = document.createElement("span");
      detail.className = "ai-job-note";
      detail.textContent = [
        job.family ? titleCaseFamily(job.family) : null,
        job.providerId ? titleCaseFamily(job.providerId.replace("-", " ")) : null,
        job.attemptedProviderIds.length ? `Tried ${job.attemptedProviderIds.join(" -> ")}` : null,
      ].filter(Boolean).join(" - ") || "Queued platform task";
      meta.appendChild(detail);

      const message = document.createElement("div");
      message.className = "ai-job-note";
      message.textContent = job.message;

      const notes = document.createElement("div");
      notes.className = "ai-job-meta";
      if (job.degradedMessage) {
        const degraded = document.createElement("span");
        degraded.className = "ai-job-note";
        degraded.textContent = job.degradedMessage;
        notes.appendChild(degraded);
      }
      if (job.estimatedCostMessage) {
        const cost = document.createElement("span");
        cost.className = "ai-job-note";
        cost.textContent = job.estimatedCostMessage;
        notes.appendChild(cost);
      }

      const actions = document.createElement("div");
      actions.className = "ai-job-actions";
      if (job.canCancel) {
        actions.appendChild(buildJobActionButton(job.id, "cancel", "Cancel", "square"));
      }
      if (job.canRetry) {
        actions.appendChild(buildJobActionButton(job.id, "retry", "Retry", "rotate-ccw"));
      }

      row.append(top, meta, message);
      if (notes.childElementCount > 0) {
        row.appendChild(notes);
      }
      if (actions.childElementCount > 0) {
        row.appendChild(actions);
      }
      list.appendChild(row);
    }
  }

  function buildJobActionButton(jobId: string, action: "cancel" | "retry", label: string, icon: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn slim-btn";
    button.dataset.aiJobId = jobId;
    button.dataset.aiJobAction = action;
    button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    return button;
  }

  function ensureJobsStatusButtonContent(button: HTMLButtonElement) {
    let label = button.querySelector<HTMLSpanElement>("[data-ai-jobs-status-label]");
    if (!label) {
      label = button.querySelector<HTMLSpanElement>("span:not(.btn-spinner)") ?? document.createElement("span");
      label.dataset.aiJobsStatusLabel = "true";
      if (!label.parentElement) {
        button.appendChild(label);
      }
    }

    let spinner = button.querySelector<HTMLSpanElement>("[data-ai-jobs-status-spinner]");
    if (!spinner) {
      spinner = document.createElement("span");
      spinner.className = "btn-spinner";
      spinner.dataset.aiJobsStatusSpinner = "true";
      spinner.setAttribute("aria-hidden", "true");
      button.appendChild(spinner);
    }

    if (spinner.previousElementSibling !== label) {
      label.insertAdjacentElement("afterend", spinner);
    }

    return { label, spinner };
  }

  async function updateAiSettings(updater: (current: VisionSettings["ai"]) => VisionSettings["ai"], message?: string) {
    const next = updater(deps.getSettings().ai);
    await deps.persistSettings({ ...deps.getSettings(), ai: next }, message);
    render();
  }

  async function handleRouteFieldChange(target: HTMLElement) {
    const family = target.dataset.aiRouteFamily as AiTask["family"] | undefined;
    const field = target.dataset.aiRouteField;
    if (!family || !field) {
      return;
    }

    await updateAiSettings((current) => {
      const next = structuredClone(current);
      if (field === "primary" && target instanceof HTMLSelectElement) {
        next.routing[family].primaryProviderId = target.value as AiProviderId;
        next.routing[family].fallbackProviderIds = next.routing[family].fallbackProviderIds.filter(
          (providerId) => providerId !== next.routing[family].primaryProviderId,
        );
      }
      if (field === "model" && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        next.routing[family].preferredModel = target.value;
      }
      return next;
    });
  }

  async function saveProviderSecret(providerId: AiProviderId) {
    const input = byId<HTMLInputElement>(`ai-provider-${providerId}-secret`);
    const value = input.value.trim();
    if (!value) {
      deps.showToast("Enter an API key before saving it.", "error");
      return;
    }

    try {
      await storeAiProviderSecret(providerId, value);
      credentialStatus.set(providerId, true);
      input.value = "";
      deps.showToast("AI key stored securely.", "success");
    } catch (error) {
      deps.log(`Failed to store AI credential: ${toErrorMessage(error)}`, "ERROR");
      await credentialStatus.refresh(providerId);
      deps.showToast(`Failed to store AI key: ${toErrorMessage(error)}`, "error");
    }
  }

  async function clearProviderSecret(providerId: AiProviderId) {
    try {
      await clearAiProviderSecret(providerId);
      byId<HTMLInputElement>(`ai-provider-${providerId}-secret`).value = "";
      await credentialStatus.refresh(providerId);
      deps.showToast("Stored AI key cleared.", "info");
    } catch (error) {
      deps.log(`Failed to clear AI credential: ${toErrorMessage(error)}`, "ERROR");
      deps.showToast(`Failed to clear AI key: ${toErrorMessage(error)}`, "error");
    }
  }

  async function focusSettings() {
    if (deps.getSettings().lastTab !== "settings") {
      await deps.persistSettings({ ...deps.getSettings(), lastTab: "settings" });
    }
    requestAnimationFrame(() => byId<HTMLElement>("ai-settings-section").scrollIntoView({ block: "nearest" }));
  }

  async function focusJobs() {
    if (deps.getSettings().lastTab !== "editor") {
      await deps.persistSettings({ ...deps.getSettings(), lastTab: "editor" });
    }
    requestAnimationFrame(() => byId<HTMLElement>("ai-jobs-panel").scrollIntoView({ block: "nearest" }));
  }

  function queueValidation(providerId: AiProviderId) {
    const job = queue.enqueueValidation(providerId, `Validate ${runtime.listProviders().find((provider) => provider.id === providerId)?.displayName ?? providerId}`);
    render();
    return job;
  }

  function queueTask<TTask extends AiTask>(request: AiRuntimeTaskRequest<TTask>, title: string) {
    const job = queue.enqueueTask(request, title);
    render();
    return job;
  }

  function bindProviderCard(providerId: AiProviderId) {
    byId<HTMLInputElement>(`ai-provider-${providerId}-enabled`).addEventListener("change", async (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      await updateAiSettings((current) => ({
        ...current,
        providers: {
          ...current.providers,
          [providerId]: {
            ...current.providers[providerId],
            enabled,
          },
        },
      }));
      if (enabled) {
        void triggerDiscovery(providerId);
      } else {
        discovery.clearCache(providerId);
      }
    });

    byId<HTMLInputElement>(`ai-provider-${providerId}-endpoint`).addEventListener("change", async (event) => {
      await updateAiSettings((current) => ({
        ...current,
        providers: {
          ...current.providers,
          [providerId]: {
            ...current.providers[providerId],
            endpoint: (event.currentTarget as HTMLInputElement).value.trim(),
          },
        },
      }));
    });

    byId<HTMLButtonElement>(`ai-provider-${providerId}-save-secret-btn`).addEventListener("click", () => {
      void saveProviderSecret(providerId);
    });
    byId<HTMLButtonElement>(`ai-provider-${providerId}-clear-secret-btn`).addEventListener("click", () => {
      void clearProviderSecret(providerId);
    });
    byId<HTMLButtonElement>(`ai-provider-${providerId}-validate-btn`).addEventListener("click", () => {
      queueValidation(providerId);
      deps.showToast("Provider validation queued.", "info");
    });
  }

  function bind() {
    void credentialStatus.refreshAll();

    const settings = deps.getSettings().ai;
    for (const providerId of AI_PROVIDER_IDS) {
      if (settings.providers[providerId].enabled) {
        void triggerDiscovery(providerId);
      }
    }

    byId<HTMLInputElement>("ai-show-estimated-costs-checkbox").addEventListener("change", async (event) => {
      await updateAiSettings((current) => ({
        ...current,
        showEstimatedCosts: (event.currentTarget as HTMLInputElement).checked,
      }));
    });

    for (const providerId of AI_PROVIDER_IDS) {
      bindProviderCard(providerId);
    }

    byId<HTMLButtonElement>("focus-ai-jobs-btn").addEventListener("click", () => {
      void focusJobs();
    });
    byId<HTMLButtonElement>("focus-ai-settings-btn").addEventListener("click", () => {
      void focusSettings();
    });
    byId<HTMLButtonElement>("ai-jobs-status-btn").addEventListener("click", () => {
      void focusJobs();
    });
    byId<HTMLElement>("ai-routing-grid").addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        void handleRouteFieldChange(target);
      }
    });
    byId<HTMLElement>("ai-jobs-list").addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest<HTMLButtonElement>("[data-ai-job-action]");
      if (!button) {
        return;
      }
      const jobId = button.dataset.aiJobId ?? "";
      const action = button.dataset.aiJobAction;
      if (action === "cancel") {
        queue.cancelJob(jobId);
      }
      if (action === "retry") {
        queue.retryJob(jobId);
      }
    });
  }

  function render() {
    renderSettingsSurface();
    renderJobsSurface();
    applyIcons();
  }

  return {
    bind,
    render,
    focusSettings,
    focusJobs,
    subscribeJobs: (listener) => queue.subscribe(listener),
    getJob: (jobId) => queue.listJobs().find((job) => job.id === jobId) ?? null,
    queueTask,
    queueValidation,
    discoverModels: (providerId) => triggerDiscovery(providerId),
  };
}

function titleCaseFamily(value: string): string {
  return value
    .split(/[-\s]/g)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
